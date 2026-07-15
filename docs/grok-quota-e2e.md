# Grok quota popover E2E

Run the unattended macOS check with:

```sh
pnpm test:e2e:grok-popover
```

The command requires an installed official Grok CLI with a local session that remains valid for at least 30 minutes.
It aborts before launching Grok when the session is close enough to expiry that the official client could refresh it.
It records only auth file size, mode, and modification time and fails if any of that metadata changes.
It never prints auth values, account identifiers, the raw billing response, or command output.

The command starts the current source app with a temporary extension workspace, keeps the real Electron popover open, and connects to its renderer over a loopback-only Chrome DevTools port.
`BABY_MENU_OPEN_POPOVER_ON_START=1` opens the same `BrowserWindow` through the tray controller's real bounds path, so no accessibility click or human interaction is required.
`BABY_MENU_REMOTE_DEBUGGING_PORT` enables the loopback inspection endpoint used only for this explicit run.
The normal `WidgetHost`, preload capability bridge, server-action registry, extension compiler, SQLite store, and renderer are all exercised.

The fixture asks the installed official Grok ACP agent for `_x.ai/billing`, then compares the rendered extension state against that sanitized result.
A reported official percentage must match the rendered remaining percentage and reset hour.
A known official period without a percentage must render `quota_unreported` and must not show a fabricated percentage, a monetary monthly limit, or a reset.

The host-owned first-visible refresh must complete exactly once and render `checked 1`.
The runner then sends a coordinate mouse event to the visible refresh button, requires a disabled `checking` transition, and requires `checked 2` after completion.
A screenshot named `baby-menu-grok-popover-e2e.png` is written to the system temporary directory by default.
Set `BABY_MENU_GROK_E2E_SCREENSHOT` to choose another output path.

The runner terminates its dev process, removes the temporary workspace and compiled E2E modules, and drops only its dedicated `grok_quota_e2e_cache` table.
It does not package an app, modify the installed production bundle, or leave a macOS application bundle for LaunchServices to register.
