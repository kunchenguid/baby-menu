import { readFile, stat } from "node:fs/promises";
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
    expect(config).toContain("to: tray");
    expect(config).toContain("baby_menuTemplate*.png");
    expect(config).toContain("identity: null");
    expect(config).toContain("hardenedRuntime: false");
    expect(config).toContain("icon: assets/app-icon.icns");
    await expect(stat(resolve(import.meta.dirname, "../assets/app-icon.svg")).then((file) => file.isFile())).resolves.toBe(true);
    await expect(stat(resolve(import.meta.dirname, "../assets/app-icon.icns")).then((file) => file.isFile())).resolves.toBe(true);
  });

  it("adds a release-please workflow that publishes the DMG and updates the Homebrew tap after a release", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");

    expect(workflow).toContain("googleapis/release-please-action@v4");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("baby-menu-release-created: ${{ steps.release.outputs.release_created }}");
    expect(workflow).toContain("baby-menu-tag-name: ${{ steps.release.outputs.tag_name }}");
    expect(workflow).toContain("baby-menu-version: ${{ steps.release.outputs.version }}");
    expect(workflow).toContain("if: ${{ needs.release-please.outputs.baby-menu-release-created == 'true' }}");
    expect(workflow).toContain("ref: ${{ env.TAG_NAME }}");
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    expect(workflow).toContain("codesign --force --deep --sign -");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("HOMEBREW_TAP_TOKEN");
    expect(workflow).toContain("Casks/baby-menu.rb");
    expect(workflow).toContain("git diff --cached --quiet");
    expect(workflow).toContain("xattr");
    expect(workflow).toContain('"~/.baby-menu"');
    expect(workflow).not.toContain("tags:");
    await expect(stat(resolve(import.meta.dirname, "../.github/workflows/release.yml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("declares release-please manifest mode for the Baby Menu package", async () => {
    const config = JSON.parse(await readFile(resolve(import.meta.dirname, "../release-please-config.json"), "utf8"));
    const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "../.release-please-manifest.json"), "utf8"));

    expect(config).toMatchObject({
      $schema: "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "include-component-in-tag": true,
      packages: {
        ".": {
          "release-type": "node",
          "package-name": "baby-menu",
          component: "baby-menu",
        },
      },
    });
    expect(manifest).toEqual({
      ".": packageJson.version,
    });
  });

  it("allows release-please PRs to update generated release metadata", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/guard-generated-files.yml"), "utf8");

    expect(workflow).toContain("github.event.pull_request.user.login != 'release-please[bot]'");
    expect(workflow).toContain("github.event.pull_request.user.login != 'github-actions[bot]'");
    expect(workflow).toContain("!startsWith(github.event.pull_request.head.ref, 'release-please--')");
    expect(workflow).toContain('name_status=$(git diff --name-status "${BASE_SHA}...${HEAD_SHA}")');
    expect(workflow).toContain("manifest_status=$(printf '%s\\n' \"$name_status\" | awk");
    expect(workflow).toContain('config_status=$(printf \'%s\\n\' "$name_status" | awk');
    expect(workflow).toContain('[ "$manifest_status" = "A" ] && [ "$config_status" = "A" ]');
    expect(workflow).toContain("for path in CHANGELOG.md; do");
  });
});
