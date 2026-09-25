# Architecture

How Baby Menu fits together at runtime.
For the at-a-glance picture, see the "How It Works" diagram in the [README](../README.md#how-it-works).

## Process model

- **Three processes, one bridge.**
  The renderer never touches git, the agent, or the filesystem - everything goes through `window.babyMenu` exposed in `src/preload/index.ts`.
- **Settings overlay.**
  Settings covers the menu without unmounting it, so composer, widget, and run state survive opening and closing it.
- **Manual layout reload.**
  The header reload control remounts the menu surface by bumping its React key, which re-runs widget and root-layout discovery and resets widget React state without reloading the whole renderer or losing the agent conversation.

## Extensions

| Concept | What it is |
| --- | --- |
| Recipes | HTML specs under `extensions/recipes/` describing a widget's capability, data sources, fallbacks, and acceptance criteria. The agent reads the matching recipe before implementing. |
| Custom layouts | An optional root `layout.tsx` arranges the popover canvas. Without it, widgets stack in a column. |
| Settings sections | Extensions export `BabyMenuSettingsSection` from `widget.tsx`; the host frames each body. |
| Server actions | Privileged work (shell, network, credentials) lives in `<extension-id>/server.ts`, called via `window.babyMenu.capabilities.invoke(...)`. No per-widget IPC. |
| Local storage | A shared SQLite store: `context.db` server-side, `window.babyMenu.db` in the renderer. Use it for anything that must survive reloads. |
| Stable contracts | Extensions import host types with type-only `import ... from "@babymenu/contracts"`, shipped into each workspace. |

For recipe authoring and live-source verification conventions, see [Recipe Authoring](recipes.md).
Provider-specific acquisition and refresh contracts live in the matching recipe.

**Background vs view refresh.**
`refreshView` / `viewRefreshIntervalMs` keeps a visible widget current and pauses while the popover is hidden.
`export const background` in `server.ts` runs on a host-owned timer (60-second minimum) for work that must continue while the popover is closed.

**Extension contracts.**
Widgets conform to `BabyMenuWidget` / `RefreshableBabyMenuWidget`; `WidgetHost` owns visible-widget refresh timing via `useViewRefresh` and the main-process popover visibility signal, so widgets never start their own polling.
A root `layout.tsx` default-exports a `BabyMenuLayout`, receives active widget metadata plus `renderWidget(id)`, and owns the canvas arrangement; the popover adapts to the canvas width plus chrome and the rendered height.
Settings sections own only their body; `SettingsView` owns the frame and rediscovers sections when settings refresh or the popover reopens.
Server actions and background tasks are discovered dynamically, so new capabilities need no preload change.

**Module lifetime.**
An unchanged `server.ts` module instance stays alive across invokes and background ticks, so module-scope values are only an ephemeral cache - they reset on code edits or app restarts.

## Agent runtime

- **Bundled ACP adapters.**
  Built-in Claude Code and Codex launch `out/adapters/<name>/index.mjs`, wrapping the local authenticated CLI in isolation from user-level agent config.
  Codex still reuses only the top-level `model` from `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`) so `--ignore-user-config` does not force an unsupported default.
- **Terminal failure semantics.**
  CLI, authentication, rate-limit, and provider failures reject through ACP with typed, bounded messages; raw provider payloads are never streamed or logged as user-facing errors.
  Baby Menu also treats a completed ACP refusal as a failed editing turn, records failed diagnostics and telemetry, and strips nested transport error wrappers before displaying the safe message.
- **Live custom agent catalog.**
  Settings-owned custom ACP agents persist to `agents.json` and register as `acpx` overrides immediately, kept separate from read-only built-ins.

- **One turn at a time.**
  `BabyMenuAgentRuntime` (`src/main/agent-runtime.ts`) wraps `acpx/runtime` and accepts one `send()` at a time; an overlapping send gets an "already running" reply before any change session begins.
  Every accepted send runs inside a change session (see below).
- **Agent selection.**
  Agent choice and availability are described in [Configuration](configuration.md#choosing-an-agent).
  Switching agents is blocked while a turn runs or while a change session can still be saved or rolled back; a successful switch closes the persistent session with `discardPersistentState` so the next turn starts a fresh conversation.
- **Persistent session.**
  The ACP runtime is built lazily with `createFileSessionStore({ stateDir })` under `.cache/baby-menu/acp-sessions` (source) or `~/.baby-menu/cache/acp-sessions` (packaged), `permissionMode: "approve-all"`, and the fixed `sessionKey: "baby-menu-agent-chat"`.
  On `SESSION_RESUME_REQUIRED` it closes the runtime, removes `<stateDir>/sessions/baby-menu-agent-chat.json`, and retries once.
  Failed attempts are written under the app data root's `.cache/baby-menu/agent-turns` with `message`, `code`, and `detailCode`; if the retry fails, the renderer shows the real thrown message.

## Change tracking

- **Runtime-specific roots.**
  `pnpm dev` edits gitignored `extensions-dev/`; packaged builds seed and edit `~/.baby-menu/extensions` with snapshot save/rollback.
  Tracked `extensions/` stay the source templates, including the generated `@babymenu/contracts` declaration.
- **Best-effort packaged seeding.**
  Packaged startup resolves a symlinked `~/.baby-menu/extensions` to its real target before copying bundled defaults, so managed links into writable directories keep working without replacing the link.
  Seeding failures are logged and skipped instead of aborting tray creation.
- **Packaged module compilation.**
  Packaged widgets and root layouts compile into `~/.baby-menu/cache`; Tailwind source scanning resolves a symlinked extension root before copying it to the temporary scan directory.
  A root layout that fails to compile falls back to the built-in column and logs a warning so it is distinguishable from no authored layout.
- **Snapshot rollback safety.**
  Snapshot workspaces restore in place instead of replacing the workspace directory, so a symlinked extension workspace stays linked while files, directories, symlinks, binary contents, and modes return to the pre-turn state.
  Existing user-owned `.git` metadata is ignored and preserved, while `.git` metadata created by a turn is removed with the rest of that created subtree.
- **Session selection.**
  Snapshot workspaces (`extensions-dev/`, packaged `~/.baby-menu/extensions`) use `DevExtensionChangeSession` (`src/main/dev-extension-change-session.ts`).
  The tracked source `extensions/` workspace uses `GitChangeSession` (`src/main/git-change-session.ts`) only when selected explicitly (for example with `BABY_MENU_EXTENSIONS_DIR`).
- **Git session guards.**
  `GitChangeSession.begin` refuses to run the agent when the working tree is dirty.
  Save and Rollback refuse unless the session started clean, is not already completed, and `HEAD` has not moved since it began.
  Rollback runs `git reset --hard <recorded HEAD>` plus `git clean -fd`; those destructive commands are acceptable only because of these guards.
- **Diff-derived Keep / Undo.**
  The bar reflects the actual git or snapshot diff, not agent wording - it names created, updated, or removed extensions, reports `layout.tsx` edits as layout changes, and clears itself when nothing changed on disk.
  Successful clean turns still report that no changes were made; failed clean sessions close without that no-op message, while partial changes from failed turns remain available for Keep or Undo alongside the failure guidance.

## Updates and telemetry

- **Release indicator.**
  The main process checks the latest GitHub Release at most every four hours, stays silent on failure, and shows the upgrade command only when a newer release exists.
  The Homebrew Cask relaunches Baby Menu after an upgrade only when it was already running.
- **Anonymous telemetry.**
  Packaged builds fire best-effort Umami events for app start, popover open (also a `/popover` page view), agent turn status, and agent switches.
  Built-in agents report as `claude` or `codex`; custom agents report only as `custom`.

## Security boundaries

- `createPopoverOptions` (`src/main/popover.ts`) enforces `frame:false`, `contextIsolation:true`, `nodeIntegration:false`, `skipTaskbar:true`, and `alwaysOnTop:true`.
- On macOS, `app.ts` appends Chromium's `use-mock-keychain` switch before app readiness, so Chromium or renderer storage cannot hold keychain-backed secrets; credential and token work belongs in extension server actions.
- New generic IPC routes are added only in `src/main/ipc.ts`; widgets never get per-widget IPC channels or preload methods.
- Packaged runtime state lives under `~/.baby-menu` and is not git-backed. Generated extension files, the extension database, compiled modules, preferences, logs, snapshots, and ACP session state never go into the `.app` bundle.

## Public extension surfaces

Public extension surfaces are deliberate, tested contracts:

- **`@babymenu/contracts`.**
  Extensions cannot see `src/shared/contracts.ts` (it lives inside the app bundle), so the host ships the extension-facing types into each workspace as a virtual module declared in `extensions/babymenu-env.d.ts`.
  `scripts/generate-extension-dts.mjs` (`pnpm generate:contracts`) generates that file from `contracts.ts`, selecting the names in `src/shared/extension-contract-names.ts`; `BabyMenuExtensionApi` is the window-bridge subset extensions may use.
  The file is tracked because typecheck, `pnpm dev`, and packaging all read it; `tests/extension-contract-surface.test.ts` and CI fail when it is stale.
  Extensions use only type-only imports from it (erased by the compiler); importing a value is rejected.
  Never point an extension or its agent at `../../src/shared/contracts`: that path exists only in source mode and previously sent the embedded agent scanning protected home-directory folders.
- **`@babymenu/ui`.**
  `src/ui/` is a shadcn-derived kit (Radix + Tailwind v4) restyled to the Monochrome Lab tokens and shared by the app shell and extensions.
  `src/ui/theme.css` is the single `@theme` source of truth: it wipes Tailwind's default palette and is consumed by both the renderer build (`src/ui/styles.css`) and the per-widget/layout compiler (imported `?raw` into the main bundle).
  `main.tsx` installs the kit on `window.__BABY_MENU_WIDGET_HOST__.ui`, `widget-protocol.ts` serves `baby-menu-host://ui/index.mjs` as a re-export, and the compiler rewrites the bare specifier to that URL, so Radix, cva, and lucide stay in the host bundle.
  `src/shared/ui-exports.ts` is the public surface contract, kept in lockstep with the barrel and host shim by `tests/ui-export-contract.test.ts`.
  Extension widgets, root layouts, and settings sections may import only `react` and `@babymenu/ui`, authoring token-scoped Tailwind utilities whose stylesheet is compiled and injected automatically.
- **`window.babyMenu`.**
  Exposed by `src/preload/index.ts`; new capabilities go through extension server actions and `capabilities.invoke`, not new preload methods.

## Source module index

| Module | Role |
| --- | --- |
| `src/main/app.ts` | Lifecycle, popover window, packaged paths, seeding, preferences, agent catalog wiring, protocols, tray, IPC. `package.json#main` points here via `out/main/index.js`; `process.env.VITEST` stops tests from auto-starting the app. |
| `src/main/app-paths.ts` | Source versus packaged `~/.baby-menu` paths |
| `src/main/tray.ts`, `popover.ts` | Tray icon; popover window options, adaptive sizing, bounds math, renderer loading |
| `src/main/ipc.ts` | All `ipcMain` handlers behind the preload bridge |
| `src/main/agent-catalog.ts`, `agent-catalog-controller.ts` | Built-in and custom agents, `agents.json` parsing and persistence, availability, live `acpx` registry overrides |
| `src/main/agent-runtime.ts`, `agent-turn-log.ts` | Agent turns, change-session gating, diff-derived labels, structured per-turn logs |
| `src/main/git-change-session.ts`, `dev-extension-change-session.ts`, `extension-change.ts` | Git and snapshot Save/Rollback, diff classification into created/updated/removed extension or layout changes |
| `src/main/extension-seeder.ts` | Force-copies shipped defaults (`AGENTS.md`, `babymenu-env.d.ts`, `recipes/`, managed extensions) into the packaged workspace on every launch, never deleting user extensions. Edits to managed defaults in `~/.baby-menu/extensions` do not persist; change `extensions/` instead. |
| `src/main/extension-module-compiler.ts` | Compiles packaged widget, layout, and server modules; rewrites `react` and `@babymenu/ui` to host protocol modules, rejects other external imports (server modules may also use Node builtins), repairs stale content-addressed cache outputs |
| `src/main/widget-tailwind-css.ts` | Compiles widget and layout Tailwind utilities against `src/ui/theme.css` for packaged loading |
| `src/main/widget-module-registry.ts`, `widget-protocol.ts` | Discovers widgets and root `layout.tsx` (Vite `/@fs` URLs in dev, compiled `baby-menu-widget://` modules plus `cssUrl` when packaged); serves compiled modules and host shims |
| `src/main/server-action-registry.ts`, `background-task-scheduler.ts` | Discovers and caches server actions and background tasks; host-owned timers with a 60-second minimum |
| `src/main/extension-database.ts`, `notifier.ts` | Shared SQLite store; native notifications for `context.notify` |
| `src/main/preferences.ts` | App preferences; login-item settings only for the packaged production product named `Baby Menu` |
| `src/main/shell-path.ts` | Expands `PATH` for GUI launches so packaged apps find agent CLIs |
| `src/main/update-checker.ts` | GitHub Release check (at most every 4 hours); simulates an available update in source/dev mode |
| `src/main/recipe-loader.ts` | Discovers `recipes/*.html` and extracts titles |
| `src/main/telemetry.ts` | Fire-and-forget Umami events; host and website id injected at build time by `electron.vite.config.ts`, no-op when unset |
| `src/renderer/extension-modules.ts` | Runtime loader for widget and layout modules, including packaged stylesheet injection |
| `src/renderer/settings/settings-sections.ts` | Collects `BabyMenuSettingsSection` exports, sorted by extension id |

## Repository layout

| Path                        | What lives here                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `src/adapters/`             | Bundled clean-room ACP adapters for built-in Claude Code and Codex agents              |
| `src/main/`                 | Electron lifecycle, tray, popover, IPC, git, agent runtime, update checks              |
| `src/preload/index.ts`      | The stable `window.babyMenu` bridge                                                    |
| `src/renderer/`             | React UI: `AgentChat`, `WidgetHost`, custom layouts, settings, updates, layout reloads, app controls |
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
