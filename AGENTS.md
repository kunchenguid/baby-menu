# AGENTS.md

This file provides guidance for developing baby-menu itself.
Embedded agents launched from baby-menu should work from the active extension workspace and follow the copied `AGENTS.md` there for extension authoring.

## Commands

- `pnpm dev` - runs `scripts/dev.mjs`, prepares a gitignored `extensions-dev/` workspace by copying `extensions/AGENTS.md` and `extensions/recipes/`, and runs `electron-vite dev` from the current checkout. The app itself sees current uncommitted changes, while the embedded agent is launched inside `extensions-dev/`.
- `pnpm dev:reset` - removes `extensions-dev/`, recreates it with the latest `extensions/AGENTS.md` and `extensions/recipes/`, and starts dev mode.
- `pnpm build` - build main, preload, and renderer bundles into `out/`.
- `pnpm package:mac` - builds the app, packages `release/mac-universal/Baby Menu.app`, and ad-hoc signs it for local testing.
- `pnpm dist:mac` - runs `package:mac` and creates `release/Baby-Menu-<version>-universal.dmg`.
- `pnpm test` - run all Vitest tests.
- `pnpm test:e2e` - run only `tests/e2e-*.test.ts` (these spawn the real `acpx/runtime` against the `acp-mock` CLI in `node_modules/acp-mock/dist/cli.js`).
- `pnpm typecheck` / `pnpm lint` - both run `tsc --noEmit` against `tsconfig.json`.
- Single test: `pnpm vitest run tests/<name>.test.ts` (or `pnpm vitest run -t "<name pattern>"`).

Use `pnpm` (declared `packageManager: pnpm@11.1.1`). Renderer dev server is pinned to port 5273 (`strictPort: true`).

## Dev mode helpers

- `BABY_MENU_KEEP_POPOVER_OPEN=1` disables the blur-to-hide behavior so the popover stays open while devtools / external windows have focus.
- `BABY_MENU_AGENT=<agent-name>` selects the ACP agent. E2E tests pass `acpx-mock` via `registryOverrides`.
- `process.env.VITEST` is checked in `src/main/app.ts` so importing the main entry from tests does not auto-start the Electron app.

## Architecture

This is a macOS tray-bar Electron app whose distinguishing idea is that an embedded agent (running via `acpx/runtime`) edits the active extension workspace at runtime.
Tracked source extensions use git as the accept/rollback mechanism when selected explicitly; packaged mode edits `~/.baby-menu/extensions` and uses filesystem snapshots.

Three processes, kept deliberately separate:

1. **Main** (`src/main/`) - app lifecycle, tray, popover window, IPC, git, agent runtime. Never call agent or git from the renderer directly.
2. **Preload** (`src/preload/index.ts`) - the stable bridge. Exposes `window.babyMenu` via `contextBridge`. Do not add one-off preload methods for each widget.
3. **Renderer** (`src/renderer/`) - React UI: `AgentChat`, `WidgetHost`, `SettingsView`, and app-shell controls such as Quit. Widgets should be hot reloadable and should not require an Electron restart for each new capability. The app shell and extension widgets share one design system, `@babymenu/ui` (`src/ui/`); see "Design system" below.
4. **Extension server actions** - privileged filesystem, shell, network, credential, and token work should live behind extension-owned server actions invoked through the stable generic capability bridge.
   Renderer widgets call these actions with `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
   Server actions live in the active extension workspace under `<extension-id>/server.ts` and export an `actions` object.
   Do not add per-widget IPC channels or preload methods.

Shared types live in `src/shared/contracts.ts` - `BabyMenuApi`, `BabyMenuWidget`, `GitSessionSnapshot`, etc. The `Window.babyMenu` global is declared here.

`src/main/` module index:

- `app.ts` - Electron lifecycle, popover window creation, packaged path setup, extension seeding, preferences, protocols, tray, and IPC. `package.json#main` points here via `out/main/index.js`.
- `app-paths.ts` - resolves source paths versus packaged `~/.baby-menu` paths.
- `tray.ts` - macOS tray icon and click handling (`createBabyMenuTray`).
- `popover.ts` - popover `BrowserWindow` options (`createPopoverOptions`), bounds math (`calculatePopoverBounds`), and renderer URL/file loading (`loadPopoverRenderer`).
- `ipc.ts` - registers all `ipcMain` handlers exposed via the preload bridge; the single place new generic IPC routes are added.
- `agent-runtime.ts` - `BabyMenuAgentRuntime` wrapping `acpx/runtime`; gates every `send()` through a change session.
- `agent-turn-log.ts` - structured per-turn transcript log used by the renderer and tests.
- `git-change-session.ts` - the tracked-source Save/Rollback safety boundary (see below).
- `dev-extension-change-session.ts` - the snapshot Save/Rollback boundary for gitignored dev and packaged extension workspaces.
- `extension-seeder.ts` - seeds bundled extension templates into the packaged extension workspace.
- `extension-module-compiler.ts` - compiles extension widget and server modules for production loading; rewrites the `react` and `@babymenu/ui` imports to host protocol modules and rejects any other external import.
- `widget-tailwind-css.ts` - compiles a widget's authored Tailwind utilities against the `@babymenu/ui` `@theme` (single source of truth, `src/ui/theme.css`) for packaged loading.
- `widget-module-registry.ts` - discovers widget modules, returning a renderer `/@fs` URL in dev and, in packaged mode, a compiled `baby-menu-widget://` module URL plus a sibling compiled `cssUrl`.
- `widget-protocol.ts` - registers custom protocols for compiled widget modules, the per-widget `.css`, and the renderer host shims (`react`, `react/jsx-runtime`, and `@babymenu/ui` re-exported from the host global).
- `preferences.ts` - stores app preferences under the active app data root and applies login-item settings only when login items are allowed, keeping source/dev mode as a no-op for macOS login items.
- `shell-path.ts` - expands `PATH` for GUI launches so packaged apps can find agent CLIs.
- `recipe-loader.ts` - discovers and parses `recipes/*.html` from the active extension workspace.
- `server-action-registry.ts` - dynamically loads extension server actions from the active extension workspace and exposes them through the generic capability bridge.

### Electron build wiring

`electron.vite.config.ts` has three roots:

- `main` entry: `src/main/app.ts` -> `out/main/index.js` (this is `package.json#main`).
- `preload` entry: `src/preload/index.ts` -> `out/preload/index.js`.
- `renderer` root: `src/renderer/` -> `out/renderer/`. In dev, main loads `process.env.ELECTRON_RENDERER_URL`; in production it loads `out/renderer/index.html` via `loadFile`.

`typescript` is intentionally externalized from the production main bundle because `extension-module-compiler.ts` imports it at runtime to compile packaged extensions.
Keep `typescript` in runtime dependencies unless that compiler path changes.
`tailwindcss`, `@tailwindcss/postcss`, and `postcss` are externalized for the same reason: `widget-tailwind-css.ts` runs Tailwind in the main process to compile per-widget CSS in packaged mode.
Keep them in runtime dependencies, and keep the single pinned `postcss` (`pnpm-workspace.yaml` `overrides`) so the Tailwind plugin and the processor share one version.
The renderer build adds `@tailwindcss/vite` and aliases `@babymenu/ui` to `src/ui/index.ts` so dev-mode widgets resolve the design system directly.

### Design system (`@babymenu/ui`)

`src/ui/` is a shadcn-derived component kit (Radix + Tailwind v4) restyled to the Monochrome Lab tokens, shared by the app shell and extension widgets.
`src/ui/theme.css` is the single `@theme` source of truth: it wipes Tailwind's default palette so only token colors exist, and it is consumed by both the renderer build (`src/ui/styles.css`) and the per-widget compiler (imported `?raw` into the main bundle).
Delivery mirrors the React shim exactly: `main.tsx` installs the kit on `window.__BABY_MENU_WIDGET_HOST__.ui`, `widget-protocol.ts` serves `baby-menu-host://ui/index.mjs` as a thin re-export, and the compiler rewrites the bare `@babymenu/ui` specifier to that URL - so Radix, cva, and lucide stay inside the host bundle and never reach the widget import allowlist.
`src/shared/ui-exports.ts` is the public surface contract (treated like the preload bridge): the barrel, the contract list, and the generated host shim are kept in lockstep by `tests/ui-export-contract.test.ts`, so changing a public export is a deliberate, tested act.
Extension widgets may additionally import only `@babymenu/ui`; they author token-scoped Tailwind utilities, and the per-widget stylesheet is compiled and injected automatically.

`createPopoverOptions` enforces `frame:false`, `contextIsolation:true`, `nodeIntegration:false`, `skipTaskbar:true`, `alwaysOnTop:true`. Do not relax these without a reason.
On macOS, `app.ts` appends Chromium's `use-mock-keychain` switch before app readiness, so do not rely on Chromium or renderer storage for keychain-backed secrets.
Keep credential and token work in extension server actions.

### Agent runtime + change sessions

`BabyMenuAgentRuntime` (`src/main/agent-runtime.ts`) wraps `acpx/runtime`. It allows only one active `send()` call at a time; overlapping sends return an "already running" assistant response before any change session begins. Every accepted `send()` call:

1. Resolves the active extension workspace from runtime paths. Source mode honors `BABY_MENU_EXTENSIONS_DIR` or defaults to `extensions/`; packaged mode uses `~/.baby-menu/extensions` after seeding bundled templates. Dev/source Tailwind utility generation scans only `extensions/` and `extensions-dev/` unless `src/ui/styles.css` or `src/ui/styles.dev.css` is given an additional `@source` path, so custom overrides outside those directories may load widget modules without their utility CSS.
2. Uses `DevExtensionChangeSession` for snapshot workspaces such as `extensions-dev/` and packaged `~/.baby-menu/extensions`, so Save keeps generated files and Rollback restores the pre-turn contents.
3. Uses `GitChangeSession.begin(rootDir)` only for the tracked source `extensions/` workspace when that workspace is selected explicitly. If the working tree is dirty, it short-circuits and returns a refusal message instead of running the agent - this is intentional; do not bypass it for tracked edits.
4. Lazily constructs the ACP runtime with `createFileSessionStore({ stateDir })` under `.cache/baby-menu/acp-sessions` in source mode or `~/.baby-menu/cache/acp-sessions` in packaged mode, with `permissionMode: "approve-all"`.
5. Uses a fixed `sessionKey: "baby-menu-agent-chat"` so the agent has a single persistent conversation.

`GitChangeSession` (`src/main/git-change-session.ts`) is the safety boundary for Save/Rollback. Both operations refuse unless: the session started clean, the session is not already completed, and `HEAD` has not moved since the session began. `rollback()` runs `git reset --hard <recorded HEAD>` + `git clean -fd` - those destructive commands are only acceptable because of the preceding guards. Preserve this invariant.

Packaged runtime state lives under `~/.baby-menu` and is not git-backed.
Do not write generated extension files, compiled modules, preferences, logs, snapshots, or ACP session state into the `.app` bundle.

### Recipes and extensions

- Recipes are HTML files in `recipes/` inside the active extension workspace. `recipe-loader.ts` discovers `*.html`, sorts them, and extracts the title from `<title>` or first `<h1>`. They are intentionally HTML so the embedded agent can read them from its cwd and use embedded interactive demos.
- Extensions live in the active extension workspace under `<extension-id>/` and may include `widget.tsx`, `server.ts`, and local helper files.
- Packaged widgets and server actions are compiled into `~/.baby-menu/cache` and loaded through custom protocols or cached modules; dev mode keeps Vite `/@fs` loading.
- Widgets conform to `BabyMenuWidget` / `RefreshableBabyMenuWidget`. The `WidgetHost` owns refresh timing via `useWidgetRefresh` - widgets should not start their own polling.
- New widgets and capabilities should be built as self-contained extensions behind the stable `window.babyMenu` bridge.
- Extension server actions are discovered dynamically from the active extension workspace, so new or changed actions can be picked up without changing preload.
- The embedded agent should be steered toward editing its active extension workspace. The Electron core in `src/main/`, `src/preload/`, and shared IPC wiring is meant to be boring infrastructure.

### Recipe authoring best practices

- Recipes must be self-contained implementation specs.
- Do not tell the agent to inspect another repository, website, blog post, or external implementation guide before it can implement the recipe.
- It is fine to mention inspiration or provenance, but copy the actionable details into the recipe itself: commands, endpoints, local file paths, parser expectations, fallback order, security notes, IPC shape, files to edit, tests to add, and acceptance criteria.
- A recipe should let an agent implement the feature from the recipe plus this repo alone.
- Each recipe should include a clear capability statement, expected user-facing behavior, recommended data-source order, implementation contract, error handling, security constraints, interactive demo, and acceptance criteria.
- For privileged work, explicitly say that filesystem, shell, network, credential, and token access belongs in extension-owned server actions behind `window.babyMenu.capabilities.invoke`.
- Renderer widgets should receive normalized data over `window.babyMenu` and should not add new preload methods for each capability.
- If a real data source may be unavailable, define the mock fallback and require the UI to label it as mock data.
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
