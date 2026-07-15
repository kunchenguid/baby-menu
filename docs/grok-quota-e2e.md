# Grok quota popover E2E

Run the unattended macOS check with:

```sh
pnpm test:e2e:grok-popover
```

The command requires a current supported OIDC or legacy sign-in entry in the provider-owned Grok auth file.
The live run injects a temporary sentinel executable and fails if the generated server attempts any healthy-session CLI preflight or credential refresh.
The generated server's production contract invokes the documented non-prompt `grok models` capability only after local expiry or one credential-classified exact-source response, then rereads auth, verifies principal continuity, and retries once.
It does not run `grok login`, perform a healthy-session CLI preflight, implement OAuth, change account configuration, print credential values, import browser credentials, or retain raw provider output.
Separate deterministic expired-token, 401, gRPC credential, reread, principal-continuity, timeout, and stale-cache regression tests use only temporary fake executables and synthetic auth.
The live same-window parity run does not deliberately expire credentials or force a refresh, and it verifies that auth bytes and modification time remain unchanged when the healthy bearer succeeds.

The command starts the current source app with a temporary extension workspace under `extensions-dev/`, keeps the real Electron popover open, and connects to its renderer over a loopback-only Chrome DevTools port.
`BABY_MENU_OPEN_POPOVER_ON_START=1` opens the same `BrowserWindow` through the tray controller's real bounds path, so no accessibility click or human interaction is required.
`BABY_MENU_REMOTE_DEBUGGING_PORT` enables the loopback inspection endpoint used only for this explicit run.
The normal `WidgetHost`, preload capability bridge, server-action registry, extension compiler, SQLite store, renderer, and host-owned refresh scheduling are all exercised.

The default generated-install mode uses the committed generated extension contract.
Set `BABY_MENU_GROK_E2E_INSTALLED_SOURCE=1` for installed-widget source mode after the installed source implements the same schema version 2 contract.
That mode copies `~/.baby-menu/extensions/grok-quota` into the temporary workspace, rewrites only its copied extension id and cache table to test-owned names, and leaves the installed source and live cache untouched.
Set `BABY_MENU_GROK_E2E_INSTALLED_SOURCE_DIR` only when the authoritative installed source is at another path.

Both modes wrap the copied server action with test-only lifecycle instrumentation.
Before Electron starts, the runner seeds its isolated cache table with an unversioned, wrong-source, expired-reset row whose writer provenance is unknown.
The startup acquisition must reject that row and replace it only after exact-source success with schema version 2, source version 1, operation provenance, field provenance, and an equal principal binding.
The runner reads back only schema/provenance status and an identity/scope equality boolean, never cached values, principal material, or raw provider data.

The independent `consumerOracle` calls the exact consumer `GetGrokCreditsConfig` gRPC-web operation used by the Grok Usage page and CodexBar's web strategy.
It uses the same deterministic OIDC-over-legacy principal rules as the runtime but has its own bounded frame and typed protobuf parser.
It applies a 15-second deadline, a 64 KiB response limit, exact gRPC-web headers, and the five-byte empty request frame.
It never imports browser cookies and never refreshes credentials itself.

The oracle and widget run in the same refresh window.
The runner compares operation, schema, source version, identity/scope equality, period type, exact global used and remaining percentages, product ids and percentages, reset, field provenance, credits, and final display rounding.
A valid current period with an omitted proto3 scalar is exact-source zero usage, not `quota_unreported`.
Any `quota_unreported` widget result while the oracle has exact-source quota data fails the run.
No raw protobuf, token, header, scope, user id, team id, account-binding digest, or exact provider payload is printed or persisted as evidence.

The host-owned first-visible refresh must complete exactly once and visibly settle with a safe last-checked timestamp.
A test-owned server wrapper records only bounded `action-started`, `action-resolved`, or `action-rejected` lifecycle markers in the isolated database, so the runner proves the bridge reached the installed-equivalent action without logging inputs, outputs, credentials, or provider data.
The renderer's `waiting` state is intermediate: the runner waits for both the expected action settlement and a terminal widget state, and timeout errors report the last sanitized lifecycle stage.
The [Grok recipe](../extensions/recipes/grok-quota.html) owns the complete stable `data-grok-e2e` root contract and exact value semantics for every state.
The harness validates the complete root before selecting it.
For the already installed PR 48 shape only, it deterministically falls back to the documented prefixed descendant aliases and visible lifecycle copy under `[aria-label="menu widgets"]`.
A terminal partial root with no valid fallback fails immediately with a contract error instead of polling to an ambiguous timeout.
Run `pnpm vitest run tests/grok-quota-recipe.test.ts tests/grok-popover-e2e-runner.test.ts` to mechanically check the recipe, generated fixture, and PR 48 mixed-root regression before applying a generated or manually managed copy live.
In generated-install mode, the runner shortens only the copied fixture's visible interval, requires one interval acquisition to settle with a new safe timestamp, and leaves the production five-minute contract unchanged.
The runner then sends a coordinate mouse event to the visible refresh button, requires a disabled `checking` transition, requires another completed acquisition, and requires a new safe last-checked timestamp.
Startup, interval, and manual calls use the same bounded widget and server-action single-flight paths.

A screenshot named `baby-menu-grok-popover-e2e.png` is written to the system temporary directory by default.
Set `BABY_MENU_GROK_E2E_SCREENSHOT` to choose another output path.
The JSON summary contains only equality booleans, refresh completion flags, source mode, sanitized rendered and cache status, read-only-policy flags, and artifact paths.

The runner terminates its dev process, removes the temporary workspace and compiled E2E modules, and drops only its dedicated `grok_quota_e2e_cache` and `grok_quota_e2e_lifecycle` tables.
It does not package an app, modify the installed production bundle, modify the live installed widget, modify the live widget cache, or leave a macOS application bundle for LaunchServices to register.
