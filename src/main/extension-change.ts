import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { WorkspaceChange, WorkspaceChangeKind } from "../shared/contracts";

// Directory names that live inside the extension workspace but are not
// themselves extensions, so changes to them are not reported as extension
// created/updated/removed events.
const NON_EXTENSION_DIRS = new Set(["recipes"]);

// The single root layout file the workspace may define (see AGENTS.md). Matched
// at the workspace root only; a layout.tsx inside an extension is that
// extension's concern, not the canvas layout.
const LAYOUT_FILE = /^layout\.(tsx|ts|jsx|js)$/;

/**
 * Maps a path that changed (relative to the extension workspace root) to the
 * extension id it belongs to, or null when the path is not inside an extension
 * directory (a workspace-level file like AGENTS.md, or a recipe).
 */
export function extensionIdForWorkspacePath(workspaceRelativePath: string): string | null {
  const segments = workspaceRelativePath.split(/[\\/]/).filter(Boolean);
  if (segments.length < 2) return null; // a file directly under the workspace root
  const [id] = segments;
  if (NON_EXTENSION_DIRS.has(id) || id.startsWith(".")) return null;
  return id;
}

/** True when a changed path is the workspace-root layout file. */
export function isLayoutWorkspacePath(workspaceRelativePath: string): boolean {
  const segments = workspaceRelativePath.split(/[\\/]/).filter(Boolean);
  return segments.length === 1 && LAYOUT_FILE.test(segments[0]);
}

/** Lists the immediate extension directories under a workspace dir. */
export async function listExtensionDirs(workspaceDir: string): Promise<Set<string>> {
  let entries: Dirent[];
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return new Set();
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (NON_EXTENSION_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
    ids.add(entry.name);
  }
  return ids;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function readFileOrNull(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return null;
  }
}

// Builds a flat map of relative file path -> contents for every file under
// `dir`, so two snapshots of the same directory can be compared byte for byte.
async function readFileTree(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        files.set(relative(dir, full).split(sep).join("/"), await readFile(full, { encoding: "utf8" }));
      }
    }
  }
  await walk(dir);
  return files;
}

/** True when two directory trees differ in their file set or any file contents. */
export async function directoriesDiffer(before: string, after: string): Promise<boolean> {
  const [a, b] = await Promise.all([readFileTree(before), readFileTree(after)]);
  if (a.size !== b.size) return true;
  for (const [path, content] of a) {
    if (!b.has(path) || b.get(path) !== content) return true;
  }
  return false;
}

// Classifies how a single file changed between two snapshots, or null if it is
// absent from both or identical in both.
async function classifyFile(beforePath: string, afterPath: string): Promise<WorkspaceChangeKind | null> {
  const [before, after] = await Promise.all([readFileOrNull(beforePath), readFileOrNull(afterPath)]);
  if (before === null && after === null) return null;
  if (before === null) return "created";
  if (after === null) return "removed";
  return before === after ? null : "updated";
}

/**
 * Classifies workspace changes by comparing a pre-turn snapshot of the
 * workspace against its current state. Used by the snapshot-based change
 * session (dev and packaged workspaces).
 */
export async function classifySnapshotChanges(
  snapshotDir: string,
  workspaceDir: string,
): Promise<WorkspaceChange[]> {
  const [before, after] = await Promise.all([
    listExtensionDirs(snapshotDir),
    listExtensionDirs(workspaceDir),
  ]);
  const ids = new Set<string>([...before, ...after]);
  const changes: WorkspaceChange[] = [];
  for (const id of ids) {
    const inBefore = before.has(id);
    const inAfter = after.has(id);
    if (inAfter && !inBefore) {
      changes.push({ type: "extension", extensionId: id, kind: "created" });
    } else if (inBefore && !inAfter) {
      changes.push({ type: "extension", extensionId: id, kind: "removed" });
    } else if (await directoriesDiffer(join(snapshotDir, id), join(workspaceDir, id))) {
      changes.push({ type: "extension", extensionId: id, kind: "updated" });
    }
  }

  const layoutKind = await classifyLayoutFile(snapshotDir, workspaceDir);
  if (layoutKind) changes.push({ type: "layout", kind: layoutKind });

  return sortChanges(changes);
}

async function classifyLayoutFile(beforeDir: string, afterDir: string): Promise<WorkspaceChangeKind | null> {
  for (const name of ["layout.tsx", "layout.ts", "layout.jsx", "layout.js"]) {
    const kind = await classifyFile(join(beforeDir, name), join(afterDir, name));
    if (kind) return kind;
  }
  return null;
}

export function sortChanges(changes: WorkspaceChange[]): WorkspaceChange[] {
  return changes.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function sortKey(change: WorkspaceChange): string {
  // Extensions sort by id; the layout sorts last under a high-key prefix.
  return change.type === "extension" ? `0:${change.extensionId}` : "1:layout";
}
