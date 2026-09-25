# AGENTS.md

This file provides guidance for developing baby-menu itself.
Embedded agents launched from baby-menu work from the active extension workspace and follow the copied `AGENTS.md` there (source: `extensions/AGENTS.md`).
`VISION.md` is the project's acceptance policy; use its aligns/resisted tests when judging whether a change belongs here.

Detail lives in the docs: `docs/architecture.md` (runtime design, security boundaries, public extension surfaces, source module index), `docs/development.md` (commands, dev flags, build wiring, packaging), `docs/configuration.md` (state, agents, user env flags), `docs/recipes.md` (recipe authoring), and `CONTRIBUTING.md` (workflow, release).

## Commands

- Use `pnpm` (`packageManager: pnpm@11.1.1`). Full command table: `docs/development.md#commands`.
- `pnpm dev` runs the app from this checkout while the embedded agent edits the gitignored `extensions-dev/` copy; `pnpm dev:reset` recreates it and clears ACP sessions.
- `pnpm test`, `pnpm test:e2e` (`tests/e2e-*.test.ts`), `pnpm typecheck` (same as `pnpm lint`), `pnpm build`.
- Single test: `pnpm vitest run tests/<name>.test.ts` or `pnpm vitest run -t "<pattern>"`.

## Hard rules

- Three processes stay separate: main (`src/main/`) owns agent, git, filesystem, and IPC; the renderer never calls them directly and goes through the `window.babyMenu` preload bridge.
- Do not add per-widget IPC channels or preload methods. Privileged extension work (filesystem, shell, network, credentials, tokens, storage, notifications, background work) belongs in extension-owned `<extension-id>/server.ts`, called via `window.babyMenu.capabilities.invoke`. Generic IPC routes go only in `src/main/ipc.ts`.
- Keep `createPopoverOptions` security flags (`contextIsolation:true`, `nodeIntegration:false`, etc.) unless there is a real reason; Chromium uses a mock keychain, so never keep secrets in renderer storage.
- Change sessions are the Save/Rollback safety boundary. Never bypass `GitChangeSession`'s dirty-tree refusal or its clean/not-completed/`HEAD`-unmoved guards, which are what make its `git reset --hard` + `git clean -fd` rollback acceptable. Snapshot rollback must restore in place, preserve a symlinked workspace, and preserve user-owned `.git` metadata.
- Keep/Undo state comes from the actual workspace diff, never from agent prose.
- Never write packaged runtime state (extensions, database, compiled modules, preferences, logs, snapshots, ACP sessions) into the `.app` bundle; it lives under `~/.baby-menu`.
- Managed defaults under `~/.baby-menu/extensions` are force-reseeded on launch; change `extensions/` instead. User-created extensions are never deleted.
- Baby Menu ships a neutral extension platform. Provider-specific widgets belong in user-installed extensions, never in the bundled default inventory (the `extensions` `extraResources` filter in `electron-builder.yml`).
- Public surfaces are deliberate, tested contracts: the preload bridge, `@babymenu/ui` (`src/shared/ui-exports.ts`), and `@babymenu/contracts`. Extension renderer modules may import only `react` and `@babymenu/ui` (server modules also Node builtins), plus type-only imports from `@babymenu/contracts`.
- After changing an extension-facing type in `src/shared/contracts.ts` or `src/shared/extension-contract-names.ts`, run `pnpm generate:contracts` and commit `extensions/babymenu-env.d.ts`. Never hand-edit that file, and never point an extension or its agent at `../../src/shared/contracts` (it does not exist in packaged installs).
- `src/ui/theme.css` is the single `@theme` source of truth for the shell and extension Tailwind.
- Keep `typescript`, `tailwindcss`, `@tailwindcss/postcss`, and `postcss` as runtime dependencies (externalized for packaged extension compilation) and keep the single pinned `postcss` override. Keep `esbuild` build-only.
- Recipes must be self-contained, use real data only (no mock fallbacks), and never include secrets; follow `docs/recipes.md` and update `tests/recipe-loader.test.ts` when recipe conventions change.

## Packaging hygiene for automation

- Local `pnpm package:mac` builds carry the `Baby Menu Dev` / `com.kunchenguid.baby-menu.dev` identity; never change that to the production identity.
- In `no-mistakes` worktrees or any throwaway checkout, delete the entire `release/` directory before finishing, so LaunchServices cannot register a stale `.app`.
- Never set a locally built bundle as a macOS login item and never install one into `/Applications`. The released app ships only through the Homebrew cask.

## Conventions

- TDD is required for bug fixes and new features (skip only for docs, metadata, or ephemeral artifacts). Tests live in `tests/` at the repo root, not co-located.
- TypeScript is strict ESM with `moduleResolution: "Bundler"`; tests use Vitest globals.
- Never auto-add agent co-author lines to commit messages.
- Avoid em dashes; use plain `-`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
