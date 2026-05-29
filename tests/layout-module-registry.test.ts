import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverLayoutModule, discoverWidgetModules } from "../src/main/widget-module-registry";

describe("layout module registry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns null when the workspace has no root layout module", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-layout-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, "cpu-temp"), { recursive: true });
    await writeFile(join(extensionsDir, "cpu-temp", "widget.tsx"), "export const cpuTempWidget = {};\n");

    expect(await discoverLayoutModule({ rootDir, extensionsDir })).toBeNull();
  });

  it("discovers a dev-mode root layout module via /@fs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-layout-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(join(extensionsDir, "layout.tsx"), "export default function Layout() { return null; }\n");

    const descriptor = await discoverLayoutModule({ rootDir, extensionsDir });

    expect(descriptor?.moduleUrl).toContain("/@fs/");
    expect(descriptor?.moduleUrl).toContain("layout.tsx");
    expect(descriptor?.moduleUrl).toContain("babyMenuWidgetVersion=");
  });

  it("returns a compiled custom protocol URL for the production layout module", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-layout-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, ".baby-menu", "extensions");
    await mkdir(extensionsDir, { recursive: true });
    await writeFile(
      join(extensionsDir, "layout.tsx"),
      `import type { BabyMenuLayoutProps } from "@babymenu/contracts";\n` +
        `export default function Layout({ widgets, renderWidget }: BabyMenuLayoutProps) {\n` +
        `  return widgets.map((w) => renderWidget(w.id));\n}\n`,
    );

    const descriptor = await discoverLayoutModule({
      rootDir,
      extensionsDir,
      mode: "compiled",
      widgetCacheDir: join(rootDir, "cache", "widgets"),
    });

    expect(descriptor?.moduleUrl).toMatch(/^baby-menu-widget:\/\/__layout\/[a-f0-9]{16}\/layout\.mjs$/);
    expect(descriptor?.cssUrl).toMatch(/^baby-menu-widget:\/\/__layout\/[a-f0-9]{16}\/widget\.css$/);
  });

  it("excludes the root layout file from widget discovery", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-layout-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, "cpu-temp"), { recursive: true });
    await writeFile(join(extensionsDir, "cpu-temp", "widget.tsx"), "export const cpuTempWidget = {};\n");
    await writeFile(join(extensionsDir, "layout.tsx"), "export default function Layout() { return null; }\n");

    const modules = await discoverWidgetModules({ rootDir, extensionsDir });

    expect(modules.map((module) => module.id)).toEqual(["cpu-temp.widget"]);
  });
});
