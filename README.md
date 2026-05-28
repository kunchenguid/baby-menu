<h1 align="center">baby-menu</h1>
<p align="center">
  <a href="https://github.com/kunchenguid/baby-menu/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/baby-menu/ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://img.shields.io/badge/platform-macOS-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" /></a>
  <a href="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square"><img alt="Electron" src="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

<h3 align="center">Adopt a baby menu and help it grow.</h3>

Every menu-bar app ships a fixed set of widgets.
Want your CPU temp next to your Claude usage next to your next calendar event?
Good luck waiting for someone to build exactly that.

baby-menu flips it.
The popover menu can run your coding agent to edit the menu on the fly.
You ask for a feature in plain English, the agent writes an extension and it hot reloads into the menu in real time.

- **Personal self-evolving software** - this is a glimpse into a future where every piece of software is personal and self-evolving towards your exact needs.
- **Ask, don't configure** - tweak the menu using natural language, not configuration.
- **Worry-free** - every agent turn can be kept or undone.

## Quick Start

Requires macOS 13 Ventura or newer, Homebrew, and a supported, already-authenticated agent CLI such as `claude`, `codex`, or `npx` on `PATH`.

```sh
brew install --cask kunchenguid/tap/baby-menu
open -a "Baby Menu"
```

Click the tray icon, then ask for a widget in the composer such as:

```text
add a CPU temp widget that shows current temperature and fan status
```

Baby Menu writes the extension under `~/.baby-menu/extensions`, mounts the widget live, and shows Keep / Undo controls for the turn.
Use Keep to keep it, or Undo to throw it away.
The packaged app opens at login by default.
Use the popover header to open settings or fully quit the app.
Settings lets you turn `open at login` off or back on.

## Install Details

The packaged app stores mutable extensions, caches, agent sessions, and preferences under `~/.baby-menu`, so upgrades preserve generated widgets.
Set `BABY_MENU_AGENT=<name>` in the launch environment to choose an agent explicitly.

Update with Homebrew:

```sh
brew update
brew upgrade --cask baby-menu
```

## From Source

Use source mode when developing Baby Menu itself.
End users should install the Homebrew Cask above.

```sh
git clone https://github.com/kunchenguid/baby-menu.git
cd baby-menu
pnpm install
pnpm dev
```

Requires Node `>=22.12` and `pnpm@11.1.1` (declared in `packageManager`).

## How It Works

```
   ┌─────────────────────┐
   │  macOS tray popover │   (React renderer, 360px wide)
   │ + Menu / Settings   │
   │ + Quit              │
   └──────────┬──────────┘
              │  send()
              ▼
   ┌─────────────────────┐       ┌──────────────────────┐
   │  BabyMenuAgentRuntime├──────►│    Change Session    │
   │   wraps acpx/runtime │       │   git or snapshot    │
   └──────────┬──────────┘       │   by runtime mode    │
              │                   └──────────┬───────────┘
              │ edits files                  │ save / rollback
              ▼                              ▼
   ┌─────────────────────┐       ┌──────────────────────┐
   │ active extensions/  │       │   save snapshot or   │
   │  widget.tsx         │◄──────┤   rollback files     │
   │  server.ts          │       │   safely             │
   └──────────┬──────────┘       │                      │
              │ hot-reload       └──────────────────────┘
              ▼
   ┌─────────────────────┐
   │     WidgetHost      │
   │  mounts new widget  │
   └─────────────────────┘
```

- **Three processes, one bridge** - the renderer never touches git, the agent, or the filesystem.
  Everything goes through `window.babyMenu` exposed in `src/preload/index.ts`.
- **Recipes are specs, not prompts** - HTML files under `extensions/recipes/` describe a widget's capability, data sources, fallback behavior, and acceptance criteria.
  The agent reads the matching recipe before implementing.
- **Extension server actions** - privileged work (shell, network, credentials) lives in `<extension-id>/server.ts` and is invoked from widgets via `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
  No per-widget IPC channels.
- **Runtime-specific extension roots** - `pnpm dev` edits gitignored `extensions-dev/`; packaged builds seed and edit `~/.baby-menu/extensions` with internal snapshot save/rollback.
  Tracked `extensions/` remain the source templates for dev and packaged extension workspaces.

## Layout

| Path                        | What lives here                                             |
| --------------------------- | ----------------------------------------------------------- |
| `src/main/`                 | Electron lifecycle, tray, popover, IPC, git, agent runtime  |
| `src/preload/index.ts`      | The stable `window.babyMenu` bridge                         |
| `src/renderer/`             | React UI: `AgentChat`, `WidgetHost`, settings, and app controls |
| `src/ui/`                   | Shared `@babymenu/ui` design system for shell and widgets    |
| `src/shared/contracts.ts`   | `BabyMenuApi`, `BabyMenuWidget`, `GitSessionSnapshot`, etc. |
| `extensions/<id>/`          | Tracked extensions (`widget.tsx`, `server.ts`)              |
| `extensions/recipes/*.html` | Self-contained widget specs the agent reads                 |
| `extensions-dev/`           | Gitignored dev workspace prepared by `scripts/dev.mjs`      |
| `~/.baby-menu/extensions/`  | Packaged app extension workspace                            |
| `~/.baby-menu/cache/`       | Packaged widget, server-action, snapshot, and agent caches  |
| `tests/`                    | Vitest tests (e2e specs are `tests/e2e-*.test.ts`)          |

## Environment Flags

| Var                              | Effect                                                       |
| -------------------------------- | ------------------------------------------------------------ |
| `BABY_MENU_KEEP_POPOVER_OPEN=1`  | Disables blur-to-hide so devtools / external windows stay up |
| `BABY_MENU_AGENT=<name>`         | Selects the ACP agent (e2e tests use `acpx-mock`)            |
| `BABY_MENU_EXTENSIONS_DIR=<dir>` | Overrides the active extension workspace in source/dev runs. Dev Tailwind scans only `extensions/` and `extensions-dev/`, so overrides outside those paths need matching `@source` coverage for widget utilities. |

## Development

```sh
pnpm dev          # run Electron + renderer dev server with a gitignored extensions-dev/ sandbox
pnpm dev:reset    # wipe extensions-dev/ and start fresh
pnpm build        # build main + preload + renderer into out/
pnpm package:mac  # build and create an ad-hoc-signed .app in release/mac-universal/
pnpm dist:mac     # build the .app and create a universal DMG in release/
pnpm test         # run all Vitest tests
pnpm test:e2e     # only e2e tests (spawn real acpx/runtime against acp-mock)
pnpm typecheck    # tsc --noEmit
pnpm lint         # tsc --noEmit (same as typecheck)
```

Use `pnpm dev` for source iteration in a throwaway sandbox - the agent edits the gitignored `extensions-dev/` copy and your tracked tree stays clean.
Source/dev mode never touches macOS login items, including Electron's `setLoginItemSettings` API.
Use `pnpm package:mac` when you want to test the actual packaged app from `release/mac-universal/Baby Menu.app`.

Single test: `pnpm vitest run tests/<name>.test.ts` or `pnpm vitest run -t "<pattern>"`.

TDD is required for bug fixes and new features.
Tests live in `tests/` at the repo root, not co-located.
