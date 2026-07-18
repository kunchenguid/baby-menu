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
      platform: "darwin",
    });

    expect(paths).toMatchObject({
      appDataRoot: "/repo",
      sourceRoot: "/repo",
      extensionsDir: "/repo/extensions-dev",
      cacheDir: "/repo/.cache/baby-menu",
      agentStateDir: "/repo/.cache/baby-menu/acp-sessions",
      devExtensionSnapshotDir: "/repo/.cache/baby-menu/dev-extension-snapshots",
      bundledExtensionTemplateDir: null,
      trayIconPath: "/repo/assets/tray/baby_menuTemplate.png",
      isPackaged: false,
    });
  });

  it("keeps packaged mutable state under a home dot directory and templates under Resources", () => {
    const paths = createBabyMenuRuntimePaths({
      isPackaged: true,
      sourceRoot: "/ignored/source",
      homeDir: "/Users/me",
      resourcesPath: "/Applications/Baby Menu.app/Contents/Resources",
      platform: "darwin",
    });

    expect(paths).toMatchObject({
      appDataRoot: "/Users/me/.baby-menu",
      sourceRoot: "/ignored/source",
      extensionsDir: "/Users/me/.baby-menu/extensions",
      cacheDir: "/Users/me/.baby-menu/cache",
      agentStateDir: "/Users/me/.baby-menu/cache/acp-sessions",
      devExtensionSnapshotDir: "/Users/me/.baby-menu/cache/snapshots",
      bundledExtensionTemplateDir: "/Applications/Baby Menu.app/Contents/Resources/extensions-template",
      trayIconPath: "/Applications/Baby Menu.app/Contents/Resources/tray/baby_menuTemplate.png",
      isPackaged: true,
    });
  });

  it("selects the non-template tray icon for win32 source and packaged modes", () => {
    const sourcePaths = createBabyMenuRuntimePaths({
      isPackaged: false,
      sourceRoot: "/repo",
      platform: "win32",
    });
    expect(sourcePaths.trayIconPath).toBe("/repo/assets/tray/baby_menu.png");

    const packagedPaths = createBabyMenuRuntimePaths({
      isPackaged: true,
      sourceRoot: "/ignored/source",
      homeDir: "C:\\Users\\me",
      resourcesPath: "C:\\Program Files\\Baby Menu\\resources",
      platform: "win32",
    });
    expect(packagedPaths.trayIconPath).toBe("C:\\Program Files\\Baby Menu\\resources/tray/baby_menu.png");
    // Packaged data root stays ~/.baby-menu (G04) even on Windows.
    expect(packagedPaths.appDataRoot).toBe(join("C:\\Users\\me", ".baby-menu"));
  });

  it("selects the macOS Template tray icon when platform is darwin", () => {
    const sourcePaths = createBabyMenuRuntimePaths({
      isPackaged: false,
      sourceRoot: "/repo",
      platform: "darwin",
    });
    expect(sourcePaths.trayIconPath).toBe("/repo/assets/tray/baby_menuTemplate.png");

    const packagedPaths = createBabyMenuRuntimePaths({
      isPackaged: true,
      sourceRoot: "/ignored/source",
      homeDir: "/Users/me",
      resourcesPath: "/Applications/Baby Menu.app/Contents/Resources",
      platform: "darwin",
    });
    expect(packagedPaths.trayIconPath).toBe(
      "/Applications/Baby Menu.app/Contents/Resources/tray/baby_menuTemplate.png",
    );
  });

  it("keeps the Template tray basename on linux (non-win32 non-product host)", () => {
    const sourcePaths = createBabyMenuRuntimePaths({
      isPackaged: false,
      sourceRoot: "/repo",
      platform: "linux",
    });
    expect(sourcePaths.trayIconPath).toBe("/repo/assets/tray/baby_menuTemplate.png");

    const packagedPaths = createBabyMenuRuntimePaths({
      isPackaged: true,
      sourceRoot: "/ignored/source",
      homeDir: "/home/me",
      resourcesPath: "/opt/baby-menu/resources",
      platform: "linux",
    });
    expect(packagedPaths.trayIconPath).toBe("/opt/baby-menu/resources/tray/baby_menuTemplate.png");
  });

  it("refreshes bundled template files while preserving user-created extensions", async () => {
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

    // The user (via the embedded agent) creates their own extension and edits a
    // managed default file. The template also gains a new recipe and the
    // managed files change between launches.
    await mkdir(join(extensionsDir, "system-usage"), { recursive: true });
    await writeFile(join(extensionsDir, "system-usage", "widget.tsx"), "export const systemUsageWidget = {};\n");
    await writeFile(join(extensionsDir, "AGENTS.md"), "user edited rules\n");
    await writeFile(join(templateDir, "AGENTS.md"), "template rules v2\n");
    await mkdir(join(templateDir, "goodbye-world"), { recursive: true });
    await writeFile(join(templateDir, "recipes", "new.html"), "<title>New</title>\n");
    await writeFile(join(templateDir, "goodbye-world", "widget.tsx"), "export const goodbyeWorldWidget = {};\n");

    const reseeded = await seedExtensionWorkspace({ extensionsDir, templateDir });

    expect(reseeded).toBe(true);
    // Managed default files self-heal back to the bundled template, even if edited.
    await expect(readFile(join(extensionsDir, "AGENTS.md"), "utf8")).resolves.toBe("template rules v2\n");
    // New bundled defaults are added.
    await expect(readFile(join(extensionsDir, "recipes", "new.html"), "utf8")).resolves.toBe("<title>New</title>\n");
    await expect(readFile(join(extensionsDir, "goodbye-world", "widget.tsx"), "utf8")).resolves.toBe(
      "export const goodbyeWorldWidget = {};\n",
    );
    // User-created extensions the template does not ship are left untouched.
    await expect(readFile(join(extensionsDir, "system-usage", "widget.tsx"), "utf8")).resolves.toBe(
      "export const systemUsageWidget = {};\n",
    );
  });
});
