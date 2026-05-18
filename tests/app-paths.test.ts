import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBabyMenuRuntimePaths } from "../src/main/app-paths";
import { seedExtensionWorkspace } from "../src/main/extension-seeder";

describe("Baby Menu runtime paths", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    const { rm } = await import("node:fs/promises");
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("keeps source-mode mutable state in the checkout and honors extension workspace overrides", () => {
    const paths = createBabyMenuRuntimePaths({
      isPackaged: false,
      sourceRoot: "/repo",
      env: { BABY_MENU_EXTENSIONS_DIR: "extensions-dev" },
    });

    expect(paths).toMatchObject({
      appDataRoot: "/repo",
      sourceRoot: "/repo",
      extensionsDir: "/repo/extensions-dev",
      cacheDir: "/repo/.cache/baby-menu",
      agentStateDir: "/repo/.cache/baby-menu/acp-sessions",
      devExtensionSnapshotDir: "/repo/.cache/baby-menu/dev-extension-snapshots",
      bundledExtensionTemplateDir: null,
      isPackaged: false,
    });
  });

  it("keeps packaged mutable state under a home dot directory and templates under Resources", () => {
    const paths = createBabyMenuRuntimePaths({
      isPackaged: true,
      sourceRoot: "/ignored/source",
      homeDir: "/Users/me",
      resourcesPath: "/Applications/Baby Menu.app/Contents/Resources",
    });

    expect(paths).toMatchObject({
      appDataRoot: "/Users/me/.baby-menu",
      sourceRoot: "/ignored/source",
      extensionsDir: "/Users/me/.baby-menu/extensions",
      cacheDir: "/Users/me/.baby-menu/cache",
      agentStateDir: "/Users/me/.baby-menu/cache/acp-sessions",
      devExtensionSnapshotDir: "/Users/me/.baby-menu/cache/snapshots",
      bundledExtensionTemplateDir: "/Applications/Baby Menu.app/Contents/Resources/extensions-template",
      isPackaged: true,
    });
  });

  it("seeds missing packaged extension templates without overwriting user files", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-seed-"));
    tempDirs.push(rootDir);
    const templateDir = join(rootDir, "Resources", "extensions-template");
    const extensionsDir = join(rootDir, ".baby-menu", "extensions");
    await mkdir(join(templateDir, "recipes"), { recursive: true });
    await mkdir(join(templateDir, "hello-world"), { recursive: true });
    await writeFile(join(templateDir, "AGENTS.md"), "template rules\n");
    await writeFile(join(templateDir, "recipes", "starter.html"), "<title>Starter</title>\n");
    await writeFile(join(templateDir, "hello-world", "widget.tsx"), "export const helloWorldWidget = {};\n");

    const seeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(seeded).toBe(true);
    await expect(readFile(join(extensionsDir, "AGENTS.md"), "utf8")).resolves.toBe("template rules\n");

    await writeFile(join(extensionsDir, "AGENTS.md"), "user rules\n");
    await mkdir(join(templateDir, "goodbye-world"), { recursive: true });
    await writeFile(join(templateDir, "recipes", "new.html"), "<title>New</title>\n");
    await writeFile(join(templateDir, "goodbye-world", "widget.tsx"), "export const goodbyeWorldWidget = {};\n");
    const reseeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(reseeded).toBe(true);
    await expect(readFile(join(extensionsDir, "AGENTS.md"), "utf8")).resolves.toBe("user rules\n");
    await expect(readFile(join(extensionsDir, "recipes", "new.html"), "utf8")).resolves.toBe("<title>New</title>\n");
    await expect(readFile(join(extensionsDir, "goodbye-world", "widget.tsx"), "utf8")).resolves.toBe(
      "export const goodbyeWorldWidget = {};\n",
    );
  });
});
