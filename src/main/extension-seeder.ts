import { cp, mkdir, stat } from "node:fs/promises";

export type SeedExtensionWorkspaceOptions = {
  extensionsDir: string;
  templateDir: string | null;
};

export async function seedExtensionWorkspace(options: SeedExtensionWorkspaceOptions): Promise<boolean> {
  if (!options.templateDir) return false;
  if (!(await pathExists(options.templateDir))) return false;

  await mkdir(options.extensionsDir, { recursive: true });
  await cp(options.templateDir, options.extensionsDir, { recursive: true, force: false, errorOnExist: false });
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
