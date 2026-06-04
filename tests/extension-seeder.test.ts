import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedExtensionWorkspace } from "../src/main/extension-seeder";

describe("seedExtensionWorkspace", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    // Restore perms first so read-only test dirs can be removed.
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

  it("resolves a symlinked workspace and seeds into the real writable target", async () => {
    // The home-manager mkOutOfStoreSymlink pattern: ~/.baby-menu/extensions is a
    // Nix-declared symlink into a WRITABLE dotfiles path. fs.cp refuses to copy a
    // directory onto the symlink node directly, so the seeder must resolve it.
    const templateDir = await makeTemplate();
    const linkTarget = join(templateDir, "..", "dotfiles-extensions");
    const extensionsDir = join(templateDir, "..", "extensions");
    await mkdir(linkTarget, { recursive: true });
    await writeFile(join(linkTarget, "my-extension.txt"), "user owned\n");
    await symlink(linkTarget, extensionsDir);

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(true);
    // Bundled defaults land in the real target...
    await expect(readFile(join(linkTarget, "AGENTS.md"), "utf8")).resolves.toBe("template rules\n");
    // ...alongside the user's own files...
    await expect(readFile(join(linkTarget, "my-extension.txt"), "utf8")).resolves.toBe("user owned\n");
    // ...and the user-owned symlink itself is never modified.
    await expect(lstat(extensionsDir).then((s) => s.isSymbolicLink())).resolves.toBe(true);
  });

  it("creates and seeds the target when the symlink points to a not-yet-existing writable path", async () => {
    const templateDir = await makeTemplate();
    const linkTarget = join(templateDir, "..", "not-created-yet");
    const extensionsDir = join(templateDir, "..", "extensions");
    await symlink(linkTarget, extensionsDir);

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(true);
    await expect(readFile(join(linkTarget, "AGENTS.md"), "utf8")).resolves.toBe("template rules\n");
  });

  it("skips without throwing when the symlink target is read-only (Nix store)", async () => {
    const templateDir = await makeTemplate();
    const linkTarget = join(templateDir, "..", "readonly-store");
    const extensionsDir = join(templateDir, "..", "extensions");
    await mkdir(linkTarget, { recursive: true });
    await chmod(linkTarget, 0o500);
    tempDirs.push(linkTarget);
    await symlink(linkTarget, extensionsDir);

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(false);
    await expect(lstat(extensionsDir).then((s) => s.isSymbolicLink())).resolves.toBe(true);
    await expect(readFile(join(linkTarget, "AGENTS.md"), "utf8")).rejects.toThrow();
  });

  it("skips without throwing when the workspace path is a regular file", async () => {
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
