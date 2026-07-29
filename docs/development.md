# Development

Working on Baby Menu itself.
End users should install the Homebrew Cask (see the [README](../README.md#quick-start)).

## Setup

```sh
git clone https://github.com/kunchenguid/baby-menu.git
cd baby-menu
pnpm install
pnpm dev
```

Requires Node `>=22.12` and `pnpm@11.1.1` (declared in `packageManager`).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Electron + renderer dev server with a gitignored `extensions-dev/` sandbox |
| `pnpm dev:reset` | Wipe `extensions-dev/` and the agent session cache, then start fresh |
| `pnpm build` | Build main + preload + renderer + bundled adapters into `out/` |
| `pnpm generate:contracts` | Regenerate `extensions/babymenu-env.d.ts` from `src/shared/contracts.ts` |
| `pnpm package:mac` | Clean `release/` and create an ad-hoc-signed `Baby Menu Dev.app` without release credentials |
| `pnpm dist:mac` | Build the local `Baby Menu Dev.app` and create a universal DMG in `release/` |
| `pnpm package:linux` | Clean `release/` and create an unpacked `release/linux-unpacked/` directory build, x86_64 only |
| `pnpm dist:linux` | Build all four local Linux packages (`AppImage`, `deb`, `rpm`, `pacman`), x86_64 only |
| `pnpm test` | Run all Vitest tests |
| `pnpm test:e2e` | Only e2e tests (including `acpx/runtime` plus bundled adapter coverage) |
| `pnpm test:e2e:packaged-mac` | Check that a packaged macOS app starts its renderer and preload bridge |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `tsc --noEmit` (same as typecheck) |

Single test: `pnpm vitest run tests/<name>.test.ts` or `pnpm vitest run -t "<pattern>"`.

## Dev workflow

- `pnpm dev` iterates in a throwaway sandbox - the agent edits the gitignored `extensions-dev/` copy and your tracked tree stays clean.
- `pnpm dev:reset` when recipe or extension guidance changes; it also clears `.cache/baby-menu/acp-sessions` so the agent re-reads fresh specs instead of continuing prior conversation state.
- `pnpm generate:contracts` after changing extension-facing types in `src/shared/contracts.ts` or the public name list in `src/shared/extension-contract-names.ts`; CI fails if the committed `extensions/babymenu-env.d.ts` is stale.
- Source mode and packaged dev / test bundles never touch open-at-login on any platform. Only the packaged production product, matched by exact executable name (`Baby Menu` on macOS, `baby-menu` on Linux), may call Electron's `setLoginItemSettings` API or write the Linux autostart entry described in [docs/configuration.md](configuration.md#linux-autostart).

## Packaging

- `pnpm package:mac` tests the actual packaged app from `release/mac-universal/Baby Menu Dev.app`.
- Local packaging uses the `Baby Menu Dev` product name and `com.kunchenguid.baby-menu.dev` bundle id so local builds do not shadow the released `/Applications/Baby Menu.app` in macOS LaunchServices. It explicitly disables Developer ID discovery and notarization, then applies an ad-hoc signature for local launch only.
- See [CONTRIBUTING.md](../CONTRIBUTING.md#release-notes) for the production release and downloaded-artifact verification procedure.
- The universal package must run on both Intel and Apple Silicon Macs, so packaged runtime native prebuilt dependencies must stay installed for `x64` and `arm64` and stay covered by `electron-builder.yml` `x64ArchFiles` when new native packages are added.
- `esbuild` is build-time-only and must stay excluded from `electron-builder.yml`. It enters the production dependency graph only through `acpx -> tsx -> esbuild`, but Baby Menu imports the separately published `acpx/runtime` entry, which does not reference `tsx` or acpx's CLI chunk. The adapters are pre-bundled before packaging, while runtime extension compilation uses the shipped `typescript` dependency. `tests/acpx-runtime-dependencies.test.ts` locks the acpx entry-point boundary, and the packaged runtime E2E verifies a real ACP turn with neither `esbuild` nor `@esbuild` present in the app.
- Keep `electron-builder` at `26.8.2` or newer so pnpm-deduped dependencies are included correctly in packaged builds.

### Linux packaging

- `pnpm package:linux` builds an unpacked `release/linux-unpacked/` directory using `electron-builder.dev.yml`. Like the macOS dev bundle, it carries a dev-only identity: the executable is named `baby-menu-dev` (not `baby-menu`), so it never satisfies the open-at-login production gate in `src/main/app.ts`, which matches the executable name exactly.
- `pnpm dist:linux` builds all four packages (`AppImage`, `deb`, `rpm`, `pacman`) with the same dev-only naming. The `rpm` target shells out to `rpmbuild` through fpm, so it needs a system `rpmbuild` (`rpm-tools` on Arch, `rpm` on Debian/Ubuntu). The `pacman` target shells out to `bsdtar` to generate `.MTREE`, so it needs a system `bsdtar` (already present on Arch through base `libarchive`, `libarchive-tools` on Debian/Ubuntu). `deb` is pure fpm and needs nothing extra; `AppImage` pulls its own `appimagetool`.
- fpm's bundled Ruby needs a working system `libcrypt.so.1`. If a local `dist:linux` run fails on a missing `libcrypt.so.1`, that is a host Ruby dependency gap, not a project bug - do not `sudo` install a compat package to work around it on a throwaway host.
- Always invoke `electron-builder` through pnpm (`pnpm package:linux`, `pnpm dist:linux`, or `pnpm exec electron-builder ...`, which is what the CI job uses). A bare `npx electron-builder` run makes app-builder-lib fall back to its npm collector against a pnpm store; it then silently drops every optional platform package, so `app.asar.unpacked` ships without `lightningcss-linux-x64-gnu` and `@tailwindcss/oxide-linux-x64-gnu` and the packaged app dies at startup with `Cannot find module '../lightningcss.linux-x64-gnu.node'` before the tray exists. The release job's "Verify packaged glibc native prebuilts" step fails the build rather than uploading such an artifact.
- The unpacked directory build, the `AppImage`, and the `pacman` package have been built locally and launched from the packaged artifact (tray item registered, `~/.baby-menu` seeded); the `pacman` one was installed with `pacman -U` on Arch, which is how electron-builder's stale `http-parser` default dependency was found and the `pacman: depends:` override in `electron-builder.yml` verified. Nobody has produced a real `deb` or `rpm` artifact end to end yet. The CI job is expected to work because Ubuntu runners ship `libcrypt.so.1`, but that is unverified until the first real release run.
- CI builds production artifacts on `ubuntu-22.04`, not `ubuntu-latest`. glibc is a floor, not a ceiling: building on 24.04 would produce `.deb`/`.rpm` artifacts that do not install on Debian 12 or RHEL 9. If that runner label is retired, move to the next-oldest supported label - a one-line change.
- For how the `linux` release job in `.github/workflows/release-please.yml` orders against the macOS job, see [CONTRIBUTING.md](../CONTRIBUTING.md#release-notes).

## Hero video

The README hero animation is committed from `marketing-video/baby-menu-marketing-square.gif`.
Use the HyperFrames project in `marketing-video/` to revise it:

```sh
pnpm --dir marketing-video check    # validate the composition
pnpm --dir marketing-video render   # render the MP4 before regenerating the 960x960 GIF
```

## Conventions

- TDD is required for bug fixes and new features.
- Tests live in `tests/` at the repo root, not co-located.
