<h1 align="center">baby-menu</h1>
<p align="center">
  <a href="https://github.com/kunchenguid/baby-menu/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/baby-menu/ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://img.shields.io/badge/platform-macOS-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" /></a>
  <a href="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square"><img alt="Electron" src="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

<h3 align="center">A menu-bar app that writes its own widgets while you watch.</h3>

Every menu-bar app ships a fixed set of widgets. Want your CPU temp next to your Claude usage next to your next calendar event? You either wait for someone to build it, glue together three different apps, or learn Electron.

baby-menu flips that. The tray popover hosts a coding agent that edits the active extension workspace at runtime. You ask for a widget in plain English, the agent writes the extension, and you click Save to keep it or Rollback to wipe it.

- **Ask, don't configure** - "add a battery widget that shows charge and power source" - the agent ships the widget.
- **Safe change sessions** - every turn runs inside a change session; source mode uses git, while packaged mode snapshots `~/.baby-menu/extensions`.
- **Recipes over prompts** - non-trivial widgets live as self-contained HTML specs in `extensions/recipes/` so the agent implements them the same way every time.

## Quick Start

```sh
$ pnpm install              # installs deps and the pinned Electron binary
$ pnpm dev                  # tray icon appears in your menu bar

# click the tray icon, in the popover chat:
> add a cpu temp widget that shows current temperature and fan status

# agent writes extensions-dev/cpu-temp/widget.tsx and server.ts
# the widget mounts live in the popover
# click Save to keep it, or Rollback to throw the turn away
```

## Install

**Homebrew Cask**

Requires macOS 13 Ventura or newer.
Baby Menu also needs a supported, already-authenticated agent CLI such as `claude`, `codex`, or `npx` on `PATH`; set `BABY_MENU_AGENT=<name>` before launch to choose one explicitly.

```sh
brew install --cask kunchenguid/tap/baby-menu
```

Update with:

```sh
brew update
brew upgrade --cask baby-menu
```

The packaged app stores mutable extensions, caches, agent sessions, and preferences under `~/.baby-menu`, so upgrades preserve generated widgets.
Use the `login on/off` toggle in the popover header to control whether baby-menu opens at login.

**From source**

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
   │     + AgentChat     │
   └──────────┬──────────┘
              │  send()
              ▼
   ┌─────────────────────┐       ┌──────────────────────┐
   │  BabyMenuAgentRuntime├──────►│    Change Session    │
   │   wraps acpx/runtime │       │   git or snapshot    │
   └──────────┬──────────┘       │   by runtime mode    │
              │                   └──────────┬───────────┘
              │ edits files                  │ Save / Rollback
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

- **Three processes, one bridge** - the renderer never touches git, the agent, or the filesystem. Everything goes through `window.babyMenu` exposed in `src/preload/index.ts`.
- **Recipes are specs, not prompts** - HTML files under `extensions/recipes/` describe a widget's capability, data sources, fallback behavior, and acceptance criteria. The agent reads the matching recipe before implementing.
- **Extension server actions** - privileged work (shell, network, credentials) lives in `<extension-id>/server.ts` and is invoked from widgets via `window.babyMenu.capabilities.invoke(extensionId, action, input)`. No per-widget IPC channels.
- **Runtime-specific extension roots** - `pnpm start` edits tracked `extensions/` with `GitChangeSession`; `pnpm dev` edits gitignored `extensions-dev/`; packaged builds seed and edit `~/.baby-menu/extensions` with snapshot Save/Rollback.

## Layout

| Path                              | What lives here                                              |
| --------------------------------- | ------------------------------------------------------------ |
| `src/main/`                       | Electron lifecycle, tray, popover, IPC, git, agent runtime   |
| `src/preload/index.ts`            | The stable `window.babyMenu` bridge                          |
| `src/renderer/`                   | React UI: `AgentChat` + `WidgetHost`                         |
| `src/shared/contracts.ts`         | `BabyMenuApi`, `BabyMenuWidget`, `GitSessionSnapshot`, etc.  |
| `extensions/<id>/`                | Tracked extensions (`widget.tsx`, `server.ts`)               |
| `extensions/recipes/*.html`       | Self-contained widget specs the agent reads                  |
| `extensions-dev/`                 | Gitignored dev workspace prepared by `scripts/dev.mjs`       |
| `~/.baby-menu/extensions/`        | Packaged app extension workspace                             |
| `~/.baby-menu/cache/`             | Packaged widget, server-action, snapshot, and agent caches    |
| `tests/`                          | Vitest tests (e2e specs are `tests/e2e-*.test.ts`)           |

## Environment Flags

| Var                              | Effect                                                        |
| -------------------------------- | ------------------------------------------------------------- |
| `BABY_MENU_KEEP_POPOVER_OPEN=1`  | Disables blur-to-hide so devtools / external windows stay up  |
| `BABY_MENU_AGENT=<name>`         | Selects the ACP agent (e2e tests use `acpx-mock`)             |
| `BABY_MENU_EXTENSIONS_DIR=<dir>` | Overrides the active extension workspace in source/dev runs    |

## Development

```sh
pnpm start        # run Electron + renderer dev server against the real extensions/ dir
pnpm dev          # same, but agent edits the gitignored extensions-dev/ sandbox
pnpm dev:reset    # wipe extensions-dev/ and start fresh
pnpm build        # build main + preload + renderer into out/
pnpm package:mac  # build and create an ad-hoc-signed .app in release/mac-universal/
pnpm dist:mac     # build the .app and create a universal DMG in release/
pnpm test         # run all Vitest tests
pnpm test:e2e     # only e2e tests (spawn real acpx/runtime against acp-mock)
pnpm typecheck    # tsc --noEmit
pnpm lint         # tsc --noEmit (same as typecheck)
```

Use `pnpm start` when you want the embedded agent to edit tracked `extensions/` files (the `GitChangeSession` Save/Rollback boundary kicks in). Use `pnpm dev` when you want a throwaway sandbox - the agent edits the gitignored `extensions-dev/` copy and your tracked tree stays clean.

Single test: `pnpm vitest run tests/<name>.test.ts` or `pnpm vitest run -t "<pattern>"`.

TDD is required for bug fixes and new features. Tests live in `tests/` at the repo root, not co-located.
