import { cp, lstat, mkdir, readlink, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Stats } from "node:fs";

export type SeedExtensionWorkspaceOptions = {
  extensionsDir: string;
  templateDir: string | null;
};

export async function seedExtensionWorkspace(options: SeedExtensionWorkspaceOptions): Promise<boolean> {
  if (!options.templateDir) return false;
  if (!(await pathExists(options.templateDir))) return false;

  // Resolve a symlinked workspace to its real target before copying. fs.cp
  // refuses to copy a directory *onto a symlink node* (ERR_FS_CP_DIR_TO_NON_DIR),
  // even when the link points to a writable directory - which is exactly the
  // home-manager mkOutOfStoreSymlink pattern (a Nix-declared symlink into a
  // writable dotfiles path). Seeding the resolved target makes that case work,
  // while a link into the read-only Nix store simply fails the copy below and is
  // skipped. The user-owned symlink itself is never touched.
  const target = await resolveSeedTarget(options.extensionsDir);

  try {
    await mkdir(target, { recursive: true });
    // Self-heal the bundled defaults: every file the template ships (AGENTS.md,
    // babymenu-env.d.ts, recipes, managed extensions) is force-copied so a stale
    // or edited managed file is restored on launch. cp only writes paths present
    // in the template, so user-created extensions the template does not ship are
    // left untouched and are never deleted.
    await cp(options.templateDir, target, { recursive: true, force: true });
    return true;
  } catch (error) {
    // A failed seed (read-only / managed target, permissions, non-directory
    // path) must never abort app startup - the embedded agent self-heals the
    // workspace later anyway. Log and continue with whatever already exists.
    console.warn(
      `[baby-menu] Skipped seeding extension workspace at ${options.extensionsDir}` +
        (target === options.extensionsDir ? "" : ` (resolved to ${target})`) +
        `; continuing with existing contents. If this path is a read-only or managed symlink ` +
        `(e.g. home-manager into /nix/store), point it at a writable location ` +
        `(home-manager mkOutOfStoreSymlink) so Baby Menu can own it. Cause: ${describeError(error)}`,
    );
    return false;
  }
}

async function resolveSeedTarget(extensionsDir: string): Promise<string> {
  const node = await lstatOrNull(extensionsDir);
  if (!node?.isSymbolicLink()) return extensionsDir;

  // Prefer realpath (resolves chains and `..`); fall back to a one-level readlink
  // when the link target does not exist yet, so we can still create and seed it.
  const real = await realpathOrNull(extensionsDir);
  if (real) return real;

  const linkText = await readlink(extensionsDir);
  return isAbsolute(linkText) ? linkText : resolve(dirname(extensionsDir), linkText);
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

async function realpathOrNull(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath);
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
