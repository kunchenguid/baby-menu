import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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

describe("packaged runtime verification", () => {
  it("recursively rejects esbuild nested in unpacked dependencies", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "baby-menu-packaged-esbuild-"));
    const nestedEsbuildPath = join(
      tempDirectory,
      "Baby Menu Dev.app",
      "Contents",
      "Resources",
      "app.asar.unpacked",
      "node_modules",
      "acpx",
      "node_modules",
      "esbuild",
    );
    await mkdir(nestedEsbuildPath, { recursive: true });

    try {
      const verificationScript = resolve(
        import.meta.dirname,
        "../scripts/e2e-packaged-mac-app.mjs",
      );
      const invocation = [
        `import(${JSON.stringify(verificationScript)})`,
        `.then(({ assertNoPackagedEsbuild }) => assertNoPackagedEsbuild(${JSON.stringify(join(tempDirectory, "Baby Menu Dev.app"))}))`,
      ].join("");
      await expect(execFileAsync(process.execPath, ["--input-type=module", "--eval", invocation]))
        .rejects.toMatchObject({
          stderr: expect.stringContaining(nestedEsbuildPath),
        });
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
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
    const electronViteConfig = await readFile(resolve(import.meta.dirname, "../electron.vite.config.ts"), "utf8");
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
    expect(config).toContain("- baby_menu*.png");
    expect(config).not.toContain("identity: null");
    expect(config).toContain("hardenedRuntime: true");
    expect(config).toContain("gatekeeperAssess: false");
    expect(config).toContain("entitlements: assets/entitlements.mac.plist");
    expect(config).toContain("entitlementsInherit: assets/entitlements.mac.plist");
    expect(config).toContain("notarize: true");
    expect(config).toContain("icon: assets/app-icon.icns");
    expect(config).toContain("!node_modules/esbuild/**");
    expect(config).toContain("!node_modules/@esbuild/**");
    expect(config).not.toMatch(/x64ArchFiles:.*(?:@esbuild|esbuild)/);
    expect(electronViteConfig).toContain("plugins: [externalizeDepsPlugin()]");
    expect(electronViteConfig).not.toContain('exclude: ["acpx"]');
    expect(packageJson.devDependencies?.["@electron/asar"]).toBe("3.4.1");

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
    expect(workflow).toContain("github.event_name == 'workflow_dispatch' && github.sha || format('refs/tags/{0}', env.TAG_NAME)");
    expect(workflow).toContain('if [ "$GITHUB_REF" != "refs/heads/main" ]');
    expect(workflow).toContain('if [ "$TAG_NAME" != "baby-menu-v0.1.23" ] || [ "$VERSION" != "0.1.23" ]');
    expect(workflow).toContain('ACTUAL_COMMIT="$(git rev-parse HEAD)"');
    expect(workflow).toContain('if [ "$ACTUAL_COMMIT" != "$GITHUB_SHA" ]');
    expect(workflow).toContain('PACKAGE_VERSION="$(node -p "require(\'./package.json\').version")"');
    expect(workflow).toContain('if [ "$PACKAGE_VERSION" != "$VERSION" ]');
    expect(workflow).not.toContain('EXPECTED_COMMIT="a8fd9cf3cda01277358a8b5e225e2ace7b0c0593"');
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
    expect(workflow).not.toContain("node_modules/@esbuild/");
    expect(workflow).not.toContain("node_modules/esbuild/");
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
    expect(packagedRuntimeE2e).toContain('from "@electron/asar"');
    expect(packagedRuntimeE2e).toContain("assertNoPackagedEsbuild");
    expect(packagedRuntimeE2e).toContain("window.babyMenu.agent.send");
    expect(packagedRuntimeE2e).toContain("agent:prompt:done");
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
    const recoverySourceIndex = workflow.indexOf("Verify manual recovery source");
    const credentialsIndex = workflow.indexOf("Restore App Store Connect API key");
    expect(recoveryTargetIndex).toBeGreaterThan(-1);
    expect(checkoutIndex).toBeGreaterThan(recoveryTargetIndex);
    expect(recoverySourceIndex).toBeGreaterThan(checkoutIndex);
    expect(credentialsIndex).toBeGreaterThan(recoverySourceIndex);

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

describe("linux packaging configuration", () => {
  it("builds all four Linux package formats under stable executable name", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");

    expect(config).toContain("- AppImage");
    expect(config).toContain("- deb");
    expect(config).toContain("- rpm");
    expect(config).toContain("- pacman");
    // production gate in src/main/app.ts matches basename(exe) exactly,
    // documented Hyprland windowrule matches class:^(baby-menu)$.
    // Anchored to the exact line, like category below: a bare substring match would
    // also pass if this key landed under mac: at the wrong indent (where it does
    // nothing), and the trailing $ is what rejects the dev build's baby-menu-dev.
    expect(config).toMatch(/^ {2}executableName: baby-menu$/m);
    expect(config).toContain("StartupWMClass: baby-menu");
    // Terminal is deliberately absent: LinuxTargetHelper.js's computeDesktopEntry seeds
    // Terminal="false" before spreading targetSpecificOptions.desktop?.entry, so restating
    // it under desktop.entry changes nothing. Do not reintroduce it.
    // desktop.entry.Categories is dead in app-builder-lib@26.8.2: LinuxTargetHelper.js's
    // computeDesktopEntry spreads targetSpecificOptions.desktop?.entry last, but its
    // subsequent (~line 159) `desktopMeta.Categories = ...` unconditionally overwrites it
    // from the top-level linux.category, so a desktop.entry.Categories key is silently
    // ignored there. Do not reintroduce it under desktop.entry.
    const desktopEntryBlock = config.match(/desktop:\n {4}entry:\n(?: {6}.+\n)+/)?.[0];
    expect(desktopEntryBlock).toBeDefined();
    expect(desktopEntryBlock).not.toContain("Categories");
    expect(desktopEntryBlock).not.toContain("Terminal");
    expect(config).toContain("icon: assets/app-icon-512.png");
    // Pinned to the exact line: a bare "category: Utility" would satisfy a substring
    // match but would not produce the spec's Categories=Utility;Development; desktop
    // entry value (see LinuxTargetHelper.js line ~159, referenced above).
    expect(config).toMatch(/^ {2}category: Utility;Development$/m);
    expect(config).toContain("maintainer: Kun Chen <kunchenguid@users.noreply.github.com>");
    expect(config).toContain("artifactName: baby-menu-${version}-${arch}.${ext}");

    // macOS tray filter widened to cover the Linux tray icon too.
    expect(config).toContain("baby_menu*.png");
    expect(config).not.toContain("baby_menuTemplate*.png");

    await expect(
      stat(resolve(import.meta.dirname, "../assets/tray/baby_menu-linux.png")).then((file) => file.isFile()),
    ).resolves.toBe(true);
    await expect(
      stat(resolve(import.meta.dirname, "../assets/app-icon-512.png")).then((file) => file.isFile()),
    ).resolves.toBe(true);
  });

  it("documents exactly the Linux artifact filenames electron-builder will emit", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");
    const readme = await readFile(resolve(import.meta.dirname, "../README.md"), "utf8");

    // builder-util is a transitive dependency, so resolve it through
    // electron-builder rather than from this package's own node_modules root.
    const requireHere = createRequire(import.meta.url);
    const { Arch, getArtifactArchName } = createRequire(requireHere.resolve("electron-builder"))("builder-util") as {
      Arch: Record<string, number>;
      getArtifactArchName: (arch: number, ext: string) => string;
    };

    const linuxBlock = config.match(/^linux:\n(?:^(?!\S).*\n?)*/m)?.[0];
    const artifactName = linuxBlock?.match(/^ {2}artifactName: (?<pattern>.+)$/m)?.groups?.pattern;
    const targets = linuxBlock?.match(/^ {2}target:\n(?: {4}- .+\n)+/m)?.[0].match(/(?<= {4}- ).+/g);
    expect(artifactName).toBeDefined();
    expect(targets).toEqual(["AppImage", "deb", "rpm", "pacman"]);

    // ${ext} is the fpm target name itself, and ${arch} goes through
    // getArtifactArchName, which maps x64 per target rather than uniformly: the
    // README's four suffixes are not interchangeable and cannot be eyeballed.
    // Both sides are derived, so this fails if the README, the target list, or
    // the artifactName pattern moves without the others.
    const emitted = targets?.map((target) =>
      artifactName
        ?.replace("${version}", "<version>")
        .replace("${arch}", getArtifactArchName(Arch.x64, target))
        .replace("${ext}", target),
    );
    const documented = readme.match(/baby-menu-<version>-[\w.]+/g);

    expect([...new Set(documented)].sort()).toEqual([...new Set(emitted)].sort());
  });

  it("packages local/dev Linux builds under a distinct dev-only executable name so autostart never installed one", async () => {
    const devConfig = await readFile(resolve(import.meta.dirname, "../electron-builder.dev.yml"), "utf8");

    expect(devConfig).toContain("executableName: baby-menu-dev");
  });

  it("keeps local/dev Linux packages from impersonating the released package", async () => {
    const devConfig = await readFile(resolve(import.meta.dirname, "../electron-builder.dev.yml"), "utf8");

    // fpm's package name comes from package.json#name unless overridden, so
    // without a per-target packageName a dev .deb/.rpm/.pacman installs as the
    // real `baby-menu` package and removes the released install.
    for (const target of ["deb", "rpm", "pacman"]) {
      expect(devConfig).toMatch(new RegExp(`^${target}:\\n  packageName: baby-menu-dev$`, "m"));
    }
    // packageName is a LinuxTargetSpecificOptions key; electron-builder's schema
    // sets additionalProperties: false on the top-level linux block and would
    // reject the whole config if it were declared there instead.
    const devLinuxBlock = devConfig.match(/^linux:\n(?:^(?!\S).*\n?)*/m)?.[0];
    expect(devLinuxBlock).toBeDefined();
    expect(devLinuxBlock).not.toContain("packageName:");
    expect(devConfig).toContain("artifactName: baby-menu-dev-${version}-${arch}.${ext}");
  });

  it("builds Linux packages on a glibc floor runner with rpm tooling installed", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");

    expect(workflow).toContain("  linux:");
    // Scoped to the linux job's own block, not the whole 200-line file: a bare
    // toContain("runs-on: ubuntu-22.04") would still pass even if this job's
    // runs-on regressed to ubuntu-latest, since the string can appear elsewhere.
    // Capture from the "  linux:" header up to (but excluding) the next
    // top-level (2-space indented) job key, then assert only within that block.
    const linuxJobBlock = workflow.match(/^ {2}linux:\n(?:^(?! {2}\S).*\n?)*/m)?.[0];
    expect(linuxJobBlock).toBeDefined();
    // glibc is a floor, not a ceiling: building on 24.04 produces .deb and .rpm
    // artifacts that will not install on Debian 12 or RHEL 9.
    expect(linuxJobBlock).toContain("runs-on: ubuntu-22.04");
    // The rpm target shells out to rpmbuild through fpm, and the pacman target
    // shells out to bsdtar (libarchive-tools) to generate .MTREE; deb is pure
    // fpm and AppImage pulls its own appimagetool.
    expect(linuxJobBlock).toContain("sudo apt-get install -y rpm libarchive-tools");
    expect(linuxJobBlock).toContain("electron-builder --linux --x64");
    expect(linuxJobBlock).toContain("group: ${{ github.workflow }}-linux-${{ inputs.tag_name");
    // Same telemetry wiring as the macOS job, so packaged Linux releases report
    // the same way.
    expect(linuxJobBlock).toContain("BABY_MENU_UMAMI_WEBSITE_ID: ${{ vars.BABY_MENU_UMAMI_WEBSITE_ID }}");
    // Ties the upload globs to the four targets actually configured in
    // electron-builder.yml (AppImage, deb, rpm, pacman - matching the
    // artifactName: baby-menu-${version}-${arch}.${ext} pattern, where ${ext}
    // is the fpm target name itself, e.g. "pacman" not "pkg.tar.zst"). This is
    // the seam a wrong extension previously fell through: the target list and
    // the upload globs were each individually plausible and never checked
    // against each other.
    expect(linuxJobBlock).toContain("release/*.AppImage");
    expect(linuxJobBlock).toContain("release/*.deb");
    expect(linuxJobBlock).toContain("release/*.rpm");
    expect(linuxJobBlock).toContain("release/*.pacman");
  });

  it("orders the macOS publish after the Linux job without hard-gating on it", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");

    expect(workflow).toContain("needs: [release-please, linux]");
    // The ordering gate is advisory until a real release proves the fpm targets.
    // always() plus no result check means a failing Linux job cannot strand the
    // release as a permanent draft with no DMG published, while the Linux job
    // still runs first and still reports its real status. Anchored to the macOS
    // job's own if: line, because the surrounding comment names the hard-gate
    // expression this should tighten to once those targets are proven.
    const macosJobBlock = workflow.match(/^ {2}macos:\n(?:^(?! {2}\S).*\n?)*/m)?.[0];
    expect(macosJobBlock).toBeDefined();
    const macosIfLine = macosJobBlock?.match(/^ {4}if: .*$/m)?.[0];
    expect(macosIfLine).toBeDefined();
    expect(macosIfLine).not.toContain("needs.linux.result");
  });

  it("applies the same draft and recovery guards to the Linux job as to the macOS job", async () => {
    const workflow = await readFile(resolve(import.meta.dirname, "../.github/workflows/release-please.yml"), "utf8");

    expect(workflow.match(/Verify release is still draft/g)).toHaveLength(2);
    expect(workflow.match(/Validate manual recovery target/g)).toHaveLength(2);
    expect(workflow.match(/Verify manual recovery source/g)).toHaveLength(2);
    expect(
      workflow.match(
        /ref: \$\{\{ github\.event_name == 'workflow_dispatch' && github\.sha \|\| format\('refs\/tags\/\{0\}', env\.TAG_NAME\) \}\}/g,
      ),
    ).toHaveLength(2);

    // Counting step names only proves both copies exist, not that they still say the
    // same thing: a mistranscribed body (a flipped true/false arm, a dropped exit 1)
    // would keep every count above at 2. The duplication is deliberate (the guards are
    // copied verbatim from the macOS job rather than extracted), so drift between the
    // two copies is the standing risk, and byte equality is what actually guards it.
    // Captures the whole duplicated span (the three guard steps plus the checkout
    // step interleaved between them), stopping at the first step that belongs to
    // neither: pnpm/action-setup in the Linux job, Verify macOS release tools in
    // the macOS one.
    const guardBlocks = workflow.match(
      /^ {6}- name: Validate manual recovery target\n[\s\S]*?(?=^ {6}- (?!name: (?:Validate manual recovery target|Verify manual recovery source|Verify release is still draft)|uses: actions\/checkout@v6))/gm,
    );
    expect(guardBlocks).toHaveLength(2);
    expect(guardBlocks?.[0]).toBe(guardBlocks?.[1]);
  });
});
