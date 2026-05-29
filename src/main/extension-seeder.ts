import { cp, mkdir, stat } from "node:fs/promises";

export type SeedExtensionWorkspaceOptions = {
  extensionsDir: string;
  templateDir: string | null;
};

export async function seedExtensionWorkspace(options: SeedExtensionWorkspaceOptions): Promise<boolean> {
  if (!options.templateDir) return false;
  if (!(await pathExists(options.templateDir))) return false;

  await mkdir(options.extensionsDir, { recursive: true });
  // Self-heal the bundled defaults: every file the template ships (AGENTS.md,
  // babymenu-env.d.ts, recipes, starter extensions) is force-copied so a stale
  // or edited managed file is restored on launch. cp only writes paths present
  // in the template, so user-created extensions the template does not ship are
  // left untouched and are never deleted.
  await cp(options.templateDir, options.extensionsDir, { recursive: true, force: true });
  return true;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
