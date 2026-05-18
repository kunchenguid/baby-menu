import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import packageJson from "../package.json";
import { describe, expect, it } from "vitest";

describe("distribution config", () => {
  it("adds mac packaging scripts and keeps TypeScript available at runtime for extension compilation", () => {
    expect(packageJson.scripts?.["package:mac"]).toContain("electron-builder --mac dir --universal");
    expect(packageJson.scripts?.["dist:mac"]).toContain("scripts/create-dmg.mjs");
    expect(packageJson.dependencies?.typescript).toBe("6.0.3");
    expect(packageJson.devDependencies?.["electron-builder"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("declares an unsigned electron-builder mac bundle with extension templates", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");

    expect(config).toContain("appId: com.kunchenguid.baby-menu");
    expect(config).toContain("to: extensions-template");
    expect(config).toContain("identity: null");
    expect(config).toContain("hardenedRuntime: false");
  });

  it("adds a tag-triggered release workflow that uploads the DMG and updates the Homebrew tap", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release.yml"), "utf8");

    expect(workflow).toContain('tags:');
    expect(workflow).toContain('"v*"');
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    expect(workflow).toContain("codesign --force --deep --sign -");
    expect(workflow).toContain("gh release");
    expect(workflow).toContain("HOMEBREW_TAP_TOKEN");
    expect(workflow).toContain("Casks/baby-menu.rb");
    expect(workflow).toContain("git diff --cached --quiet");
    expect(workflow).toContain("xattr");
    expect(workflow).toContain('"~/.baby-menu"');
  });
});
