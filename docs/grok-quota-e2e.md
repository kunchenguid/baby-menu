# Grok quota popover E2E

Run the unattended macOS check with:

```sh
pnpm test:e2e:grok-popover
```

The command requires an installed official Grok CLI with a local session.
The captain-authorized check lets the official Grok client perform its normal credential refresh when needed.
It does not run `grok login`, change account configuration, print credential values, or retain raw provider output.

The command starts the current source app with a temporary extension workspace under `extensions-dev/`, keeps the real Electron popover open, and connects to its renderer over a loopback-only Chrome DevTools port.
`BABY_MENU_OPEN_POPOVER_ON_START=1` opens the same `BrowserWindow` through the tray controller's real bounds path, so no accessibility click or human interaction is required.
`BABY_MENU_REMOTE_DEBUGGING_PORT` enables the loopback inspection endpoint used only for this explicit run.
The normal `WidgetHost`, preload capability bridge, server-action registry, extension compiler, SQLite store, renderer, and host-owned refresh scheduling are all exercised.

The default generated-install mode uses the committed generated extension contract.
Set `BABY_MENU_GROK_E2E_INSTALLED_SOURCE=1` for installed-widget source mode.
That mode copies `~/.baby-menu/extensions/grok-quota` into the temporary workspace, rewrites its copied extension id and cache table to test-owned names, and leaves the installed source and live cache untouched.
Set `BABY_MENU_GROK_E2E_INSTALLED_SOURCE_DIR` only when the authoritative installed source is at another path.

Both modes wrap the copied server action with test-only lifecycle instrumentation.

Before Electron starts, the runner seeds its isolated cache table with the legacy fabricated `1%`, expired-reset, zero-credit shape.
The startup acquisition must either replace it with schema version `1` and exact official percentage/reset provenance or reject and remove it when Grok reports `quota_unreported`.
The runner reads back only sanitized schema/provenance status, never cached values or raw provider data.

The runner asks the installed official Grok ACP agent for `_x.ai/billing`, then compares the rendered extension state against that normalized result.
A reported official percentage must match the rendered remaining percentage, reset, credit balance, fresh state, and absence of warnings.
A known official period without a percentage must render `quota_unreported` without stale state, warning-backed last-good data, an old percentage, a reset, or a credit amount.

The host-owned first-visible refresh must complete exactly once and visibly settle with a safe last-checked timestamp.
A test-owned server wrapper records only bounded `action-started`, `action-resolved`, or `action-rejected` lifecycle markers in the isolated database, so the runner proves the bridge reached the installed-equivalent action without logging inputs, outputs, credentials, or provider data.
The renderer's `waiting` state is intermediate: the runner waits for both the expected action settlement and a terminal widget state, and timeout errors report the last sanitized lifecycle stage.
In generated-install mode, the runner shortens only the copied fixture's visible interval, requires one interval acquisition to settle with a new safe timestamp, and leaves the production five-minute contract unchanged.
The runner then sends a coordinate mouse event to the visible refresh button, requires a disabled `checking` transition, requires another completed acquisition, and requires a new safe last-checked timestamp.
Startup, interval, and manual calls use the same bounded widget and server-action single-flight paths.

A screenshot named `baby-menu-grok-popover-e2e.png` is written to the system temporary directory by default.
Set `BABY_MENU_GROK_E2E_SCREENSHOT` to choose another output path.
The JSON summary contains only normalized official semantics, refresh completion flags, source mode, and cache schema/provenance status.

The runner terminates its dev process, removes the temporary workspace and compiled E2E modules, and drops only its dedicated `grok_quota_e2e_cache` and `grok_quota_e2e_lifecycle` tables.
It does not package an app, modify the installed production bundle, modify the live installed widget, or leave a macOS application bundle for LaunchServices to register.
