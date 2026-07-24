import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import packageJson from "../package.json";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function releaseDraftGuard(): Promise<string> {
  const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");
  const match = workflow.match(/- name: Verify release is still draft\n[\s\S]*?        run: \|\n(?<script>(?: {10}.*\n)+)/);
  if (!match?.groups?.script) {
    throw new Error("Could not find the release draft guard in the release workflow");
  }
  return match.groups.script.replace(/^ {10}/gm, "");
}

async function runReleaseDraftGuard(releaseState: "true" | "false" | "missing" | "query-error") {
  const tempDirectory = await mkdtemp(join(tmpdir(), "baby-menu-release-guard-"));
  const ghPath = join(tempDirectory, "gh");
  await writeFile(
    ghPath,
    `#!/bin/sh\ncase "$*" in\n  *releases/tags/*) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;\nesac\nif [ "$GH_RELEASE_STATE" = "query-error" ]; then echo "gh: API unavailable (HTTP 503)" >&2; exit 1; fi\nif [ "$GH_RELEASE_STATE" != "missing" ]; then printf '%s\\n' "$GH_RELEASE_STATE"; fi\n`,
  );
  await chmod(ghPath, 0o755);

  try {
    return await execFileAsync("/bin/bash", ["-c", await releaseDraftGuard()], {
      env: {
        ...process.env,
        GITHUB_REPOSITORY: "kunchenguid/baby-menu",
        TAG_NAME: "baby-menu-v0.1.23",
        GH_RELEASE_STATE: releaseState,
        PATH: `${tempDirectory}:${process.env.PATH ?? ""}`,
      },
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

describe("release draft guard", () => {
  it("passes when the tagged release exists as a draft", async () => {
    await expect(runReleaseDraftGuard("true")).resolves.toBeDefined();
  });

  it("refuses when the tagged release is already published", async () => {
    await expect(runReleaseDraftGuard("false")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Refusing to build artifacts for a release that is already public: baby-menu-v0.1.23",
      ),
    });
  });

  it("fails distinctly when no release exists for the tag", async () => {
    await expect(runReleaseDraftGuard("missing")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "No GitHub release exists for tag baby-menu-v0.1.23; refusing to build artifacts.",
      ),
    });
  });

  it("fails explicitly when GitHub release state cannot be queried", async () => {
    await expect(runReleaseDraftGuard("query-error")).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Unable to verify draft status for baby-menu-v0.1.23; GitHub release query failed: gh: API unavailable (HTTP 503)",
      ),
    });
  });
});

describe("distribution config", () => {
  it("adds mac packaging scripts and keeps TypeScript available at runtime for extension compilation", () => {
    expect(packageJson.scripts?.["package:mac"]).toContain("electron-builder --mac dir --universal");
    expect(packageJson.scripts?.["dist:mac"]).toContain("scripts/create-dmg.mjs");
    expect(packageJson.dependencies?.typescript).toBe("6.0.3");
    expect(packageJson.devDependencies?.["electron-builder"]).toMatch(/^\d+\.\d+\.\d+$/);
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

  it("configures production Developer ID signing and keeps local packages ad-hoc", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");
    const devConfig = await readFile(resolve(import.meta.dirname, "../electron-builder.dev.yml"), "utf8");
    const entitlements = await readFile(resolve(import.meta.dirname, "../assets/entitlements.mac.plist"), "utf8");
    const localSigner = await readFile(
      resolve(import.meta.dirname, "../scripts/adhoc-sign-mac-app.mjs"),
      "utf8",
    );

    expect(config).toContain("appId: com.kunchenguid.baby-menu");
    expect(config).toContain("to: extensions-template");
    expect(config).toContain("babymenu-env.d.ts");
    expect(config).toContain("hello-world/**");
    expect(config).toContain("to: tray");
    expect(config).toContain("baby_menuTemplate*.png");
    expect(config).not.toContain("identity: null");
    expect(config).toContain("hardenedRuntime: true");
    expect(config).toContain("gatekeeperAssess: false");
    expect(config).toContain("entitlements: assets/entitlements.mac.plist");
    expect(config).toContain("entitlementsInherit: assets/entitlements.mac.plist");
    expect(config).toContain("notarize: true");
    expect(config).toContain("icon: assets/app-icon.icns");

    expect(devConfig).toContain("identity: null");
    expect(devConfig).toContain("notarize: false");
    expect(packageJson.scripts?.["package:mac"]).toContain("CSC_IDENTITY_AUTO_DISCOVERY=false");
    expect(localSigner).toContain('spawnSync("file", ["-b", candidate]');
    expect(localSigner).toContain('right.split("/").length - left.split("/").length');
    expect(localSigner).toContain('run("codesign", ["--force", "--sign", "-", candidate])');
    expect(localSigner.indexOf('run("codesign", ["--force", "--sign", "-", candidate])'))
      .toBeLessThan(localSigner.indexOf('run("codesign", ["--force", "--deep", "--sign", "-", appPath])'));

    const entitlementKeys = [...entitlements.matchAll(/<key>(com\.apple\.security\.[^<]+)<\/key>/g)]
      .map((match) => match[1]);
    expect(entitlementKeys).toEqual(["com.apple.security.cs.allow-jit"]);
    expect(entitlements).not.toContain("com.apple.security.cs.allow-unsigned-executable-memory");
    await expect(stat(resolve(import.meta.dirname, "../assets/app-icon.svg")).then((file) => file.isFile())).resolves.toBe(true);
    await expect(stat(resolve(import.meta.dirname, "../assets/app-icon.icns")).then((file) => file.isFile())).resolves.toBe(true);
  });

  it("signs, notarizes, and verifies the publication-ready DMG before publishing it", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");
    const packagedRuntimeE2e = await readFile(
      resolve(import.meta.dirname, "../scripts/e2e-packaged-mac-app.mjs"),
      "utf8",
    );

    expect(workflow).toContain("googleapis/release-please-action@v4");
    expect(workflow).toContain("branches:");
    expect(workflow).toContain("- main");
    expect(workflow).toContain("baby-menu-release-created: ${{ steps.release.outputs.release_created }}");
    expect(workflow).toContain("baby-menu-tag-name: ${{ steps.release.outputs.tag_name }}");
    expect(workflow).toContain("baby-menu-version: ${{ steps.release.outputs.version }}");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("needs.release-please.outputs.baby-menu-release-created == 'true'");
    expect(workflow).toContain("group: ${{ github.workflow }}-macos-${{ inputs.tag_name");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("ref: refs/tags/${{ env.TAG_NAME }}");
    expect(workflow).toContain('if [ "$TAG_NAME" != "baby-menu-v0.1.23" ] || [ "$VERSION" != "0.1.23" ]');
    expect(workflow).toContain('EXPECTED_COMMIT="a8fd9cf3cda01277358a8b5e225e2ace7b0c0593"');
    expect(workflow).toContain('ACTUAL_COMMIT="$(git rev-parse HEAD)"');
    expect(workflow).toContain("TEAM_ID: 9T2J7MNUP9");
    expect(workflow).toContain("BUNDLE_ID: com.kunchenguid.baby-menu");
    for (const secret of [
      "MAC_DEVELOPER_ID_CERT_P12",
      "MAC_DEVELOPER_ID_CERT_PASSWORD",
      "APP_STORE_CONNECT_KEY_ID",
      "APP_STORE_CONNECT_ISSUER_ID",
      "APP_STORE_CONNECT_API_KEY",
    ]) {
      expect(workflow).toContain(`secrets.${secret}`);
      expect(workflow).toContain(`Missing ${secret}`);
    }
    expect(workflow).toContain("CSC_LINK: ${{ steps.developer_id_cert.outputs.csc_link }}");
    expect(workflow).toContain("CSC_KEY_PASSWORD: ${{ secrets.MAC_DEVELOPER_ID_CERT_PASSWORD }}");
    expect(workflow).toContain("APPLE_API_KEY: ${{ steps.asc-key.outputs.key_path }}");
    expect(workflow).toContain("pnpm exec electron-builder --mac dir --universal");
    expect(workflow).not.toContain("codesign --force --deep --sign -");
    expect(workflow).toContain("xcrun notarytool submit \"$DMG_PATH\"");
    expect(workflow).toContain("--wait");
    expect(workflow).toContain('xcrun stapler staple "$DMG_PATH"');
    expect(workflow).toContain("Verify publication-ready signed and notarized DMG");
    expect(workflow).toContain('codesign --verify --deep --strict --verbose=4 "$APP_PATH"');
    expect(workflow).toContain('TeamIdentifier=$TEAM_ID');
    expect(workflow).toContain('Identifier=$BUNDLE_ID');
    expect(workflow).toContain("Authority=Developer ID Application: Kun Chen ($TEAM_ID)");
    expect(workflow).toContain("flags=.*runtime");
    expect(workflow).toContain("^Timestamp=.+$");
    expect(workflow).toContain("verify_code_object");
    expect(workflow).toContain('codesign -d --arch "$architecture" --verbose=4 "$code_object"');
    expect(workflow).toContain('verify_code_object "$candidate" arm64');
    expect(workflow).toContain('verify_code_object "$candidate" x86_64');
    expect(workflow).toContain('verify_code_object "$candidate" "$expected_architecture"');
    expect(workflow).toContain("verify_entitlements");
    expect(workflow).toContain('python3 scripts/verify-macos-entitlements.py');
    expect(workflow).toContain('--arch "$architecture" --entitlements - --xml');
    expect(workflow).toContain("--require-jit");
    expect(workflow).toContain('Contents/MacOS/*|Contents/Frameworks/*.app/Contents/MacOS/*)');
    expect(workflow).toContain('verify_entitlements "$candidate" arm64 "$require_jit"');
    expect(workflow).toContain('verify_entitlements "$candidate" x86_64 "$require_jit"');
    expect(workflow).toContain("verify_macho_architectures");
    expect(workflow).toContain('if [ "$architectures" = "arm64 x86_64" ]');
    expect(workflow).toContain("node_modules/@esbuild/darwin-arm64/bin/esbuild");
    expect(workflow).toContain("node_modules/@tailwindcss/oxide-darwin-arm64/tailwindcss-oxide.darwin-arm64.node");
    expect(workflow).toContain("node_modules/lightningcss-darwin-arm64/lightningcss.darwin-arm64.node");
    expect(workflow).toContain('if [ ! -f "$counterpart" ]');
    expect(workflow).toContain("Missing paired $counterpart_architecture native prebuilt");
    expect(workflow).toContain("file -b \"$candidate\"");
    expect(workflow).toContain('spctl --assess --type execute --verbose=4 "$APP_PATH"');
    expect(workflow).toContain("source=Notarized Developer ID");
    expect(workflow).toContain('xcrun stapler validate "$APP_PATH"');
    expect(workflow).toContain('xcrun stapler validate "$DMG_PATH"');
    expect(workflow).toContain('node scripts/e2e-packaged-mac-app.mjs "$APP_PATH"');
    expect(workflow).toContain("CFBundleShortVersionString");
    expect(workflow).toContain('lipo "$APP_EXECUTABLE" -verify_arch arm64 x86_64');
    expect(workflow).toContain('ARCHITECTURES" != "arm64 x86_64"');

    expect(workflow).toContain("Verify release is still draft");
    expect(workflow).toContain('gh api --paginate "repos/${GITHUB_REPOSITORY}/releases?per_page=100"');
    expect(workflow).not.toContain('releases/tags/${TAG_NAME}');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("tag_name:");
    expect(workflow).toContain("version:");

    const recoveryTargetIndex = workflow.indexOf("Validate manual recovery target");
    const checkoutIndex = workflow.indexOf("actions/checkout@v6");
    const recoveryCommitIndex = workflow.indexOf("Verify manual recovery commit");
    const credentialsIndex = workflow.indexOf("Restore App Store Connect API key");
    expect(recoveryTargetIndex).toBeGreaterThan(-1);
    expect(checkoutIndex).toBeGreaterThan(recoveryTargetIndex);
    expect(recoveryCommitIndex).toBeGreaterThan(checkoutIndex);
    expect(credentialsIndex).toBeGreaterThan(recoveryCommitIndex);

    const verifyIndex = workflow.indexOf("Verify publication-ready signed and notarized DMG");
    const runtimeE2eIndex = workflow.indexOf('node scripts/e2e-packaged-mac-app.mjs "$APP_PATH"');
    const checksumIndex = workflow.indexOf("Compute SHA256");
    const uploadIndex = workflow.indexOf("Upload DMG to draft release");
    const publishIndex = workflow.indexOf("Publish verified release");
    const caskIndex = workflow.indexOf("Update Homebrew Cask");
    expect(verifyIndex).toBeGreaterThan(-1);
    expect(runtimeE2eIndex).toBeGreaterThan(verifyIndex);
    expect(checksumIndex).toBeGreaterThan(runtimeE2eIndex);
    expect(uploadIndex).toBeGreaterThan(checksumIndex);
    expect(publishIndex).toBeGreaterThan(uploadIndex);
    expect(caskIndex).toBeGreaterThan(publishIndex);
    expect(workflow).toContain('gh release edit "$TAG_NAME" --draft=false');
    expect(packagedRuntimeE2e).toContain('join(testAppDataRoot, "preferences.json")');
    expect(packagedRuntimeE2e).toContain("openAtLogin: false");
    expect(packagedRuntimeE2e.indexOf("openAtLogin: false")).toBeLessThan(packagedRuntimeE2e.indexOf("spawn(executablePath"));

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

  it("generates a syntactically valid Homebrew relaunch shell script", async () => {
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
  });

  it("declares release-please manifest mode for the Baby Menu package", async () => {
    const config = JSON.parse(await readFile(resolve(import.meta.dirname, "../release-please-config.json"), "utf8"));
    const manifest = JSON.parse(await readFile(resolve(import.meta.dirname, "../.release-please-manifest.json"), "utf8"));

    expect(config).toMatchObject({
      $schema: "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": true,
      "include-component-in-tag": true,
      draft: true,
      "force-tag-creation": true,
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
