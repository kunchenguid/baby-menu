import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { compileWidgetTailwindCss } from "../src/main/widget-tailwind-css";

describe("per-widget Tailwind compile", () => {
  const tempDirs: string[] = [];
  let themeCss = "";

  beforeAll(async () => {
    // Use the real single source of truth so the test breaks if the theme drifts.
    themeCss = await readFile(resolve(__dirname, "../src/ui/theme.css"), "utf8");
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function compileFromSource(source: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "baby-menu-widget-css-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "widget.tsx"), source, "utf8");
    return compileWidgetTailwindCss({ sourceDir: dir, themeCss });
  }

  it("generates utility CSS for classes authored in widget source", async () => {
    const css = await compileFromSource(`<div className="flex gap-2 text-ink-muted bg-surface" />`);
    expect(css).toContain(".flex");
    expect(css).toContain(".text-ink-muted");
    expect(css).toContain(".bg-surface");
  });

  it("maps token utilities to Baby Menu token values", async () => {
    const css = await compileFromSource(`<span className="text-signal-live" />`);
    expect(css.toLowerCase()).toContain("#6ae3b6");
  });

  it("does not generate off-palette utilities (Monochrome Lab is framework-enforced)", async () => {
    const css = await compileFromSource(`<div className="bg-red-500 text-blue-300" />`);
    expect(css).not.toContain(".bg-red-500");
    expect(css).not.toContain(".text-blue-300");
  });
});
