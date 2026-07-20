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
| Fixed host brokers | Narrow privileged operations can be exposed only to server code. `context.kimiQuota` resolves Pi's `kimi-coding` API key and returns normalized quota without exposing general Pi SDK access. |
| Local storage | A shared SQLite store: `context.db` server-side, `window.babyMenu.db` in the renderer. Use it for anything that must survive reloads. |
| Stable contracts | Extensions import host types with type-only `import ... from "@babymenu/contracts"`, shipped into each workspace. |

Recipes for live or system data are also verification contracts.
They tell the agent to inspect the actual named source before writing parser or renderer code, avoid guessed field names and response shapes, and verify the finished server action or widget against that same live source before reporting done.
The bundled quota recipe set covers Claude Code, Codex, Cursor, GitHub Copilot, and Grok.
Provider-specific acquisition and refresh contracts live in the matching recipe.
Kimi Code quota ships directly as the managed `extensions/kimi-code-quota` extension. Its host broker fixes the origin and operation, enforces transport/parser/cache bounds, coalesces requests, and persists only normalized non-secret results in `kimi_quota_cache`.

**Background vs view refresh.**
`refreshView` / `viewRefreshIntervalMs` keeps a visible widget current and pauses while the popover is hidden.
`export const background` in `server.ts` runs on a host-owned timer (60-second minimum) for work that must continue while the popover is closed.
The managed Kimi widget uses a five-minute `runOnStart` background task and asks the same single-flight broker to refresh on popover open only when the last success is older than 60 seconds; it owns no renderer timer.

**Module lifetime.**
An unchanged `server.ts` module instance stays alive across invokes and background ticks, so module-scope values are only an ephemeral cache - they reset on code edits or app restarts.

## Agent runtime

- **Bundled ACP adapters.**
  Built-in Claude Code and Codex launch `out/adapters/<name>/index.mjs`, wrapping the local authenticated CLI in isolation from user-level agent config.
  Codex still reuses only the top-level `model` from `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`) so `--ignore-user-config` does not force an unsupported default.
- **Terminal failure semantics.**
  CLI, authentication, rate-limit, and provider failures reject through ACP with typed, bounded messages; raw provider payloads are never streamed or logged as user-facing errors.
  Baby Menu also treats a completed ACP refusal as a failed editing turn, records failed diagnostics and telemetry, and strips nested transport error wrappers before displaying the safe message.
- **Stale session recovery.**
  If a restart leaves a persisted ACP session an adapter cannot resume, Baby Menu records the failed attempt, deletes the stale record, and retries once with a fresh session.
- **Live custom agent catalog.**
  Settings-owned custom ACP agents persist to `agents.json` and register as `acpx` overrides immediately, kept separate from read-only built-ins.

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
