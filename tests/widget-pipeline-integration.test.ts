import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWidgetModules } from "../src/main/widget-module-registry";

// End-to-end proof of the packaged pipeline: an agent-authored widget that
// imports @babymenu/ui and uses token Tailwind utilities must compile to a
// host-shim import plus a token-restricted stylesheet.
describe("compiled widget pipeline", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function cachePath(widgetCacheDir: string, protocolUrl: string): string {
    return join(widgetCacheDir, protocolUrl.replace("baby-menu-widget://", ""));
  }

  it("rewrites @babymenu/ui to the host shim and compiles a stylesheet from the packaged workspace", async () => {
    // The workspace lives under a hidden `.baby-menu` dir, exactly like packaged
    // mode, to guard the regression where Tailwind's scanner skipped it.
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-pipeline-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, ".baby-menu", "extensions");
    const widgetCacheDir = join(rootDir, "cache", "widgets");
    await mkdir(join(extensionsDir, "cpu-temp"), { recursive: true });
    await writeFile(
      join(extensionsDir, "cpu-temp", "widget.tsx"),
      [
        `import { StatusDot } from "@babymenu/ui";`,
        `export const cpuTempWidget = {`,
        `  id: "cpu-temp",`,
        `  title: "CPU TEMP",`,
        `  render: () => <span className="flex items-center gap-2"><StatusDot /></span>,`,
        `};`,
        ``,
      ].join("\n"),
    );

    const [descriptor] = await discoverWidgetModules({
      rootDir,
      extensionsDir,
      mode: "compiled",
      widgetCacheDir,
    });

    expect(descriptor?.moduleUrl).toMatch(/^baby-menu-widget:\/\/cpu-temp\/[a-f0-9]{16}\/widget\.mjs$/);
    expect(descriptor?.cssUrl).toMatch(/^baby-menu-widget:\/\/cpu-temp\/[a-f0-9]{16}\/widget\.css$/);

    const compiledModule = await readFile(cachePath(widgetCacheDir, descriptor!.moduleUrl), "utf8");
    expect(compiledModule).toContain("baby-menu-host://ui/index.mjs");
    expect(compiledModule).not.toContain("@babymenu/ui");

    // Tailwind scanned the widget through the hidden ancestor and emitted CSS.
    // (Token/palette correctness is covered by widget-tailwind-css.test.ts, which
    // loads the real @theme; vitest returns "" for the registry's `?raw` import.)
    const compiledCss = await readFile(cachePath(widgetCacheDir, descriptor!.cssUrl!), "utf8");
    expect(compiledCss).toContain(".flex");
    expect(compiledCss).toContain(".items-center");
  });

  it("rebuilds a cached stylesheet when its cache key is stale", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-pipeline-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, ".baby-menu", "extensions");
    const widgetCacheDir = join(rootDir, "cache", "widgets");
    await mkdir(join(extensionsDir, "cpu-temp"), { recursive: true });
    await writeFile(
      join(extensionsDir, "cpu-temp", "widget.tsx"),
      [
        `export const cpuTempWidget = {`,
        `  id: "cpu-temp",`,
        `  title: "CPU TEMP",`,
        `  render: () => <span className="flex items-center gap-2" />,`,
        `};`,
        ``,
      ].join("\n"),
    );

    const [descriptor] = await discoverWidgetModules({
      rootDir,
      extensionsDir,
      mode: "compiled",
      widgetCacheDir,
    });
    const cssPath = cachePath(widgetCacheDir, descriptor!.cssUrl!);
    await writeFile(cssPath, "stale css", "utf8");
    await writeFile(join(cssPath, "..", "widget.css.cache-key"), "stale-key", "utf8");

    await discoverWidgetModules({
      rootDir,
      extensionsDir,
      mode: "compiled",
      widgetCacheDir,
    });

    const compiledCss = await readFile(cssPath, "utf8");
    expect(compiledCss).toContain(".flex");
    expect(compiledCss).not.toBe("stale css");
  });
});
