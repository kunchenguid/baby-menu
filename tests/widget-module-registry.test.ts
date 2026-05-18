import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWidgetModules } from "../src/main/widget-module-registry";

describe("widget module registry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("discovers real extension widget modules and excludes the hello-world fallback", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-widget-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, "extensions-dev");
    await mkdir(join(extensionsDir, "cpu-temp"), { recursive: true });
    await mkdir(join(extensionsDir, "hello-world"), { recursive: true });
    await writeFile(join(extensionsDir, "cpu-temp", "widget.tsx"), "export const cpuTempWidget = {};\n");
    await writeFile(join(extensionsDir, "hello-world", "widget.tsx"), "export const helloWorldWidget = {};\n");

    const modules = await discoverWidgetModules({ rootDir, extensionsDir });

    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      id: "cpu-temp.widget",
      extensionId: "cpu-temp",
    });
    expect(modules[0]?.moduleUrl).toContain("/@fs/");
    expect(modules[0]?.moduleUrl).toContain("cpu-temp/widget.tsx");
    expect(modules[0]?.moduleUrl).toContain("babyMenuWidgetVersion=");
  });

  it("returns custom protocol module URLs for compiled production widgets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-widget-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, ".baby-menu", "extensions");
    await mkdir(join(extensionsDir, "cpu-temp"), { recursive: true });
    await writeFile(
      join(extensionsDir, "cpu-temp", "widget.tsx"),
      `export const cpuTempWidget = { id: "cpu-temp", title: "CPU", render: () => null };\n`,
    );

    const modules = await discoverWidgetModules({
      rootDir,
      extensionsDir,
      mode: "compiled",
      widgetCacheDir: join(rootDir, "cache", "widgets"),
    });

    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      id: "cpu-temp.widget",
      extensionId: "cpu-temp",
    });
    expect(modules[0]?.moduleUrl).toMatch(/^baby-menu-widget:\/\/cpu-temp\/[a-f0-9]{16}\/widget\.mjs$/);
  });

  it("skips invalid compiled widgets while returning valid widgets", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-widget-registry-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, ".baby-menu", "extensions");
    await mkdir(join(extensionsDir, "good-widget"), { recursive: true });
    await mkdir(join(extensionsDir, "bad-widget"), { recursive: true });
    await writeFile(
      join(extensionsDir, "good-widget", "widget.tsx"),
      `export const goodWidget = { id: "good-widget", title: "Good", render: () => null };\n`,
    );
    await writeFile(join(extensionsDir, "bad-widget", "widget.tsx"), `import thing from "lodash"; export const badWidget = thing;\n`);

    const modules = await discoverWidgetModules({
      rootDir,
      extensionsDir,
      mode: "compiled",
      widgetCacheDir: join(rootDir, "cache", "widgets"),
    });

    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      id: "good-widget.widget",
      extensionId: "good-widget",
    });
  });
});
