<h1 align="center">baby-menu</h1>
<p align="center">
  <a href="https://github.com/kunchenguid/baby-menu/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/baby-menu/ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://img.shields.io/badge/platform-macOS-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS-blue?style=flat-square" /></a>
  <a href="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square"><img alt="Electron" src="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

<h3 align="center">Adopt a baby menu and help it grow.</h3>

<p align="center">
  <img
    alt="Ask baby-menu to build a cpu and a claude usage widget and watch them appear in your menu bar"
    src="marketing-video/baby-menu-marketing-square.gif"
    width="960"
  />
</p>

Every menu-bar app ships a fixed set of widgets.
Want your CPU usage next to your Claude usage next to your next calendar event?
Good luck waiting for someone to build exactly that.

baby-menu flips it.
The popover menu can run your coding agent to edit the menu on the fly.
You ask for a feature in plain English, the agent writes an extension and it hot reloads into the menu in real time.

- **Personal self-evolving software** - jump into the future where every piece of software is personal and self-evolving towards your exact needs.
- **Ask, don't configure** - tweak the menu using natural language, not configuration.
- **Worry-free** - every agent turn can be kept or undone.

## Quick Start

Requires macOS 13 Ventura or newer, Homebrew, and a supported, already-authenticated agent CLI such as `claude` or `codex` on `PATH`.

```sh
brew install --cask kunchenguid/tap/baby-menu
open -a "Baby Menu"
```

Click the tray icon, then ask for a widget in the composer such as:

```text
add a CPU usage widget that shows current load in %
```

Baby Menu writes changes under `~/.baby-menu/extensions`, mounts updated widgets or layouts live, and shows Keep / Undo controls only when files actually changed.
The Keep / Undo bar labels the actual workspace diff, such as `Added the cpu extension` or `Updated the layout`; use Keep to keep it, or Undo to throw it away.
Extensions can keep local state in Baby Menu's shared SQLite store, contribute settings sections, and register background tasks for work that must continue while the popover is closed.
The packaged app opens at login by default.
Use the popover header to open settings, fully quit the app, or install an available update.
Settings opens as an overlay so the menu, widgets, and composer keep their state while you configure the app.
It lets you turn `launch at system start` off or back on, choose the embedded agent, add/edit/remove custom ACP agents, and see unavailable built-in agents with install hints.
Switching agents resets the current conversation after confirmation.

## Install Details

The packaged app stores mutable extensions, the local extension database, caches, agent sessions, custom agent catalog, and preferences under `~/.baby-menu`, so upgrades preserve generated widgets and extension state.
On launch, packaged Baby Menu refreshes bundled default extension files such as `AGENTS.md`, `babymenu-env.d.ts`, recipes, and starter extensions from the app template while preserving user-created extension directories.
Packaged release builds send anonymous, best-effort usage telemetry to a self-hosted Umami instance.
Telemetry records app startup, popover opens as `/popover` page views plus named events, agent turn outcomes, and agent switches; it does not include a user or device id, prompts, file contents, generated code, extension data, or local paths, and network failures are ignored.
Set `BABY_MENU_TELEMETRY=0` in the launch environment to opt out.
If an agent send fails, the composer notice surfaces the underlying failure message instead of only showing a generic unavailable hint.
Baby Menu detects supported agents from the catalog in order: Claude Code (`claude`), then Codex (`codex`).
Those built-ins run through bundled clean-room ACP adapters that drive the authenticated local CLIs without inheriting user-level agent settings, skills, MCP servers, or extra rules.
Use Settings to persist an agent choice across launches.
Set `BABY_MENU_AGENT=<name>` in the launch environment to override auto-detection before a preference is saved.
Add `~/.baby-menu/agents.json` to override or append catalog entries manually; source mode reads `agents.json` from the repo root.
Each entry is an object with `name`, optional `label`, optional `command`, optional `installHint`, and optional `launchCommand`.
Agents with `launchCommand` are registered as custom [`acpx`](https://github.com/openclaw/acpx) overrides and are shown as available.

`launchCommand` is any Agent Client Protocol (ACP) server command - `acpx` (the ACP client Baby Menu runs agents through) supports a wide range of coding agents, so you can point an entry at the same command `acpx` uses for one of them.
For example: `npx pi-acp` (Pi), `cursor-agent acp` (Cursor), `copilot --acp --stdio` (GitHub Copilot), `qwen --acp` (Qwen Code), or `npx -y opencode-ai acp` (OpenCode).
The underlying CLI must be installed and authenticated.

```json
[
  {
    "name": "pi",
    "label": "Pi",
    "launchCommand": "npx pi-acp"
  }
]
```

You can also add, edit, and remove custom agents directly from Settings by entering an id, optional label, and ACP launch command.
Settings-added agents are saved to the same `agents.json`, apply immediately, and are editable/removable; built-in Claude Code and Codex entries remain read-only.

Update with Homebrew:

```sh
brew update
brew upgrade --cask baby-menu
```

When a newer GitHub Release is available, Baby Menu shows an update indicator in the popover header.
The indicator opens a small dialog with the same Homebrew upgrade command and a link to the release notes.
If Baby Menu is running during a Homebrew Cask upgrade, the cask quits the old app and relaunches the newly installed app after replacement.
Fresh installs and upgrades while Baby Menu is closed do not launch the app automatically.

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
   │  macOS tray popover │   (React renderer, adaptive size)
   │ + Menu / Settings   │
   │ + Update indicator  │
   │ + Quit              │
   └──────────┬──────────┘
              │  send()
              ▼
   ┌───────────────────────┐       ┌──────────────────────┐
   │  BabyMenuAgentRuntime ├──────►│    Change Session    │
   │   wraps acpx/runtime  │       │   git or snapshot    │
   └──────────┬────────────┘       │   by runtime mode    │
              │                    └──────────┬───────────┘
              │ edits files                   │ save / rollback
              ▼                               ▼
   ┌─────────────────────┐       ┌──────────────────────┐
   │ active extensions/  │       │   save snapshot or   │
   │  layout.tsx         │◄──────┤   rollback files     │
   │  <id>/widget.tsx    │       │   safely             │
   │  <id>/server.ts     │       │                      │
   └──────────┬──────────┘       │                      │
              │ hot-reload       └──────────────────────┘
              ▼
   ┌─────────────────────┐
   │     WidgetHost      │
   │ mounts layout/widget│
   └─────────────────────┘
```

- **Three processes, one bridge** - the renderer never touches git, the agent, or the filesystem.
  Everything goes through `window.babyMenu` exposed in `src/preload/index.ts`.
- **Recipes are specs, not prompts** - HTML files under `extensions/recipes/` describe a widget's capability, data sources, fallback behavior, and acceptance criteria.
  The agent reads the matching recipe before implementing.
- **Bundled ACP adapters** - the built-in Claude Code and Codex entries launch `out/adapters/<name>/index.mjs`, which wraps the local authenticated CLI and keeps Baby Menu's embedded agent isolated from user-level agent configuration.
  If a restart leaves behind a persisted ACP session that an adapter cannot resume, Baby Menu records the failed attempt, deletes that stale session record, and retries once with a fresh session.
- **Live custom agent catalog** - Settings-owned custom ACP agents are persisted to `agents.json`, registered as `acpx` overrides immediately, and kept separate from read-only built-ins.
- **Settings overlay** - Settings covers the default menu without unmounting it, so chat composer, widget, and run state survive opening and closing Settings.
- **Release update indicator** - the main process checks the latest GitHub Release at most every four hours, keeps failures silent, and shows a header indicator with `brew update && brew upgrade --cask baby-menu` only when a newer packaged release exists.
  Source/dev mode simulates an available update so the UI can be exercised locally.
  The released Homebrew Cask relaunches Baby Menu after an upgrade only when the old app was running before uninstall started.
- **Custom popover layouts** - an extension workspace may include a root `layout.tsx` default export that receives active widgets and `renderWidget(id)`, arranges the popover canvas, and lets the window adapt to both the canvas width plus host chrome and the rendered height.
  Workspaces without `layout.tsx` keep the built-in stacked column.
- **Extension settings sections** - extensions may export `BabyMenuSettingsSection` from `widget.tsx`; the Settings page discovers those renderer-only sections through the same module pipeline as widgets and renders the host-owned frame around each body.
- **Extension server actions** - privileged work (shell, network, credentials) lives in `<extension-id>/server.ts` and is invoked from widgets and settings sections via `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
  No per-widget IPC channels.
  Baby Menu keeps an unchanged `server.ts` module instance alive across invokes and background ticks, so module-scope values are only an ephemeral cache and reset after code edits or app restarts.
- **Local extension storage** - extensions share a local SQLite store exposed as `context.db` in server actions and background tasks, and as `window.babyMenu.db` in widgets and settings sections.
  Use this store for settings, history, rate baselines, and anything else that must survive reloads.
- **Background tasks vs view refresh** - `refreshView` / `viewRefreshIntervalMs` keeps a visible widget current and pauses while the popover is hidden; `export const background` in `server.ts` runs on a host-owned timer, clamped to a 60-second minimum, for work that must continue while the popover is closed.
- **Runtime-specific extension roots** - `pnpm dev` edits gitignored `extensions-dev/`; packaged builds seed and edit `~/.baby-menu/extensions` with internal snapshot save/rollback.
  Tracked `extensions/` remain the source templates for dev and packaged extension workspaces, including the generated `@babymenu/contracts` declaration in `extensions/babymenu-env.d.ts`.
- **Diff-derived change prompts** - the Keep / Undo bar is driven by the actual git or snapshot diff, not by agent wording.
  It names created, updated, or removed extensions, reports root `layout.tsx` edits as layout changes, and clears the pending session automatically when the agent made no on-disk change.
- **Stable extension contracts** - extension code imports public host types with type-only `import ... from "@babymenu/contracts"`; the generated declaration is shipped into each extension workspace so extensions never need to reach back into `src/shared/contracts.ts`.
- **Anonymous telemetry** - packaged release builds fire best-effort Umami events for app start, popover open, agent turn status (`success`, `error`, `timeout`, or `blocked_dirty`), and agent switching, and also record each popover open as the `/popover` page view.
  Built-in agent names are reported as `claude` or `codex`; custom agent names are reported only as `custom`.

## Layout

| Path                        | What lives here                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `src/adapters/`             | Bundled clean-room ACP adapters for built-in Claude Code and Codex agents              |
| `src/main/`                 | Electron lifecycle, tray, popover, IPC, git, agent runtime, update checks              |
| `src/preload/index.ts`      | The stable `window.babyMenu` bridge                                                    |
| `src/renderer/`             | React UI: `AgentChat`, `WidgetHost`, custom layouts, settings, updates, app controls   |
| `src/ui/`                   | Shared `@babymenu/ui` design system for shell and extension renderer surfaces          |
| `src/shared/contracts.ts`   | `BabyMenuApi`, `BabyMenuWidget`, `BabyMenuSettingsSection`, `GitSessionSnapshot`, etc. |
| `src/shared/extension-contract-names.ts` | Public type names exported through `@babymenu/contracts`                  |
| `extensions/babymenu-env.d.ts` | Generated `@babymenu/contracts` declarations copied into extension workspaces       |
| `extensions/layout.tsx`     | Optional root popover layout component for arranging active widgets                     |
| `extensions/<id>/`          | Tracked extensions (`widget.tsx` descriptors, `components.tsx` views, `server.ts`)      |
| `extensions/recipes/*.html` | Self-contained widget specs the agent reads                                            |
| `extensions-dev/`           | Gitignored dev workspace prepared by `scripts/dev.mjs`                                 |
| `marketing-video/`          | HyperFrames source plus committed MP4/GIF assets for the README hero video             |
| `~/.baby-menu/extensions/`  | Packaged app extension workspace                                                       |
| `~/.baby-menu/baby-menu.db` | Packaged app's shared local SQLite store for extensions                                |
| `~/.baby-menu/cache/`       | Packaged widget, server-action, snapshot, and agent caches                             |
| `tests/`                    | Vitest tests (e2e specs are `tests/e2e-*.test.ts`)                                     |

## Environment Flags

| Var                               | Effect                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BABY_MENU_KEEP_POPOVER_OPEN=1`   | Disables blur-to-hide so devtools / external windows stay up                                                                                                                                                      |
| `BABY_MENU_AGENT=<name>`          | Overrides agent auto-detection when no saved Settings choice exists                                                                                                                                               |
| `BABY_MENU_AGENT_TIMEOUT_MS=<ms>` | Overrides the embedded-agent request timeout                                                                                                                                                                      |
| `BABY_MENU_EXTENSIONS_DIR=<dir>`  | Overrides the active extension workspace in source/dev runs. Dev Tailwind scans only `extensions/` and `extensions-dev/`, so overrides outside those paths need matching `@source` coverage for widget utilities. |
| `BABY_MENU_TELEMETRY=0`           | Disables packaged-release telemetry; `false` and `off` are also accepted                                                                                                                                          |
| `BABY_MENU_UMAMI_HOST=<url>`      | Overrides the self-hosted Umami endpoint used by telemetry. Source/dev/test builds are no-op unless a website id is also configured.                                                                               |
| `BABY_MENU_UMAMI_WEBSITE_ID=<id>` | Overrides or supplies the Umami website id used by telemetry. The release workflow reads this from the GitHub Actions `vars.*` context, not a secret.                                                             |

## Development

```sh
pnpm dev          # run Electron + renderer dev server with a gitignored extensions-dev/ sandbox
pnpm dev:reset    # wipe extensions-dev/ and agent session cache, then start fresh
pnpm build        # build main + preload + renderer + bundled adapters into out/
pnpm generate:contracts # regenerate extensions/babymenu-env.d.ts from src/shared/contracts.ts
pnpm package:mac  # clean release/ and create an ad-hoc-signed Baby Menu Dev.app
pnpm dist:mac     # build Baby Menu Dev.app and create a universal DMG in release/
pnpm test         # run all Vitest tests
pnpm test:e2e     # only e2e tests (including acpx/runtime plus bundled adapter coverage)
pnpm typecheck    # tsc --noEmit
pnpm lint         # tsc --noEmit (same as typecheck)
```

Use `pnpm dev` for source iteration in a throwaway sandbox - the agent edits the gitignored `extensions-dev/` copy and your tracked tree stays clean.
Use `pnpm dev:reset` when recipe or extension guidance changes; it also clears `.cache/baby-menu/acp-sessions` so the embedded agent re-reads the fresh copied specs instead of continuing from prior conversation state.
Run `pnpm generate:contracts` after changing extension-facing types in `src/shared/contracts.ts` or the public name list in `src/shared/extension-contract-names.ts`; CI fails if the committed `extensions/babymenu-env.d.ts` is stale.
Source/dev mode never touches macOS login items, including Electron's `setLoginItemSettings` API.
Use `pnpm package:mac` when you want to test the actual packaged app from `release/mac-universal/Baby Menu Dev.app`.
Local packaging uses the `Baby Menu Dev` product name and `com.kunchenguid.baby-menu.dev` bundle id so local builds do not shadow the released `/Applications/Baby Menu.app` in macOS LaunchServices.
The universal package is expected to run on both Intel and Apple Silicon Macs, so macOS native prebuilt dependencies must stay installed for `x64` and `arm64` and must stay covered by `electron-builder.yml` `x64ArchFiles` when new native packages are added.
Keep `electron-builder` at `26.8.2` or newer so pnpm-deduped dependencies are included correctly in packaged builds.

The README hero animation is committed from `marketing-video/baby-menu-marketing-square.gif`.
Use the HyperFrames project in `marketing-video/` when revising that asset: `pnpm --dir marketing-video check` validates the composition, and `pnpm --dir marketing-video render` renders the MP4 before regenerating the 960x960 GIF.

Single test: `pnpm vitest run tests/<name>.test.ts` or `pnpm vitest run -t "<pattern>"`.

TDD is required for bug fixes and new features.
Tests live in `tests/` at the repo root, not co-located.

## License

Baby Menu is released under the MIT License.
See [LICENSE](LICENSE) for details.
