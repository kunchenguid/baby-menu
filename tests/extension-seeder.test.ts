import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedExtensionWorkspace } from "../src/main/extension-seeder";

describe("seedExtensionWorkspace", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    // Restore perms first so read-only-target test dirs can be removed.
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await chmod(dir, 0o755).catch(() => undefined);
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  async function makeTemplate(): Promise<string> {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-seeder-"));
    tempDirs.push(rootDir);
    const templateDir = join(rootDir, "template");
    await mkdir(join(templateDir, "recipes"), { recursive: true });
    await writeFile(join(templateDir, "AGENTS.md"), "template rules\n");
    await writeFile(join(templateDir, "recipes", "starter.html"), "<title>Starter</title>\n");
    return templateDir;
  }

  it("returns false when no template is configured", async () => {
    await expect(seedExtensionWorkspace({ extensionsDir: "/anything", templateDir: null })).resolves.toBe(false);
  });

  it("force-copies the template into a real workspace directory", async () => {
    const templateDir = await makeTemplate();
    const extensionsDir = join(templateDir, "..", "extensions");

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(true);
    await expect(readFile(join(extensionsDir, "AGENTS.md"), "utf8")).resolves.toBe("template rules\n");
  });

  it("skips seeding without throwing when the workspace path is a symlink", async () => {
    // Reproduces a home-manager / Nix-store managed workspace: ~/.baby-menu/extensions
    // is a symlink into a read-only store. fs.cp would throw ERR_FS_CP_DIR_TO_NON_DIR
    // and abort app startup before the tray is ever created.
    const templateDir = await makeTemplate();
    const linkTarget = join(templateDir, "..", "managed-store");
    const extensionsDir = join(templateDir, "..", "extensions");
    await mkdir(linkTarget, { recursive: true });
    await writeFile(join(linkTarget, "existing.txt"), "managed\n");
    await symlink(linkTarget, extensionsDir);

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(false);
    // The user-owned symlink is preserved, not clobbered or followed-and-overwritten.
    await expect(lstat(extensionsDir).then((s) => s.isSymbolicLink())).resolves.toBe(true);
    // Bundled defaults were not force-copied into the managed target.
    await expect(readFile(join(linkTarget, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  it("skips seeding without throwing when the workspace path is a regular file", async () => {
    const templateDir = await makeTemplate();
    const extensionsDir = join(templateDir, "..", "extensions");
    await writeFile(extensionsDir, "not a directory\n");

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(false);
    await expect(readFile(extensionsDir, "utf8")).resolves.toBe("not a directory\n");
  });

  it("returns false instead of throwing when the copy fails", async () => {
    const templateDir = await makeTemplate();
    const extensionsDir = join(templateDir, "..", "extensions");
    await mkdir(extensionsDir, { recursive: true });
    // Read-only directory: the destination is a real directory (passes the
    // non-directory guard) but fs.cp cannot write into it.
    await chmod(extensionsDir, 0o500);
    tempDirs.push(extensionsDir);

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(false);
  });
});
