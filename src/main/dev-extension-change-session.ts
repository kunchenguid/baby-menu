import type { Dirent } from "node:fs";
import { cp, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import type { GitActionResult, GitSessionSnapshot, WorkspaceChange } from "../shared/contracts";
import { classifySnapshotChanges, directoriesDiffer, restoreSnapshot } from "./extension-change";

export class DevExtensionChangeSession {
  readonly startedClean = true;
  readonly head = null;

  private completed = false;

  private constructor(
    private readonly extensionsDir: string,
    private readonly snapshotDir: string,
  ) {}

  get canSave(): boolean {
    return !this.completed;
  }

  get canRollback(): boolean {
    return !this.completed;
  }

  static async begin(extensionsDir: string, snapshotRoot: string): Promise<DevExtensionChangeSession> {
    await mkdir(extensionsDir, { recursive: true });
    await mkdir(snapshotRoot, { recursive: true });
    const snapshotDir = join(snapshotRoot, randomUUID());
    // Resolve symlinks so the snapshot is a plain copy of the real contents
    // (copying a symlinked workspace verbatim would alias the snapshot to the
    // live tree). Skip the user's own `.git` - it is theirs to manage, and can
    // be large.
    const source = await realpath(extensionsDir);
    await cp(source, snapshotDir, {
      recursive: true,
      force: true,
      filter: (entry) => basename(entry) !== ".git",
    });
    await markIgnoredEntries(source, snapshotDir, source);
    return new DevExtensionChangeSession(extensionsDir, snapshotDir);
  }

  // Whether the workspace actually differs from the pre-turn snapshot. False
  // means the agent reported back without changing any file.
  async hasChanges(): Promise<boolean> {
    return directoriesDiffer(this.snapshotDir, this.extensionsDir);
  }

  // Classifies which workspace surfaces this turn created, updated, or removed by
  // comparing the pre-turn snapshot to the current workspace - never the agent's prose.
  async describeChanges(): Promise<WorkspaceChange[]> {
    return classifySnapshotChanges(this.snapshotDir, this.extensionsDir);
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

  async save(): Promise<GitActionResult> {
    if (this.completed) return { ok: false, reason: "Cannot save: session is already completed" };

    this.completed = true;
    await rm(this.snapshotDir, { recursive: true, force: true });
    return { ok: true };
  }

  async rollback(): Promise<GitActionResult> {
    if (this.completed) return { ok: false, reason: "Cannot rollback: session is already completed" };

    await restoreSnapshot(this.snapshotDir, this.extensionsDir);
    await rm(this.snapshotDir, { recursive: true, force: true });
    this.completed = true;
    return { ok: true };
  }
}

async function markIgnoredEntries(sourceRoot: string, snapshotRoot: string, current: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.name === ".git") {
      const target = join(snapshotRoot, relative(sourceRoot, full).split(sep).join("/"));
      await mkdir(dirname(target), { recursive: true });
      if (entry.isDirectory()) await mkdir(target);
      else await writeFile(target, "");
      continue;
    }
    if (entry.isDirectory()) await markIgnoredEntries(sourceRoot, snapshotRoot, full);
  }
}
