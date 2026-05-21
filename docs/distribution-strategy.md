# Baby Menu Distribution Strategy

This document records the distribution design for Baby Menu as a real macOS app without Developer ID signing or notarization.
The implemented app now includes packaging, runtime path changes, production extension loading, release automation, and Homebrew Cask distribution wiring.

## Goals

- Ship Baby Menu as a macOS menu-bar app, not as a source checkout that users run with a direct `electron-vite dev` script.
- Preserve the core product behavior where an embedded agent can create or edit widgets while the app is running.
- Avoid a production Vite dev server.
- Avoid Developer ID signing and notarization for now.
- Install through a general Homebrew tap owned by Kun.
- Support autostart on login.
- Keep user-generated extensions and caches across app upgrades.
- Keep Save and Rollback semantics safe for end users.

## Non-Goals

- Do not submit to the Mac App Store.
- Do not use Sparkle or Electron auto-updaters initially.
- Do not require users to clone this repository.
- Do not require users to install Node or pnpm for the app itself.
- Do not solve installation or authentication for external agent CLIs such as Claude, Codex, or Pi.
- Do not support arbitrary npm dependencies inside generated extensions in the first packaged release.

## Target User Install Command

Use a general tap repository named `kunchenguid/homebrew-tap`.
Homebrew maps this to the tap token `kunchenguid/tap`.

The install command should be:

```sh
brew install --cask kunchenguid/tap/baby-menu
```

After installation, users should update with:

```sh
brew update
brew upgrade --cask baby-menu
```

If the tap has not already been added, the fully qualified cask token should tap it implicitly.
Users should not need to run a separate `brew tap` command.

## Current Implementation State

The repo now has source, packaged, and release paths.
`package.json` includes `package:mac` for a local ad-hoc-signed `.app` and `dist:mac` for a universal DMG.
`.github/workflows/release.yml` builds on `v*` tags, uploads the DMG to GitHub Releases, and updates `kunchenguid/homebrew-tap` when `HOMEBREW_TAP_TOKEN` is configured.

The production renderer path is wired for packaged mode.
`src/main/popover.ts` loads `ELECTRON_RENDERER_URL` in dev and falls back to `loadFile()` for `out/renderer/index.html` in production.
`pnpm build` creates `out/main`, `out/preload`, and `out/renderer` in the repo.

Packaged runtime state is package-safe.
`src/main/app-paths.ts` resolves packaged mutable state under `~/.baby-menu`, seeds bundled extension templates into `~/.baby-menu/extensions`, and keeps source-mode paths unchanged.

Production extension loading no longer depends on the Vite dev server.
Widgets and server actions compile into `~/.baby-menu/cache` in packaged mode, while dev mode keeps Vite `/@fs` widget imports.

Save and Rollback support both source and packaged runtimes.
Tracked source `extensions/` uses `GitChangeSession`; `extensions-dev/` and packaged `~/.baby-menu/extensions` use snapshot sessions.

Remaining operational setup is outside this repo.
The external `kunchenguid/homebrew-tap` repository must exist, and the release workflow needs a `HOMEBREW_TAP_TOKEN` secret with permission to push cask updates.

## Recommended Architecture

Use a packaged Electron shell with mutable extension state under `~/.baby-menu`.

Runtime layout:

```text
/Applications/Baby Menu.app
  Contents/
    MacOS/Baby Menu
    Resources/
      app.asar or app/
      extensions-template/
        AGENTS.md
        recipes/*.html
        hello-world/widget.tsx

~/.baby-menu/
  preferences.json
  extensions/
    AGENTS.md
    recipes/*.html
    <user-extension>/widget.tsx
    <user-extension>/server.ts
  cache/
    widgets/<hash>/*.mjs
    server-actions/<hash>/*.mjs
    acp-sessions/
    snapshots/
  .cache/baby-menu/agent-turns/
```

Source development layout remains mostly unchanged:

```text
repo/
  extensions/
  extensions-dev/
  .cache/
```

## Runtime Mode Matrix

| Mode | Renderer | Extension Workspace | Change Session | Widget Loader |
| --- | --- | --- | --- | --- |
| `pnpm dev` | Vite dev server | `repo/extensions-dev` | snapshot session | Vite `/@fs` |
| Packaged app | `out/renderer/index.html` | `app.getPath("home")/.baby-menu/extensions` | snapshot session | compiled module protocol |

## Packaged App Path Resolution

Add a main-process path resolver instead of using `process.cwd()` as the universal root.

Recommended new module:

```ts
// src/main/app-paths.ts
import { app } from "electron";
import { join } from "node:path";

export type BabyMenuRuntimePaths = {
  appDataRoot: string;
  extensionsDir: string;
  cacheDir: string;
  agentStateDir: string;
  devExtensionSnapshotDir: string;
  bundledExtensionTemplateDir: string | null;
};

export function resolveBabyMenuRuntimePaths(): BabyMenuRuntimePaths {
  if (!app.isPackaged) {
    const root = process.cwd();
    return {
      appDataRoot: root,
      extensionsDir: process.env.BABY_MENU_EXTENSIONS_DIR ?? join(root, "extensions"),
      cacheDir: join(root, ".cache", "baby-menu"),
      agentStateDir: join(root, ".cache", "baby-menu", "acp-sessions"),
      devExtensionSnapshotDir: join(root, ".cache", "baby-menu", "dev-extension-snapshots"),
      bundledExtensionTemplateDir: null,
    };
  }

  const root = join(app.getPath("home"), ".baby-menu");
  return {
    appDataRoot: root,
    extensionsDir: join(root, "extensions"),
    cacheDir: join(root, "cache"),
    agentStateDir: join(root, "cache", "acp-sessions"),
    devExtensionSnapshotDir: join(root, "cache", "snapshots"),
    bundledExtensionTemplateDir: join(process.resourcesPath, "extensions-template"),
  };
}
```

The exact shape can change, but the important design is that packaged mutable state lives under `~/.baby-menu`.
Do not write generated extensions, caches, snapshots, or agent sessions into the `.app` bundle.

## Extension Template Seeding

On packaged launch, copy bundled extension templates into `~/.baby-menu/extensions`.
This runs on first launch and after upgrades so newly bundled recipes or extensions are added to existing workspaces.

Seed these files:

- `extensions/AGENTS.md`
- `extensions/recipes/*.html`
- `extensions/hello-world/widget.tsx`

Do not overwrite existing user extensions or recipes during app upgrades.
Only missing template files are copied into the workspace.
For the first implementation, preserving existing user data is more important than automatic recipe replacement.

## Change Sessions In Packaged Mode

Packaged mode should use a filesystem snapshot session, not a git session.

The existing `DevExtensionChangeSession` already has the right basic semantics:

- Snapshot the extension workspace at the start of an agent turn.
- Save means accept current files and delete the snapshot.
- Rollback means restore the snapshot and delete it.

Refactor the change-session selection so packaged `~/.baby-menu/extensions` uses a snapshot session.
Only use `GitChangeSession` when the app is running from source and the active extension workspace is the tracked `repo/extensions` directory.

Recommended rule:

```text
if packaged:
  use SnapshotExtensionChangeSession
else if active extensions dir equals repo/extensions:
  use GitChangeSession
else:
  use SnapshotExtensionChangeSession
```

The renderer can keep showing Save and Rollback.
In packaged mode, Save should return `{ ok: true }` without a commit hash.

## Production Widget Compiler

Packaged production cannot import raw `widget.tsx` files through Vite `/@fs` URLs.
Add a production compiler and loader.

Recommended approach:

- Use TypeScript as a runtime dependency for transpilation.
- Compile each extension `widget.tsx` or `widget.ts` into cached `.mjs` files under `~/.baby-menu/cache/widgets`.
- Rewrite local imports so extensionless imports point at compiled `.mjs` files.
- Rewrite React imports to custom host shim URLs.
- Serve compiled widget modules through an Electron custom protocol.
- Keep Vite `/@fs` URLs only in dev mode.

This avoids shipping a production Vite server.
It also avoids runtime native compiler issues from tools such as esbuild in a universal app.

### Widget Compiler Inputs

The compiler should support these extension files:

- `widget.tsx`
- `widget.jsx`
- `widget.ts`
- `widget.js`
- local helper imports from the same extension directory

For v1, generated widgets should not import arbitrary npm packages.
They may import React APIs and local helper files.

### Widget Compiler Output

Example output:

```text
~/.baby-menu/cache/widgets/cpu-temp/<content-hash>/widget.mjs
~/.baby-menu/cache/widgets/cpu-temp/<content-hash>/helpers.mjs
```

The widget module descriptor returned to the renderer should use a custom protocol URL, for example:

```json
{
  "id": "cpu-temp.widget",
  "extensionId": "cpu-temp",
  "moduleUrl": "baby-menu-widget://cpu-temp/<content-hash>/widget.mjs"
}
```

### React Host Shims

The renderer should expose the React and JSX runtime used by the host app.
This avoids bundling a second copy of React inside widget modules.
Bundling a second React copy would break hooks in generated widgets.

Renderer setup example:

```ts
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";

window.__BABY_MENU_WIDGET_HOST__ = {
  React,
  jsxRuntime,
};
```

Add a global type declaration for `window.__BABY_MENU_WIDGET_HOST__`.

Register protocol modules that export from that host object:

```ts
// baby-menu-host://react/index.mjs
const React = window.__BABY_MENU_WIDGET_HOST__.React;
export const useState = React.useState;
export const useEffect = React.useEffect;
export const useRef = React.useRef;
export default React;

// baby-menu-host://react-jsx-runtime/index.mjs
const runtime = window.__BABY_MENU_WIDGET_HOST__.jsxRuntime;
export const jsx = runtime.jsx;
export const jsxs = runtime.jsxs;
export const Fragment = runtime.Fragment;
```

The compiler should rewrite imports like this:

```ts
import React from "react";
import { useState } from "react";
import { jsx } from "react/jsx-runtime";
```

to this:

```ts
import React from "baby-menu-host://react/index.mjs";
import { useState } from "baby-menu-host://react/index.mjs";
import { jsx } from "baby-menu-host://react-jsx-runtime/index.mjs";
```

### Electron Protocol Registration

Register custom protocols before creating the renderer window.

Use privileged schemes so dynamic imports work from a packaged renderer.

Example direction:

```ts
import { protocol } from "electron";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "baby-menu-widget",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: "baby-menu-host",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
```

The `baby-menu-widget` handler must only serve files from the widget compiler cache.
Validate and normalize paths before reading files.
Do not expose arbitrary filesystem reads through the protocol.

## Production Server Action Compiler

Packaged production should compile extension `server.ts` files before importing them in the main process.

Recommended approach:

- Reuse the TypeScript transpilation path used by widgets.
- Compile server action files into `~/.baby-menu/cache/server-actions/<hash>/*.mjs`.
- Preserve or rewrite local imports to compiled `.mjs` files.
- Leave Node built-in imports alone.
- Reject or clearly error on unsupported external npm imports.

The existing server action registry already discovers and reloads server action files.
Keep that behavior, but change the loader so the import target is compiled JavaScript, not raw TypeScript.

## Agent CLI Discovery In A GUI App

Packaged macOS apps launched from Finder or login items usually do not inherit the user's interactive shell `PATH`.
The app must handle this or it may fail to find `claude`, `codex`, `npx`, or other agent commands.

Recommended behavior:

- On startup, expand `process.env.PATH` with common Homebrew and user binary paths.
- Include `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`, and `~/.local/bin`.
- Optionally ask the user's login shell for PATH with `/bin/zsh -lc 'print -r -- $PATH'` and merge it.
- Keep `BABY_MENU_AGENT` override support.
- Show a clear in-app error if no supported agent command can be found.

This should be implemented before relying on autostart.
Autostart launches are especially likely to have a minimal environment.

## Autostart

Use Electron's login-item API from the app, not the Homebrew cask.

Recommended default:

- Open the packaged app at login by default.
- Add a setting in the app UI so users can opt out.
- Never enable login-item startup from source/dev mode.
- Persist the preference in user data.
- Call `app.setLoginItemSettings({ openAtLogin: true })` when enabled.
- Call `app.setLoginItemSettings({ openAtLogin: false })` when disabled.

For a packaged menu-bar utility, enabling autostart by default is acceptable when the opt-out setting is visible.
Do not rely on a LaunchAgent from the cask unless a future background daemon is introduced.

## Packaging Tool

Use `electron-builder` initially.
It fits the current Electron and electron-vite setup and can produce macOS `.app` bundles and DMGs.

Add dev dependency:

```sh
pnpm add -D electron-builder
```

Move TypeScript to runtime dependencies if the packaged app uses it as the production extension compiler:

```sh
pnpm add typescript
```

Keep Electron itself as a dev dependency.
The packaged app bundles Electron.

## Build Config Fix

Fix `electron.vite.config.ts` so renderer output is inside this repository at `out/renderer`.

The build acceptance check should be:

```text
out/main/index.js
out/preload/index.cjs
out/renderer/index.html
```

Add or update a regression test that fails if renderer output is configured outside the repo.

## Electron Builder Config

Recommended starting config in `electron-builder.yml`:

```yaml
appId: com.kunchenguid.baby-menu
productName: Baby Menu
copyright: Copyright © 2026 Kun Chen

directories:
  output: release

files:
  - out/**
  - package.json

extraResources:
  - from: extensions
    to: extensions-template
    filter:
      - AGENTS.md
      - recipes/**
      - hello-world/**

asar: true

mac:
  category: public.app-category.developer-tools
  identity: null
  hardenedRuntime: false
  gatekeeperAssess: false
  x64ArchFiles: Contents/Resources/app.asar.unpacked/node_modules/{@esbuild/**,esbuild/**}

dmg:
  artifactName: Baby-Menu-${version}-universal.dmg
```

Set this environment variable in CI so electron-builder does not try to find a Developer ID identity:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false
```

If universal DMG creation is unreliable, ship separate architecture DMGs and use Homebrew cask `on_arm` and `on_intel` blocks.
The universal DMG is preferred because it keeps the cask simpler.

## Ad-Hoc Signing

We are not doing Developer ID signing or notarization.
Use ad-hoc signing after building the `.app` and before creating or finalizing the DMG.

Example:

```sh
codesign --force --deep --sign - "release/mac-universal/Baby Menu.app"
```

Ad-hoc signing is not a trust signal to Gatekeeper.
It is still useful because macOS expects Mach-O binaries inside app bundles to have coherent signatures.

The Homebrew cask should clear quarantine after install with `xattr -cr`.
This mirrors the historical Airlock distribution pattern.

## Homebrew Tap

Create a general tap repo:

```text
github.com/kunchenguid/homebrew-tap
```

Add this cask:

```text
Casks/baby-menu.rb
```

Recommended cask template:

```ruby
cask "baby-menu" do
  version "0.1.0"
  sha256 "REPLACE_WITH_RELEASE_DMG_SHA256"

  url "https://github.com/kunchenguid/baby-menu/releases/download/v#{version}/Baby-Menu-#{version}-universal.dmg"
  name "Baby Menu"
  desc "Menu-bar app that writes its own widgets"
  homepage "https://github.com/kunchenguid/baby-menu"

  depends_on macos: ">= :ventura"

  app "Baby Menu.app"

  uninstall quit: "com.kunchenguid.baby-menu"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Baby Menu.app"],
                   must_succeed: false
  end

  zap trash: [
    "~/.baby-menu",
    "~/Library/Preferences/com.kunchenguid.baby-menu.plist",
  ]
end
```

Validate the final bundle identifier before using the `uninstall quit` stanza.
The bundle identifier should match `appId` from the packaging config.

## Release Automation

Use GitHub Releases as the source of release artifacts.
Use the Homebrew tap only as install metadata.

Recommended release workflow:

1. A GitHub Actions workflow runs on a version tag such as `v0.1.0`.
2. The workflow checks out the Baby Menu repo.
3. It installs pnpm and Node.
4. It runs `pnpm install --frozen-lockfile`.
5. It runs `pnpm typecheck` and `pnpm test`.
6. It runs `pnpm build`.
7. It packages `Baby Menu.app`.
8. It ad-hoc signs the app with `codesign --sign -`.
9. It creates `Baby-Menu-${VERSION}-universal.dmg`.
10. It uploads the DMG to the GitHub Release.
11. It computes the DMG SHA256.
12. It clones `kunchenguid/homebrew-tap` using a write token.
13. It rewrites `Casks/baby-menu.rb` with the new version, URL, and SHA256.
14. It commits `baby-menu ${VERSION}` to the tap repo.
15. It pushes the tap update.

Required GitHub secret:

```text
HOMEBREW_TAP_TOKEN
```

The token needs contents write access to `kunchenguid/homebrew-tap`.

## Example Release Workflow Skeleton

```yaml
name: release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  macos:
    runs-on: macos-latest
    env:
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
      VERSION: ${{ github.ref_name }}
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v6
        with:
          version: 11.1.1

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

      - name: Package macOS app
        run: pnpm exec electron-builder --mac dir --universal

      - name: Ad-hoc sign app
        run: codesign --force --deep --sign - "release/mac-universal/Baby Menu.app"

      - name: Create DMG
        run: |
          VERSION_NUMBER="${GITHUB_REF_NAME#v}"
          DMG_NAME="Baby-Menu-${VERSION_NUMBER}-universal.dmg"
          hdiutil create -volname "Baby Menu" \
            -srcfolder "release/mac-universal/Baby Menu.app" \
            -ov -format UDZO "release/${DMG_NAME}"
          echo "VERSION_NUMBER=${VERSION_NUMBER}" >> "$GITHUB_ENV"
          echo "DMG_NAME=${DMG_NAME}" >> "$GITHUB_ENV"
          echo "DMG_PATH=release/${DMG_NAME}" >> "$GITHUB_ENV"

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          if gh release view "$GITHUB_REF_NAME" >/dev/null 2>&1; then
            gh release upload "$GITHUB_REF_NAME" "$DMG_PATH" --clobber
            gh release edit "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --latest
          else
            gh release create "$GITHUB_REF_NAME" "$DMG_PATH" --title "$GITHUB_REF_NAME" --generate-notes --latest
          fi

      - name: Compute SHA256
        run: |
          SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
          echo "SHA256=${SHA256}" >> "$GITHUB_ENV"

      - name: Update Homebrew Cask
        env:
          HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
        run: |
          git clone "https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/kunchenguid/homebrew-tap.git" "$RUNNER_TEMP/homebrew-tap"
          mkdir -p "$RUNNER_TEMP/homebrew-tap/Casks"
          cat > "$RUNNER_TEMP/homebrew-tap/Casks/baby-menu.rb" << CASK_EOF
          cask "baby-menu" do
            version "${VERSION_NUMBER}"
            sha256 "${SHA256}"

            url "https://github.com/kunchenguid/baby-menu/releases/download/v#{version}/Baby-Menu-#{version}-universal.dmg"
            name "Baby Menu"
            desc "Menu-bar app that writes its own widgets"
            homepage "https://github.com/kunchenguid/baby-menu"

            depends_on macos: ">= :ventura"

            app "Baby Menu.app"
            uninstall quit: "com.kunchenguid.baby-menu"

            postflight do
              system_command "/usr/bin/xattr",
                             args: ["-cr", "#{appdir}/Baby Menu.app"],
                             must_succeed: false
            end

            zap trash: [
              "~/.baby-menu",
              "~/Library/Preferences/com.kunchenguid.baby-menu.plist",
            ]
          end
          CASK_EOF
          cd "$RUNNER_TEMP/homebrew-tap"
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add Casks/baby-menu.rb
          if ! git diff --cached --quiet; then
            git commit -m "baby-menu ${VERSION_NUMBER}"
            git push
          fi
```

The workflow skeleton is intentionally explicit.
The exact electron-builder output path may differ and should be verified during implementation.

## App Update Model

Homebrew is the updater for v1.
Do not add an in-app auto-updater yet.

The app can show a “Check for updates” link or command later, but the initial guidance is:

```sh
brew update
brew upgrade --cask baby-menu
```

User-generated extensions in `~/.baby-menu/extensions` must survive app upgrades.
The app bundle should be replaceable without losing user state.

## Security Model

This distribution intentionally does not use Developer ID signing or notarization.
Homebrew Cask plus `xattr -cr` is a pragmatic install path for developer-oriented users.

Important constraints:

- The cask must download over HTTPS from GitHub Releases.
- The cask must pin the SHA256 of the DMG.
- The production widget protocol must only serve compiled files from the widget cache.
- The production compiler must not allow path traversal outside the extension workspace.
- Renderer widgets must not gain filesystem or shell access.
- Privileged work must remain behind extension-owned server actions invoked through `window.babyMenu.capabilities.invoke`.
- External agent CLIs are user-installed and user-authenticated.
- Do not commit tokens, credentials, or local secrets into releases or tap files.

## Homebrew Cask Limitations

This approach is intentionally not the same as mainstream notarized app distribution.

Known limitations:

- Users must have Homebrew.
- Managed Macs may block unsigned or ad-hoc-signed apps.
- Homebrew Cask policy could become less friendly to quarantine removal in custom taps.
- Direct DMG downloads may still hit Gatekeeper friction unless users remove quarantine manually.
- Official `Homebrew/homebrew-cask` inclusion is unlikely while relying on quarantine removal and ad-hoc signing.

For Baby Menu's likely early users, these tradeoffs are acceptable.

## Testing Checklist

Before shipping the first cask release, test on a clean macOS user account.

Required install tests:

- `brew install --cask kunchenguid/tap/baby-menu` installs without a separate `brew tap` command.
- `/Applications/Baby Menu.app` exists.
- The app launches from Finder.
- The app launches from Spotlight.
- The packaged app launches after login by default.
- The popover exposes a visible opt-out toggle for opening at login.
- Source/dev mode does not enable a login item.
- The app does not require a source checkout, Node, or pnpm.
- Quarantine does not block launch after Homebrew installation.

Required runtime tests:

- The tray icon appears.
- The renderer loads from `out/renderer/index.html` in packaged mode.
- First launch seeds the extension workspace into `~/.baby-menu/extensions`.
- Recipes are listed from the home dot-directory extension workspace.
- The hello-world fallback renders before any generated widget exists.
- The app can find an installed agent CLI when launched from Finder.
- The app shows a clear error when no agent CLI is available.
- An agent-created widget writes files under `~/.baby-menu/extensions`.
- Save accepts generated files in packaged mode.
- Rollback restores the pre-turn extension workspace in packaged mode.
- A generated `widget.tsx` compiles into cache and renders without Vite.
- A generated `server.ts` compiles into cache and can be invoked through capabilities.
- Relaunching the app preserves generated widgets.
- Upgrading the app preserves generated widgets.

Required uninstall tests:

- `brew uninstall --cask baby-menu` removes the app.
- `brew uninstall --zap --cask baby-menu` removes app data paths declared in `zap`.
- A disabled or removed app no longer starts at login.

## Implementation Phases

These phases have been implemented in this repo unless noted otherwise.

### Phase 1: Package The Existing App - implemented

Deliverables:

- Fix renderer build output to `out/renderer`.
- Add electron-builder config.
- Add package scripts for packaging.
- Produce a local `.app` and DMG.
- Ad-hoc sign the `.app`.
- Confirm the packaged app opens and shows the existing UI.

Acceptance criteria:

- `pnpm build` creates `out/main`, `out/preload`, and `out/renderer` in the repo.
- A local packaged app opens without a Vite dev server.
- The tray icon appears.

### Phase 2: Move Packaged State To Home Dot Directory - implemented

Deliverables:

- Add packaged path resolver based on `app.getPath("home")` and `~/.baby-menu`.
- Seed extension templates on first packaged launch.
- Use snapshot change sessions for packaged extensions.
- Keep source-mode git sessions unchanged.
- Add packaged-mode tests for path selection and change-session selection.

Acceptance criteria:

- Packaged mode never writes generated extension files into the `.app` bundle.
- Save and Rollback work without a git repo.
- Source tracked `extensions` still use `GitChangeSession` when selected explicitly.
- Source `pnpm dev` still uses snapshot sessions for `extensions-dev`.

### Phase 3: Add Production Extension Compilation - implemented

Deliverables:

- Add a TypeScript-based widget compiler.
- Add a TypeScript-based server action compiler.
- Add safe custom protocols for compiled widget modules and React host shims.
- Keep Vite `/@fs` imports in dev mode.
- Add tests for import rewriting, cache invalidation, and path safety.

Acceptance criteria:

- Packaged app renders a generated widget from `widget.tsx` without Vite.
- Packaged app invokes a generated `server.ts` action without raw TypeScript imports.
- Widget hooks use the host React copy and do not load a second React runtime.
- Unsupported external imports fail with a clear developer-facing error.

### Phase 4: Add Homebrew Cask Release Flow - implemented with external setup

Deliverables:

- Create `kunchenguid/homebrew-tap`.
- Add `Casks/baby-menu.rb`.
- Add a tag-triggered release workflow in this repo.
- Upload a DMG to GitHub Releases.
- Update the cask automatically with version, URL, and SHA256.

Remaining manual setup:

- Ensure the external `kunchenguid/homebrew-tap` repository exists with the cask path.
- Configure the `HOMEBREW_TAP_TOKEN` repository secret before publishing tagged releases.

Acceptance criteria:

- A fresh user can run `brew install --cask kunchenguid/tap/baby-menu`.
- The app installs to `/Applications`.
- The app launches after install.
- `brew upgrade --cask baby-menu` installs a newer release and preserves user data.

## Airlock Precedent

The archived `airlock-hq/homebrew-airlock` tap used this same broad strategy.
It installed a versioned universal DMG from GitHub Releases.
It installed the app with the Homebrew `app` stanza.
It exposed bundled binaries with `binary` stanzas.
It ran `xattr -cr` in `postflight` to clear quarantine.
It updated the tap from the main repo release workflow.
It used ad-hoc signing, not Developer ID signing or notarization.

Baby Menu can follow the same distribution pattern, with one major difference.
Baby Menu should not install a daemon from the cask unless a future daemon exists.
Autostart should be managed by the app through Electron login-item APIs.

## Final Recommendation

Implement the packaged app plus production extension compiler first.
Then ship through `kunchenguid/homebrew-tap` with a cask token of `baby-menu`.
Use GitHub Releases for DMGs and Homebrew Cask for installation and upgrades.
Use ad-hoc signing and `xattr -cr` for the no-Developer-ID path.
Treat Developer ID signing and notarization as a future improvement, not a blocker for the first real distribution channel.
