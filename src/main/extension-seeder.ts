import { cp, lstat, mkdir, stat } from "node:fs/promises";
import type { Stats } from "node:fs";

export type SeedExtensionWorkspaceOptions = {
  extensionsDir: string;
  templateDir: string | null;
};

export async function seedExtensionWorkspace(options: SeedExtensionWorkspaceOptions): Promise<boolean> {
  if (!options.templateDir) return false;
  if (!(await pathExists(options.templateDir))) return false;

  // The workspace must be a real directory baby-menu owns and can write to: the
  // seeder force-copies bundled defaults here on every launch and the embedded
  // agent edits it at runtime. If the path already exists as a symlink or any
  // other non-directory (e.g. a read-only home-manager / Nix-store managed
  // symlink), fs.cp throws ERR_FS_CP_DIR_TO_NON_DIR. Seeding is best-effort and
  // must never abort app startup, so skip with a clear warning instead of
  // throwing, and never clobber a user-owned node.
  const existing = await lstatOrNull(options.extensionsDir);
  if (existing && !existing.isDirectory()) {
    console.warn(
      `[baby-menu] Skipping extension workspace seeding: ${options.extensionsDir} is ${describeNode(existing)}, ` +
        `not a writable directory. Baby Menu must own this path; if it is a managed symlink ` +
        `(e.g. home-manager / Nix), remove that management so Baby Menu can create a real directory.`,
    );
    return false;
  }

  try {
    await mkdir(options.extensionsDir, { recursive: true });
    // Self-heal the bundled defaults: every file the template ships (AGENTS.md,
    // babymenu-env.d.ts, recipes, starter extensions) is force-copied so a stale
    // or edited managed file is restored on launch. cp only writes paths present
    // in the template, so user-created extensions the template does not ship are
    // left untouched and are never deleted.
    await cp(options.templateDir, options.extensionsDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    // A failed seed (permissions, read-only volume, race) must not prevent the
    // app from launching its tray. Log and continue with whatever workspace
    // contents already exist.
    console.warn(
      `[baby-menu] Failed to seed extension workspace at ${options.extensionsDir}; continuing with existing contents: ${describeError(error)}`,
    );
    return false;
  }
}

function describeNode(stats: Stats): string {
  if (stats.isSymbolicLink()) return "a symlink";
  if (stats.isFile()) return "a file";
  return "a non-directory";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function lstatOrNull(filePath: string): Promise<Stats | null> {
  try {
    return await lstat(filePath);
  } catch {
    return null;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
