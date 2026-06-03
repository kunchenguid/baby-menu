import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import type { GitActionResult, GitSessionSnapshot, WorkspaceChange, WorkspaceChangeKind } from "../shared/contracts";
import { extensionIdForWorkspacePath, isLayoutWorkspacePath, pathExists, sortChanges } from "./extension-change";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

async function gitText(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await git(cwd, args);
  return stdout.trim();
}

async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  return (await gitText(cwd, ["status", "--porcelain"])) === "";
}

// Re-expresses a repo-relative changed path against the extension workspace
// root, or returns null when the path is outside the workspace.
function workspaceRelativePath(prefix: string, repoRelativePath: string): string | null {
  if (!prefix) return repoRelativePath;
  if (repoRelativePath === prefix) return "";
  const withSlash = `${prefix}/`;
  return repoRelativePath.startsWith(withSlash) ? repoRelativePath.slice(withSlash.length) : null;
}

export class GitChangeSession {
  readonly rootDir: string;
  readonly head: string | null;
  readonly startedClean: boolean;
  // The extension workspace, relative to rootDir (e.g. "extensions"). Used to map
  // changed repo paths back to the extension they belong to.
  private readonly extensionsRelDir: string;

  private completed = false;

  private constructor(rootDir: string, head: string | null, startedClean: boolean, extensionsDir: string) {
    this.rootDir = rootDir;
    this.head = head;
    this.startedClean = startedClean;
    this.extensionsRelDir = relative(rootDir, extensionsDir);
  }

  get canSave(): boolean {
    return this.startedClean && !this.completed;
  }

  get canRollback(): boolean {
    return this.startedClean && !this.completed;
  }

  static async begin(rootDir: string, extensionsDir: string = rootDir): Promise<GitChangeSession> {
    const startedClean = await isWorkingTreeClean(rootDir);
    const head = startedClean ? await gitText(rootDir, ["rev-parse", "HEAD"]) : null;
    return new GitChangeSession(rootDir, head, startedClean, extensionsDir);
  }

  // Whether the working tree actually differs from its pre-turn state. False
  // means the agent reported back without changing any file.
  async hasChanges(): Promise<boolean> {
    return !(await isWorkingTreeClean(this.rootDir));
  }

  // Classifies which workspace surfaces this turn created, updated, or removed by
  // reading the actual working-tree diff - never the agent's prose.
  async describeChanges(): Promise<WorkspaceChange[]> {
    const prefix = this.extensionsRelDir;
    const ids = new Set<string>();
    let layoutWorkspaceRel: string | null = null;
    for (const path of await this.changedPaths()) {
      const workspaceRel = workspaceRelativePath(prefix, path);
      if (workspaceRel === null) continue;
      if (isLayoutWorkspacePath(workspaceRel)) {
        layoutWorkspaceRel = workspaceRel;
        continue;
      }
      const id = extensionIdForWorkspacePath(workspaceRel);
      if (id) ids.add(id);
    }

    const changes: WorkspaceChange[] = [];
    for (const id of ids) {
      changes.push({ type: "extension", extensionId: id, kind: await this.classify(id, prefix) });
    }
    if (layoutWorkspaceRel) {
      const kind = await this.classifyPath(`${prefix ? `${prefix}/` : ""}${layoutWorkspaceRel}`);
      changes.push({ type: "layout", kind });
    }
    return sortChanges(changes);
  }

  private async changedPaths(): Promise<string[]> {
    const { stdout } = await git(this.rootDir, ["status", "--porcelain", "-z", "-uall"]);
    const tokens = stdout.split("\0");
    const paths: string[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (!token) continue;
      const status = token.slice(0, 2);
      // Rename/copy entries are "XY <dest>\0<src>\0"; keep the destination path
      // and skip the trailing source token.
      if (status[0] === "R" || status[0] === "C") i += 1;
      paths.push(token.slice(3));
    }
    return paths;
  }

  private async classify(extensionId: string, prefix: string): Promise<WorkspaceChangeKind> {
    return this.classifyPath(prefix ? `${prefix}/${extensionId}` : extensionId);
  }

  private async classifyPath(repoRelPath: string): Promise<WorkspaceChangeKind> {
    const inHead = (await gitText(this.rootDir, ["ls-tree", this.head ?? "HEAD", "--", repoRelPath])) !== "";
    const onDisk = await pathExists(join(this.rootDir, repoRelPath));
    if (inHead && !onDisk) return "removed";
    if (!inHead && onDisk) return "created";
    return "updated";
  }

  snapshot(message?: string): GitSessionSnapshot {
    return {
      startedClean: this.startedClean,
      canSave: this.canSave,
      canRollback: this.canRollback,
      head: this.head,
      message,
    };
  }

  async save(message = "Save baby-menu agent changes"): Promise<GitActionResult> {
    const safety = await this.ensureSafeToApply("save");
    if (!safety.ok) return safety;

    if (await isWorkingTreeClean(this.rootDir)) {
      return { ok: false, reason: "No changes to save" };
    }

    await git(this.rootDir, ["add", "--all"]);
    await git(this.rootDir, ["commit", "-m", message]);
    this.completed = true;
    const commit = await gitText(this.rootDir, ["rev-parse", "HEAD"]);
    return { ok: true, commit };
  }

  async rollback(): Promise<GitActionResult> {
    const safety = await this.ensureSafeToApply("rollback");
    if (!safety.ok) return safety;

    await git(this.rootDir, ["reset", "--hard", this.head ?? "HEAD"]);
    await git(this.rootDir, ["clean", "-fd"]);
    this.completed = true;
    return { ok: true };
  }

  private async ensureSafeToApply(action: "save" | "rollback"): Promise<GitActionResult> {
    if (!this.startedClean || this.head === null) {
      return {
        ok: false,
        reason: `Cannot ${action}: session did not start from a clean working tree`,
      };
    }
    if (this.completed) {
      return { ok: false, reason: `Cannot ${action}: session is already completed` };
    }

    const currentHead = await gitText(this.rootDir, ["rev-parse", "HEAD"]);
    if (currentHead !== this.head) {
      return {
        ok: false,
        reason: `Cannot ${action}: HEAD changed since the session started`,
      };
    }

    return { ok: true };
  }
}
