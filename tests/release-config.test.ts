import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import packageJson from "../package.json";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("distribution config", () => {
  it("adds mac packaging scripts and keeps TypeScript available at runtime for extension compilation", () => {
    expect(packageJson.scripts?.["package:mac"]).toContain("electron-builder --mac dir --universal");
    expect(packageJson.scripts?.["dist:mac"]).toContain("scripts/create-dmg.mjs");
    expect(packageJson.dependencies?.typescript).toBe("6.0.3");
    expect(packageJson.dependencies?.["@earendil-works/pi-coding-agent"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.devDependencies?.["electron-builder"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // Real `pnpm package:win` is a Windows-host / windows-latest CI gate (G13), not a Linux gate.
  it("adds Windows packaging scripts without renaming mac package scripts", () => {
    const packageMac = packageJson.scripts?.["package:mac"] ?? "";
    const packageWin = packageJson.scripts?.["package:win"] ?? "";
    const packageWinDir = packageJson.scripts?.["package:win:dir"] ?? "";

    // mac scripts remain additive and complete (G09 / G13).
    expect(packageMac).toContain("electron-builder --mac dir --universal");
    expect(packageMac).toContain("scripts/adhoc-sign-mac-app.mjs");
    expect(packageJson.scripts?.["dist:mac"]).toContain("scripts/create-dmg.mjs");

    // Full installer package (not dir-only).
    expect(packageWin).toContain("pnpm build");
    expect(packageWin).toContain("electron-builder --win --x64");
    expect(packageWin).toContain("--config electron-builder.dev.yml");
    expect(packageWin).toContain("--publish never");
    expect(packageWin).not.toMatch(/electron-builder --win dir\b/);

    // Unpacked dir smoke (G13).
    expect(packageWinDir).toContain("pnpm build");
    expect(packageWinDir).toContain("electron-builder --win dir --x64");
    expect(packageWinDir).toContain("--config electron-builder.dev.yml");
    expect(packageWinDir).toContain("--publish never");

    // Cross-platform release clean for Windows hosts (cmd has no `rm -rf`).
    for (const script of [packageWin, packageWinDir]) {
      expect(script).toMatch(/fs\.rmSync\(['"]release['"]/);
      expect(script).not.toMatch(/(?:^|&&\s*)rm\s+-rf\s+release/);
    }
  });

  it("uses an electron-builder that handles pnpm deduped dependencies (>= 26.8.2)", () => {
    // electron-builder <= 26.8.1 misparses pnpm's `pnpm list --json` output once pnpm
    // (>= 10.29.3) emits "deduped" stubs: a package reached via multiple paths is read as
    // having no dependencies, so its transitive deps are dropped from the asar. That shipped
    // a broken 0.1.4 that crashed on launch with ERR_MODULE_NOT_FOUND for @jridgewell/resolve-uri.
    // electron-builder #9618 (released in 26.8.2) fixes the collector. Never downgrade below it.
    const version = packageJson.devDependencies?.["electron-builder"] ?? "0.0.0";
    const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10));
    const atLeast = major > 26 || (major === 26 && (minor > 8 || (minor === 8 && patch >= 2)));
    expect(atLeast).toBe(true);
  });

  it("packages local/dev mac builds under a distinct bundle identity so they cannot shadow the released app", async () => {
    expect(packageJson.scripts?.["package:mac"]).toContain("--config electron-builder.dev.yml");
    const devConfig = await readFile(resolve(import.meta.dirname, "../electron-builder.dev.yml"), "utf8");
    expect(devConfig).toContain("extends: ./electron-builder.yml");
    expect(devConfig).toContain("appId: com.kunchenguid.baby-menu.dev");
    expect(devConfig).toContain("productName: Baby Menu Dev");
  });

  it("declares an unsigned electron-builder mac bundle with extension templates", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");

    expect(config).toContain("appId: com.kunchenguid.baby-menu");
    expect(config).toContain("to: extensions-template");
    expect(config).toContain("babymenu-env.d.ts");
    expect(config).toContain("kimi-code-quota/**");
    expect(config).toContain("@earendil-works/pi-tui/**");
    // Tray extraResources block ships mac Template assets and Windows non-template icons (G06).
    expect(config).toMatch(
      /from:\s*assets\/tray\s*\n\s*to:\s*tray\s*\n\s*filter:\s*\n\s*-\s*baby_menuTemplate\*\.png\s*\n\s*-\s*baby_menu\.png\s*\n\s*-\s*baby_menu@2x\.png/,
    );
    expect(config).toContain("identity: null");
    expect(config).toContain("hardenedRuntime: false");
    expect(config).toContain("icon: assets/app-icon.icns");
    expect(config).toContain("asarUnpack:");
    expect(config).toContain("out/adapters/**");
    await expect(stat(resolve(import.meta.dirname, "../assets/app-icon.svg")).then((file) => file.isFile())).resolves.toBe(true);
    await expect(stat(resolve(import.meta.dirname, "../assets/app-icon.icns")).then((file) => file.isFile())).resolves.toBe(true);
    for (const trayAsset of [
      "baby_menuTemplate.png",
      "baby_menuTemplate@2x.png",
      "baby_menu.png",
      "baby_menu@2x.png",
    ]) {
      await expect(
        stat(resolve(import.meta.dirname, "../assets/tray", trayAsset)).then((file) => file.isFile()),
      ).resolves.toBe(true);
    }
  });

  it("declares an unsigned electron-builder Windows win block with NSIS + portable x64 targets", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");

    // Targets and arch (G03); each target binds its own x64 without spanning siblings.
    expect(config).toMatch(/\bwin:\s*\n[\s\S]*?target:\s*\n[\s\S]*?nsis[\s\S]*?portable/);
    expect(config).toMatch(/target:\s*nsis\s*\n\s*arch:\s*\n\s*-\s*x64/);
    expect(config).toMatch(/target:\s*portable\s*\n\s*arch:\s*\n\s*-\s*x64/);
    // No Windows arm64 overnight (G03 / out of scope).
    const winSection = config.match(/\bwin:\n([\s\S]*?)(?=\n(?:nsis|portable|dmg|mac|linux):|\n*$)/)?.[1] ?? "";
    expect(winSection).not.toMatch(/arm64/);

    // Unsigned overnight (G22) — documented e-b 26 field under signtoolOptions; no cert paths.
    expect(config).toMatch(/signtoolOptions:\s*\n\s*sign:\s*null/);
    expect(config).toMatch(/\bwin:[\s\S]*?verifyUpdateCodeSignature:\s*false/);
    expect(config).not.toMatch(/certificateFile|certificateSubjectName|CSC_LINK/);

    // Block-scoped NSIS / portable options and artifact names (G03).
    expect(config).toMatch(
      /\bnsis:\s*\n\s*artifactName:\s*Baby-Menu-\$\{version\}-win-x64\.exe\s*\n\s*oneClick:\s*false\s*\n\s*allowToChangeInstallationDirectory:\s*true/,
    );
    expect(config).toMatch(
      /\bportable:\s*\n\s*artifactName:\s*Baby-Menu-\$\{version\}-win-x64-portable\.exe/,
    );

    // Adapters stay unpacked for both platforms.
    expect(config).toContain("asarUnpack:");
    expect(config).toContain("out/adapters/**");
    // Tray extraResources still include Windows non-template icons.
    expect(config).toContain("baby_menu.png");
    expect(config).toContain("baby_menu@2x.png");
    expect(config).toContain("baby_menuTemplate*.png");
    // mac packaging unchanged.
    expect(config).toContain("identity: null");
    expect(config).toContain("artifactName: Baby-Menu-${version}-universal.dmg");
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
    expect(workflow).toContain('uninstall quit: "com.kunchenguid.baby-menu"');
    expect(workflow).toContain("uninstall_preflight do");
    expect(workflow).toContain('system("/usr/bin/pgrep", "-x", "Baby Menu"');
    expect(workflow).toContain('nohup", args: ["/bin/sh", "-c"');
    expect(workflow).toContain('while [ -e "#{appdir}/Baby Menu.app" ]; do');
    expect(workflow).toContain('/usr/bin/open -a "#{appdir}/Baby Menu.app"');
    expect(workflow).not.toContain("baby-menu.relaunch");
    expect(workflow).not.toContain("/tmp/com.kunchenguid.baby-menu");
    expect(workflow).not.toContain("tags:");
    await expect(stat(resolve(import.meta.dirname, "../.github/workflows/release.yml"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // macOS Homebrew cask shell syntax; /bin/bash and /bin/sh are absent on windows-latest.
  it.skipIf(process.platform === "win32")(
    "generates a syntactically valid Homebrew relaunch shell script",
    async () => {
      const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");
      const caskTemplateMatch = workflow.match(/cat > "\$RUNNER_TEMP\/homebrew-tap\/Casks\/baby-menu\.rb" << CASK_EOF\n(?<template>[\s\S]*?)\n\s+CASK_EOF/);

      expect(caskTemplateMatch?.groups?.template).toBeDefined();

      const caskTemplate = (caskTemplateMatch?.groups?.template ?? "").replace(/^\s{10}/gm, "");
      const { stdout: generatedCask } = await execFileAsync("/bin/bash", [
        "-c",
        `cat << CASK_EOF\n${caskTemplate}\nCASK_EOF`,
      ], {
        env: {
          ...process.env,
          SHA256: "abc123",
          TAG_NAME: "baby-menu-v1.2.3",
          VERSION: "1.2.3",
        },
      });
      const scriptMatch = generatedCask.match(/<<~RELAUNCH_SCRIPT\], must_succeed: false\n(?<script>[\s\S]*?)\n\s*RELAUNCH_SCRIPT/);

      expect(scriptMatch?.groups?.script).toBeDefined();

      const script = (scriptMatch?.groups?.script ?? "")
        .replace(/^\s{14}/gm, "")
        .replaceAll("#{appdir}", "/Applications");

      await expect(execFileAsync("/bin/sh", ["-n", "-c", script])).resolves.toBeDefined();
    },
  );

  it("adds a windows-latest CI job for typecheck, test, build, and package:win without dropping ubuntu gates", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");

    // Job ids and runners (G10).
    expect(workflow).toMatch(/^\s{2}check:\s*$/m);
    expect(workflow).toMatch(/^\s{2}windows:\s*$/m);
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).toContain("runs-on: windows-latest");

    // Ubuntu keeps the contract-types check; Windows does not need to re-run it.
    expect(workflow).toContain("Verify generated contract types are up to date");
    expect(workflow).toContain("pnpm generate:contracts");
    expect(workflow).toContain("extensions/babymenu-env.d.ts");

    // Windows packaging job shape.
    expect(workflow).toContain("CSC_IDENTITY_AUTO_DISCOVERY");
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain("pnpm package:win");
    expect(workflow).toMatch(/timeout-minutes:\s*45/);

    // Artifact upload for NSIS + portable (G03).
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("release/Baby-Menu-*-win-x64.exe");
    expect(workflow).toContain("release/Baby-Menu-*-win-x64-portable.exe");

    // Script-level --publish never is the publish guard; CI just runs package:win.
    expect(packageJson.scripts?.["package:win"]).toContain("--publish never");
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
