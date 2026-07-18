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
| `pnpm package:mac` | Clean `release/` and create an ad-hoc-signed `Baby Menu Dev.app` |
| `pnpm dist:mac` | Build `Baby Menu Dev.app` and create a universal DMG in `release/` |
| `pnpm package:win` | Clean `release/` and build unsigned Windows NSIS + portable (x64; run on Windows) |
| `pnpm package:win:dir` | Clean `release/` and build an unpacked Windows dir target (x64) |
| `pnpm test` | Run all Vitest tests |
| `pnpm test:e2e` | Only e2e tests (including `acpx/runtime` plus bundled adapter coverage) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `tsc --noEmit` (same as typecheck) |

Single test: `pnpm vitest run tests/<name>.test.ts` or `pnpm vitest run -t "<pattern>"`.

## Dev workflow

- `pnpm dev` iterates in a throwaway sandbox - the agent edits the gitignored `extensions-dev/` copy and your tracked tree stays clean.
- `pnpm dev:reset` when recipe or extension guidance changes; it also clears `.cache/baby-menu/acp-sessions` so the agent re-reads fresh specs instead of continuing prior conversation state.
- `pnpm generate:contracts` after changing extension-facing types in `src/shared/contracts.ts` or the public name list in `src/shared/extension-contract-names.ts`; CI fails if the committed `extensions/babymenu-env.d.ts` is stale.
- Source/dev mode never touches macOS login items, including Electron's `setLoginItemSettings` API.

## Packaging

- `pnpm package:mac` tests the actual packaged app from `release/mac-universal/Baby Menu Dev.app`.
- `pnpm package:win` produces unsigned NSIS and portable x64 artifacts under `release/` (intended on a Windows host or the CI `windows-latest` job).
- Local packaging uses the `Baby Menu Dev` product name and `com.kunchenguid.baby-menu.dev` bundle id so local builds do not shadow the released `/Applications/Baby Menu.app` in macOS LaunchServices.
- The universal package must run on both Intel and Apple Silicon Macs, so macOS native prebuilt dependencies must stay installed for `x64` and `arm64` and stay covered by `electron-builder.yml` `x64ArchFiles` when new native packages are added.
- Keep `electron-builder` at `26.8.2` or newer so pnpm-deduped dependencies are included correctly in packaged builds.

## CI

`.github/workflows/ci.yml` keeps an `ubuntu-latest` job (install, contract-types check, typecheck, test, build) and a `windows-latest` job (install, typecheck, test, build, `package:win` with artifact upload). Triggers remain pull_request/push to `main`. Remote CI green - especially Windows packaging - requires a push to GitHub; local Linux typecheck/test cannot prove the `windows-latest` job. Release packaging stays mac-only in `release-please.yml`.

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
