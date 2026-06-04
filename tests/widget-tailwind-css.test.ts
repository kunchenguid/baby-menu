import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { compileWidgetTailwindCss, widgetTailwindCssCacheKey } from "../src/main/widget-tailwind-css";

const require = createRequire(import.meta.url);

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

  it("compiles when sourceDir is a symlink to the real workspace (home-manager/Nix)", async () => {
    // The packaged workspace root (~/.baby-menu/extensions) can be a home-manager
    // symlink into the read-only Nix store. The layout compile passes that root as
    // sourceDir; fs.cp refuses to copy a symlink node onto the temp scan dir
    // (ERR_FS_CP_NON_DIR_TO_DIR), so the source must be resolved before copying.
    const realDir = await mkdtemp(join(tmpdir(), "baby-menu-widget-real-"));
    tempDirs.push(realDir);
    await writeFile(join(realDir, "layout.tsx"), `<div className="flex gap-2 bg-surface" />`, "utf8");
    const linkParent = await mkdtemp(join(tmpdir(), "baby-menu-widget-link-"));
    tempDirs.push(linkParent);
    const linkPath = join(linkParent, "extensions");
    await symlink(realDir, linkPath);

    const css = await compileWidgetTailwindCss({ sourceDir: linkPath, themeCss });
    expect(css).toContain(".flex");
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

  it("keys cached CSS by resolved compiler package metadata", () => {
    const compilerPackageMetadata = ["tailwindcss", "@tailwindcss/postcss", "postcss"].map((packageName) =>
      readFileSync(resolvePackageJson(packageName), "utf8"),
    );
    const expectedKey = createHash("sha256")
      .update("widget-tailwind-css-v1")
      .update("\0")
      .update(themeCss)
      .update("\0")
      .update(compilerPackageMetadata.join("\0"))
      .digest("hex")
      .slice(0, 16);

    expect(widgetTailwindCssCacheKey(themeCss)).toBe(expectedKey);
  });
});

function resolvePackageJson(packageName: string): string {
  let currentDir = dirname(require.resolve(packageName));
  while (currentDir !== dirname(currentDir)) {
    const packageJsonPath = join(currentDir, "package.json");
    if (existsSync(packageJsonPath)) return packageJsonPath;
    currentDir = dirname(currentDir);
  }
  throw new Error(`Could not resolve package.json for ${packageName}`);
}
