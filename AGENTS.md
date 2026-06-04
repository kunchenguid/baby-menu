# AGENTS.md

This file provides guidance for developing baby-menu itself.
Embedded agents launched from baby-menu should work from the active extension workspace and follow the copied `AGENTS.md` there for extension authoring.

## Commands

- `pnpm dev` - runs `scripts/dev.mjs`, prepares a gitignored `extensions-dev/` workspace by copying `extensions/AGENTS.md`, `extensions/babymenu-env.d.ts`, and `extensions/recipes/`, builds bundled ACP adapters into `out/adapters/`, and runs `electron-vite dev` from the current checkout. The app itself sees current uncommitted changes, while the embedded agent is launched inside `extensions-dev/`.
- `pnpm dev:reset` - removes `extensions-dev/` and `.cache/baby-menu/acp-sessions`, recreates the dev workspace with the latest `extensions/AGENTS.md`, `extensions/babymenu-env.d.ts`, and `extensions/recipes/`, and starts dev mode.
- `pnpm build` - build main, preload, renderer, and bundled ACP adapter bundles into `out/`.
- `pnpm generate:contracts` - regenerates `extensions/babymenu-env.d.ts` (the `@babymenu/contracts` surface) from `src/shared/contracts.ts`. Run after changing any extension-facing type or `src/shared/extension-contract-names.ts`, then commit the result; CI fails on a stale file.
- `pnpm package:mac` - cleans `release/`, builds the app, packages `release/mac-universal/Baby Menu Dev.app`, and ad-hoc signs it for local testing. Local/dev packaging uses `electron-builder.dev.yml`, which overrides `appId` to `com.kunchenguid.baby-menu.dev` and `productName` to `Baby Menu Dev` so locally-built bundles never collide with the released app (`com.kunchenguid.baby-menu`) in macOS LaunchServices. The CI release workflow builds from `electron-builder.yml` directly, keeps the production identity, and generates a Homebrew Cask that relaunches Baby Menu after upgrade only when the old app was already running before uninstall started.
- `pnpm dist:mac` - runs `package:mac` and creates `release/Baby-Menu-<version>-universal.dmg` from the dev bundle.
- `pnpm test` - run all Vitest tests.
- `pnpm test:e2e` - run only `tests/e2e-*.test.ts` (these include real `acpx/runtime` coverage against `acp-mock` plus bundled adapter coverage against fake local CLIs).
- `pnpm typecheck` / `pnpm lint` - both run `tsc --noEmit` against `tsconfig.json`.
- Single test: `pnpm vitest run tests/<name>.test.ts` (or `pnpm vitest run -t "<name pattern>"`).

Use `pnpm` (declared `packageManager: pnpm@11.1.1`). Renderer dev server is pinned to port 5273 (`strictPort: true`).

### Packaging hygiene for automation (no-mistakes and other agents)

Agents running in `no-mistakes` worktrees (or any throwaway checkout) must not leave packaged macOS bundles behind.
A `release/mac-universal/*.app` left on disk gets auto-registered by macOS LaunchServices, and stale registrations make `open -a "Baby Menu"`, login items, and bundle-id launches resolve to the wrong build.
Follow these rules:

- If a packaged bundle is genuinely required, build it (it will carry the `com.kunchenguid.baby-menu.dev` identity), then delete the entire `release/` directory before the run finishes so nothing is left for LaunchServices to register.
- Never set a locally-built bundle as a macOS login item, and never install one into `/Applications`. The released app is delivered only through the Homebrew cask.

## Dev mode helpers

- `BABY_MENU_KEEP_POPOVER_OPEN=1` disables the blur-to-hide behavior so the popover stays open while devtools / external windows have focus.
- `BABY_MENU_AGENT=<agent-name>` overrides agent auto-detection when no saved Settings choice exists. E2E tests pass `acpx-mock` via `registryOverrides`.
- `BABY_MENU_AGENT_TIMEOUT_MS=<ms>` overrides the embedded-agent request timeout.
- `BABY_MENU_TELEMETRY=0` (or `false` / `off`) disables packaged-release telemetry; `BABY_MENU_UMAMI_HOST` and `BABY_MENU_UMAMI_WEBSITE_ID` override the self-hosted Umami target for telemetry testing.
- `process.env.VITEST` is checked in `src/main/app.ts` so importing the main entry from tests does not auto-start the Electron app.

## Architecture

This is a macOS tray-bar Electron app whose distinguishing idea is that an embedded agent (running via `acpx/runtime`) edits the active extension workspace at runtime.
Tracked source extensions use git as the accept/rollback mechanism when selected explicitly; packaged mode edits `~/.baby-menu/extensions` and uses filesystem snapshots.

Three processes, kept deliberately separate:

1. **Main** (`src/main/`) - app lifecycle, tray, popover window, IPC, git, agent runtime. Never call agent or git from the renderer directly.
2. **Preload** (`src/preload/index.ts`) - the stable bridge. Exposes `window.babyMenu` via `contextBridge`. Do not add one-off preload methods for each widget.
3. **Renderer** (`src/renderer/`) - React UI: `AgentChat`, `WidgetHost`, custom popover layouts, `SettingsView`, `UpdateIndicator`, and app-shell controls such as Quit. Widgets, root `layout.tsx`, and extension settings sections should be hot reloadable and should not require an Electron restart for each new capability. The app shell and extension renderer surfaces share one design system, `@babymenu/ui` (`src/ui/`); see "Design system" below.
4. **Extension server actions and background tasks** - privileged filesystem, shell, network, credential, token, storage, notification, and background work should live behind extension-owned `server.ts` modules.
   Renderer widgets call these actions with `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
   Server actions live in the active extension workspace under `<extension-id>/server.ts` and export an `actions` object; background tasks export `background` from the same file.
   Do not add per-widget IPC channels or preload methods.

Shared types live in `src/shared/contracts.ts` - `BabyMenuApi`, `BabyMenuWidget`, `BabyMenuSettingsSection`, `GitSessionSnapshot`, etc. The `Window.babyMenu` global is declared here.

The extension-facing slice of that contract is a generated public surface, treated like the preload bridge and `@babymenu/ui` (see "Design system"). Extensions cannot see `src/shared/contracts.ts` (it lives inside the app bundle, not in the extension workspace), so the host ships those types into the workspace as the `@babymenu/contracts` virtual module, declared in `extensions/babymenu-env.d.ts`. That `.d.ts` is generated from `contracts.ts` by `scripts/generate-extension-dts.mjs` (run `pnpm generate:contracts`); the selected names live in `src/shared/extension-contract-names.ts`, and `BabyMenuExtensionApi` is the window-bridge subset extensions may use. Do not hand-edit `extensions/babymenu-env.d.ts`. After changing any extension-facing type in `contracts.ts`, or the name list, regenerate and commit the result - `tests/extension-contract-surface.test.ts` and the `ci.yml` "Verify generated contract types are up to date" step both fail on a stale file. Extensions import these types with a type-only `import ... from "@babymenu/contracts"`, which the compiler erases and never validates against the runtime import allowlist; importing a value from that specifier is rejected. The committed `babymenu-env.d.ts` is intentionally tracked (not release-only) because typecheck, `pnpm dev`, and packaging all read it. Never tell an extension or its agent to reach back into `../../src/shared/contracts`; that relative path resolves in source mode but does not exist in a packaged install, and chasing it is what previously sent the embedded agent scanning protected home-directory folders.

`src/main/` module index:

- `app.ts` - Electron lifecycle, popover window creation, packaged path setup, extension seeding, preferences, selectable-agent catalog wiring, protocols, tray, and IPC. `package.json#main` points here via `out/main/index.js`.
- `app-paths.ts` - resolves source paths versus packaged `~/.baby-menu` paths.
- `tray.ts` - macOS tray icon and click handling (`createBabyMenuTray`).
- `popover.ts` - popover `BrowserWindow` options (`createPopoverOptions`), adaptive width/height sizing (`responsivePopoverSize`), bounds math (`calculatePopoverBounds`), and renderer URL/file loading (`loadPopoverRenderer`).
- `ipc.ts` - registers all `ipcMain` handlers exposed via the preload bridge; the single place new generic IPC routes are added.
- `agent-catalog.ts` - defines built-in agents, parses custom `agents.json`, computes Settings availability, and builds `acpx` registry overrides.
- `agent-catalog-controller.ts` - owns the live agent catalog, validates Settings-added custom ACP agents, persists `agents.json`, and pushes refreshed registry overrides into the runtime without requiring an app restart.
- `agent-runtime.ts` - `BabyMenuAgentRuntime` wrapping `acpx/runtime`; gates every `send()` through a change session, enriches pending-session snapshots with diff-derived change labels, preserves structured turn failures, and retries once after deleting a stale persisted ACP session that reports `SESSION_RESUME_REQUIRED`.
- `agent-turn-log.ts` - structured per-turn transcript log used by diagnostics and tests; failed turns include the runtime error message plus optional `code` and `detailCode`.
- `git-change-session.ts` - the tracked-source Save/Rollback safety boundary (see below).
- `dev-extension-change-session.ts` - the snapshot Save/Rollback boundary for gitignored dev and packaged extension workspaces.
- `extension-change.ts` - shared helpers that classify actual workspace diffs into created, updated, or removed extension/layout changes for the Keep/Undo UI.
- `extension-seeder.ts` - self-heals the packaged extension workspace from the bundled template on every launch: it force-copies the shipped defaults (`AGENTS.md`, `babymenu-env.d.ts`, `recipes/`, and starter extensions) so a stale or edited managed file is restored, while leaving user-created extensions the template does not ship untouched (it never deletes them). If `~/.baby-menu/extensions` is a symlink, it copies into the resolved target without replacing the symlink, so home-manager `mkOutOfStoreSymlink` style writable targets work. Seeding failures are logged and skipped so tray startup can continue. Editing a managed default in `~/.baby-menu/extensions` therefore does not persist; change the source under `extensions/` instead.
- `extension-module-compiler.ts` - compiles extension widget, root layout, and server modules for production loading; rewrites the `react` and `@babymenu/ui` imports to host protocol modules and rejects any other external import.
- `widget-tailwind-css.ts` - compiles widget and layout authored Tailwind utilities against the `@babymenu/ui` `@theme` (single source of truth, `src/ui/theme.css`) for packaged loading.
- `widget-module-registry.ts` - discovers widget modules and the optional root `layout.tsx`, returning renderer `/@fs` URLs in dev and, in packaged mode, compiled `baby-menu-widget://` module URLs plus sibling compiled `cssUrl` files.
- `widget-protocol.ts` - registers custom protocols for compiled widget and layout modules, their `.css`, and the renderer host shims (`react`, `react/jsx-runtime`, and `@babymenu/ui` re-exported from the host global).
- `preferences.ts` - stores app preferences, including the selected agent, under the active app data root and applies login-item settings only when login items are allowed, keeping source/dev mode as a no-op for macOS login items.
- `shell-path.ts` - expands `PATH` for GUI launches so packaged apps can find agent CLIs.
- `update-checker.ts` - checks the latest GitHub Release at most every 4 hours, compares it to the running app version, opens the release page externally, and simulates an available update in source/dev mode so the header indicator can be exercised.
- `recipe-loader.ts` - discovers and parses `recipes/*.html` from the active extension workspace.
- `server-action-registry.ts` - discovers extension server actions and background task declarations from the active extension workspace, caches unchanged compiled server modules, and reloads them when the entry or local helper source changes.
- `background-task-scheduler.ts` - runs discovered extension background tasks on host-owned timers, hot-reloads changed tasks, and enforces the 60-second minimum interval.
- `extension-database.ts` - owns the shared local SQLite database exposed to extension server actions, background tasks, and widgets through the bridge.
- `notifier.ts` - backs `context.notify` for server actions and background tasks with native notifications.
- `telemetry.ts` - anonymous, best-effort usage telemetry to a self-hosted Umami instance. One fire-and-forget POST per event or page view to `/api/send`, no user/device id and no prompt or file contents, every network error swallowed. The Umami host and website id are injected at build time by the `define` block in `electron.vite.config.ts` (CI release sets `BABY_MENU_UMAMI_HOST` inline and reads `BABY_MENU_UMAMI_WEBSITE_ID` from the `vars.*` Actions variable - not a secret, since the website id is sent in plaintext in every payload and baked into the shipped bundle); when unset (source/dev/test) the build website id is empty and the client is a no-op, so the app never phones home outside packaged release builds. `app.ts` initializes the default client, fires `app_start`, and records each popover open as both the `/popover` page view and the `popover_open` event; `agent-runtime.ts` fires `agent_turn` (status `success` / `error` / `timeout` / `blocked_dirty`) and `agent_switch`. Set `BABY_MENU_TELEMETRY=0` (or `false`/`off`) to opt out, or override the target at runtime with `BABY_MENU_UMAMI_HOST` / `BABY_MENU_UMAMI_WEBSITE_ID`.

`src/adapters/` contains the bundled clean-room ACP adapters for built-in agents.
Claude Code and Codex are exposed to `acpx/runtime` as local adapter processes, while the adapters drive the real authenticated `claude` and `codex` CLIs in the active extension workspace.
The adapters intentionally run lean: they do not inherit user-level agent settings, skills, MCP servers, or extra rules.
The Codex adapter makes one narrow exception: because `--ignore-user-config` also discards the configured default model, it reads only the top-level `model` from `$CODEX_HOME/config.toml` or `~/.codex/config.toml` and passes that value back as `--model`.

`src/renderer/` extension loading modules:

- `extension-modules.ts` - shared runtime loader for extension `widget.tsx` and root `layout.tsx` modules, including dynamic import and packaged-mode stylesheet injection for widgets, layouts, and settings sections.
- `settings/settings-sections.ts` - extracts `BabyMenuSettingsSection` exports from loaded extension modules and sorts them by extension id for stable Settings page order.

### Electron build wiring

`electron.vite.config.ts` has three roots:

- `main` entry: `src/main/app.ts` -> `out/main/index.js` (this is `package.json#main`).
- `preload` entry: `src/preload/index.ts` -> `out/preload/index.js`.
- `renderer` root: `src/renderer/` -> `out/renderer/`. In dev, main loads `process.env.ELECTRON_RENDERER_URL`; in production it loads `out/renderer/index.html` via `loadFile`.

`scripts/build-adapters.mjs` bundles `src/adapters/claude/index.ts` and `src/adapters/codex/index.ts` to `out/adapters/<name>/index.mjs` after `electron-vite build`.
`pnpm dev` runs the same adapter build before launching Electron because dev runtime paths also resolve adapters from `out/adapters/`.
Packaged builds keep `out/adapters/**` in `app.asar.unpacked` because adapter processes are spawned as standalone Node programs and cannot execute from inside `app.asar`.

`typescript` is intentionally externalized from the production main bundle because `extension-module-compiler.ts` imports it at runtime to compile packaged extensions.
Keep `typescript` in runtime dependencies unless that compiler path changes.
`tailwindcss`, `@tailwindcss/postcss`, and `postcss` are externalized for the same reason: `widget-tailwind-css.ts` runs Tailwind in the main process to compile widget and layout CSS in packaged mode.
Keep them in runtime dependencies, and keep the single pinned `postcss` (`pnpm-workspace.yaml` `overrides`) so the Tailwind plugin and the processor share one version.
Universal macOS packages must run on both Intel and Apple Silicon Macs, so `pnpm-workspace.yaml` keeps Darwin `x64` and `arm64` native prebuilt dependencies installed, and `electron-builder.yml` `x64ArchFiles` must preserve architecture-specific native package files during the universal merge.
Keep `electron-builder` at `26.8.2` or newer; older releases can omit transitive dependencies from pnpm-deduped package trees and ship broken app bundles.
The renderer build adds `@tailwindcss/vite` and aliases `@babymenu/ui` to `src/ui/index.ts` so dev-mode widgets resolve the design system directly.

### Design system (`@babymenu/ui`)

`src/ui/` is a shadcn-derived component kit (Radix + Tailwind v4) restyled to the Monochrome Lab tokens, shared by the app shell and extension widgets.
`src/ui/theme.css` is the single `@theme` source of truth: it wipes Tailwind's default palette so only token colors exist, and it is consumed by both the renderer build (`src/ui/styles.css`) and the per-widget/layout compiler (imported `?raw` into the main bundle).
Delivery mirrors the React shim exactly: `main.tsx` installs the kit on `window.__BABY_MENU_WIDGET_HOST__.ui`, `widget-protocol.ts` serves `baby-menu-host://ui/index.mjs` as a thin re-export, and the compiler rewrites the bare `@babymenu/ui` specifier to that URL - so Radix, cva, and lucide stay inside the host bundle and never reach the widget import allowlist.
`src/shared/ui-exports.ts` is the public surface contract (treated like the preload bridge): the barrel, the contract list, and the generated host shim are kept in lockstep by `tests/ui-export-contract.test.ts`, so changing a public export is a deliberate, tested act.
Extension widgets, root layouts, and settings sections may additionally import only `@babymenu/ui`; they author token-scoped Tailwind utilities, and their stylesheet is compiled and injected automatically.

`createPopoverOptions` enforces `frame:false`, `contextIsolation:true`, `nodeIntegration:false`, `skipTaskbar:true`, `alwaysOnTop:true`. Do not relax these without a reason.
On macOS, `app.ts` appends Chromium's `use-mock-keychain` switch before app readiness, so do not rely on Chromium or renderer storage for keychain-backed secrets.
Keep credential and token work in extension server actions.

### Agent runtime + change sessions

`BabyMenuAgentRuntime` (`src/main/agent-runtime.ts`) wraps `acpx/runtime`. It allows only one active `send()` call at a time; overlapping sends return an "already running" assistant response before any change session begins. The active agent comes from the persisted Settings choice, then `BABY_MENU_AGENT`, then catalog auto-detection. The catalog defaults to Claude Code and Codex, and may be extended by `agents.json` under the active app data root (`~/.baby-menu/agents.json` when packaged, repo-root `agents.json` in source mode). Built-in Claude Code and Codex entries are registered as `acpx` overrides that launch the bundled adapters, while availability still probes the wrapped local CLI (`claude` or `codex`). Settings can add, edit, and remove custom ACP agents by collecting a name, optional label, and launch command; those entries are persisted to `agents.json`, apply immediately through refreshed registry overrides, and remain editable/removable while built-ins stay read-only. Switching agents through Settings is blocked while an agent turn is running or while a change session can still be saved or rolled back; a successful switch closes the current persistent session with `discardPersistentState` so the next turn starts a fresh conversation.
Every accepted `send()` call:

1. Resolves the active extension workspace from runtime paths. Source mode honors `BABY_MENU_EXTENSIONS_DIR` or defaults to `extensions/`; packaged mode uses `~/.baby-menu/extensions` after best-effort seeding of bundled templates, resolving a symlinked workspace target when present. Dev/source Tailwind utility generation scans only `extensions/` and `extensions-dev/` unless `src/ui/styles.css` or `src/ui/styles.dev.css` is given an additional `@source` path, so custom overrides outside those directories may load widget modules without their utility CSS.
2. Uses `DevExtensionChangeSession` for snapshot workspaces such as `extensions-dev/` and packaged `~/.baby-menu/extensions`, so Save keeps generated files, Rollback restores the pre-turn contents in place, and pending-session labels come from comparing the snapshot to the current workspace.
   Snapshot rollback must preserve a symlinked workspace node, restore files/directories/symlinks/binary contents/modes through that path, ignore and preserve existing user-owned `.git` metadata, and remove `.git` metadata that was created during the turn.
3. Uses `GitChangeSession.begin(rootDir, agentCwd)` only for the tracked source `extensions/` workspace when that workspace is selected explicitly. If the working tree is dirty, it short-circuits and returns a refusal message instead of running the agent - this is intentional; do not bypass it for tracked edits.
4. Lazily constructs the ACP runtime with `createFileSessionStore({ stateDir })` under `.cache/baby-menu/acp-sessions` in source mode or `~/.baby-menu/cache/acp-sessions` in packaged mode, with `permissionMode: "approve-all"`.
5. Uses a fixed `sessionKey: "baby-menu-agent-chat"` so the agent has a single persistent conversation.
6. If a failed turn returns `SESSION_RESUME_REQUIRED`, closes the runtime, removes `<stateDir>/sessions/baby-menu-agent-chat.json`, and retries the prompt once so bundled adapters that do not support `session/load` recover after an app restart.
   The failed attempt is still written to `.cache/baby-menu/agent-turns` with its error `message`, `code`, and `detailCode`; if the retry fails, the renderer surfaces the real thrown message instead of replacing it with a generic unavailable reason.

`GitChangeSession` (`src/main/git-change-session.ts`) is the safety boundary for Save/Rollback and maps changed git paths under the active extension workspace to extension ids or the root layout. Both operations refuse unless: the session started clean, the session is not already completed, and `HEAD` has not moved since the session began. `rollback()` runs `git reset --hard <recorded HEAD>` + `git clean -fd` - those destructive commands are only acceptable because of the preceding guards. Preserve this invariant.

After a turn, `BabyMenuAgentRuntime` enriches the `GitSessionSnapshot` with `dirty` and `changes` from the actual workspace diff, never from the agent's prose. If `dirty` is false, it silently saves/closes the active session so the renderer can say no files changed instead of offering a useless Keep/Rollback prompt. When files did change, the renderer summarizes one changed extension, multiple changed extensions, or a root `layout.tsx` edit for the Keep/Undo bar; clicking Keep clears the bar without showing a second kept confirmation.

Packaged runtime state lives under `~/.baby-menu` and is not git-backed.
Do not write generated extension files, the local extension database, compiled modules, preferences, logs, snapshots, or ACP session state into the `.app` bundle.

### Recipes and extensions

- Recipes are HTML files in `recipes/` inside the active extension workspace. `recipe-loader.ts` discovers `*.html`, sorts them, and extracts the title from `<title>` or first `<h1>`. They are intentionally HTML so the embedded agent can read them from its cwd and use embedded interactive demos.
- Extensions live in the active extension workspace under `<extension-id>/` and may include `widget.tsx`, `server.ts`, and local helper files; the workspace may also include one root `layout.tsx` that arranges active widgets.
- Packaged widgets, root layouts, settings sections, and server actions are compiled into `~/.baby-menu/cache` and loaded through custom protocols or cached modules; dev mode keeps Vite `/@fs` loading for renderer modules.
- Root `layout.tsx` default-exports a `BabyMenuLayout`, receives active widget metadata plus `renderWidget(id)`, owns the popover canvas arrangement, and lets the popover adapt to the canvas width plus chrome and the rendered height.
- Widgets conform to `BabyMenuWidget` / `RefreshableBabyMenuWidget`. The `WidgetHost` owns visible-widget refresh timing via `useViewRefresh`, using the main-process popover visibility signal - widgets should not start their own polling.
- Settings sections conform to `BabyMenuSettingsSection`, are exported from `widget.tsx`, and own only the section body; `SettingsView` owns the frame and rediscovers sections when settings refresh or the popover reopens.
- New widgets and capabilities should be built as self-contained extensions behind the stable `window.babyMenu` bridge.
- Extension server actions and background tasks are discovered dynamically from the active extension workspace, so new or changed capabilities can be picked up without changing preload.
- Server action modules keep one module instance while `server.ts` and its local imports are unchanged, so module-scope state can survive repeated `invoke` calls and background ticks.
- That state is reset on code edits and app restarts; durable extension state belongs in the shared SQLite store, not module scope.
- Use `viewRefreshIntervalMs` / `refreshView` for live data that only matters while the popover is visible, and use background tasks only for work that must keep running while the popover is closed.
- Extension data that should persist locally belongs in the shared SQLite store, exposed as `context.db` server-side and `window.babyMenu.db` renderer-side; keep heavy queries out of widgets.
- The embedded agent should be steered toward editing its active extension workspace. The Electron core in `src/main/`, `src/preload/`, and shared IPC wiring is meant to be boring infrastructure.

### Recipe authoring best practices

- Recipes must be self-contained implementation specs.
- Do not tell the agent to inspect another repository, website, blog post, or external implementation guide before it can implement the recipe.
- It is fine to mention inspiration or provenance, but copy the actionable details into the recipe itself: commands, endpoints, local file paths, parser expectations, fallback order, security notes, IPC shape, files to edit, live verification steps, and acceptance criteria.
- A recipe should let an agent implement the feature from the recipe plus this repo alone.
- Each recipe should include a clear capability statement, expected user-facing behavior, recommended data-source order, implementation contract, error handling, security constraints, interactive demo, and acceptance criteria.
- For privileged work, explicitly say that filesystem, shell, network, credential, and token access belongs in extension-owned server actions behind `window.babyMenu.capabilities.invoke`.
- For durable local data, explicitly say whether the widget should read directly from `window.babyMenu.db`, whether a server action should use `context.db`, or whether a background task should persist data for later widget reads.
- For ongoing work, explicitly distinguish visible-widget refresh from background tasks and require the slowest acceptable interval.
- Renderer widgets and settings sections should receive normalized data over `window.babyMenu` and should not add new preload methods for each capability.
- If a real data source may be unavailable, require an explicit unavailable or sign-in-required result rather than a mock fallback; recipes should use real data only and must not fabricate or silently substitute mock data. Only specify labeled sample data when the user explicitly asks for examples.
- Define normalized TypeScript shapes in the recipe so the agent knows what data extension server actions should return to widgets.
- Include parser guidance for command or API output, including timeout behavior, stale-data behavior, and user-visible errors.
- Never include or ask for committed secrets, tokens, cookie values, or local credential dumps.
- Standalone recipe HTML should use daisyUI from CDN and the `wireframe` theme.
- Include these tags in recipe HTML: `<link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />`, `<link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />`, and `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>`.
- Set `<html data-theme="wireframe">` on recipe pages.
- Avoid custom `<style>` blocks in recipes unless there is a specific interaction that cannot be expressed with daisyUI and Tailwind utilities.
- Keep recipe typography readable: use a bounded content width such as `max-w-4xl`, body copy around `text-base`, comfortable `leading-7`, clear heading hierarchy, restored bullet and numbered list styles, and smaller text for code and tables.
- Prefer daisyUI components such as `card`, `table`, `btn`, `progress`, and `mockup-code` for recipe structure and demos instead of hand-written CSS.
- When changing recipe conventions, update `tests/recipe-loader.test.ts` so the convention is protected by regression tests.

## Conventions

- TDD is required for bug fixes and new features (skip only for docs / metadata / ephemeral artifacts). Tests live in `tests/` at the repo root, not co-located.
- TypeScript is strict; `moduleResolution: "Bundler"`, ESM (`"type": "module"`). Tests use Vitest with `vitest/globals` types.
- Never auto-add agent co-author lines to commit messages.
- Avoid em dashes; use plain `-`.
