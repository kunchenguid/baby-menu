# Windows human smoke checklist

Post-loop verification on a **real Windows desktop**. This is the human oracle for tray UX (grill **G11**): Linux gates and `windows-latest` CI prove typecheck/test/build/`package:win`, not notification-area click geometry.

## Not completed by automation

The overnight implement loop, Vitest suite, and CI **do not** complete this checklist.

- There is **no** unattended Playwright / accessibility tray click in the loop.
- Green `pnpm typecheck` / `pnpm test` on Linux or green GitHub Actions is **not** “Windows tray verified.”
- Treat this file as a **human-only** post-loop step before opening a PR.

## Prerequisites

Pick one artifact source (both are **unsigned** x64):

| Source | What you get |
| --- | --- |
| Local Windows build | `pnpm package:win` → `release/Baby-Menu-<version>-win-x64.exe` (NSIS) and `release/Baby-Menu-<version>-win-x64-portable.exe` |
| CI | Download the `windows-package` (or equivalent) artifact from the `windows` job on `windows-latest` |

Local and CI `package:win` both produce the **Baby Menu Dev** identity today (`com.kunchenguid.baby-menu.dev` via `electron-builder.dev.yml`).

There is **no** winget, Microsoft Store, or signed Windows release channel for this smoke. Manual download or local package only.

## Checklist

Run on a real Windows desktop (not WSL GUI-less, not Linux). Check each box in order.

### 1. Install portable **or** NSIS

- [ ] **Portable:** run `Baby-Menu-<version>-win-x64-portable.exe` (no install required), **or**
- [ ] **NSIS:** run `Baby-Menu-<version>-win-x64.exe`, complete the installer, launch the app.

### 2. SmartScreen expected (unsigned)

- [ ] If Windows SmartScreen / “Windows protected your PC” appears, choose **More info** → **Run anyway** (or equivalent).
- [ ] Do **not** treat this as a product failure. Builds are intentionally unsigned overnight (**G22**); signing is out of scope.

### 3. Tray icon visible

- [ ] A Baby Menu (Dev) icon appears in the notification area (system tray).
- [ ] If missing, check the overflow chevron (^); confirm it is not blank/white (Windows must use non-template `baby_menu.png`, not mac Template assets).

### 4. Click opens popover

- [ ] Left-click the tray icon.
- [ ] Frameless popover opens near the tray, stays above other windows, and does **not** show a taskbar button (`skipTaskbar`).

### 5. Blur hide works

- [ ] Click outside the popover (or focus another app).
- [ ] Popover hides without quitting the tray process.
- [ ] Optional debug: `BABY_MENU_KEEP_POPOVER_OPEN=1` keeps the popover open for inspection (dev only).

### 6. Settings open-at-login (packaged runs only)

Applies to any packaged artifact (NSIS **or** portable): both run with `app.isPackaged === true`, so login items are allowed. Skip only for source/`pnpm dev`.

- [ ] Open **Settings** from the popover.
- [ ] Toggle **launch at system start** (open-at-login).
- [ ] Confirm it sticks after quit/relaunch. In source/`pnpm dev`, preferences force `openAtLogin` off and do not apply login items - the Settings switch may still appear, but the OS login item is not updated.

### 7. Optional: agent CLI on PATH detected

- [ ] If `claude`, `codex`, or another catalog agent is installed and on the user PATH, open Settings and confirm the agent shows as available (or a turn can start).
- [ ] If no agent CLI is installed, skip - CI images often lack them; PATH merge is still covered by unit tests.

### 8. Optional: WSL agent mode (skip if WSL is not installed)

Skip this entire section when WSL is not available on the machine. Details: [configuration.md](./configuration.md#wsl-mode-windows).

- [ ] Open **Settings** and enable **Run agents via WSL**.
- [ ] Confirm the distro field shows a sensible default (empty normalizes to **Ubuntu**) or pick an installed distro you use for agents.
- [ ] Confirm a catalog agent (e.g. `claude`, `codex`, or `grok`) probes as available **inside** that distro (`command -v` via WSL), not only on the Windows host PATH.
- [ ] Start one short turn (e.g. ask for a trivial widget tweak) and confirm the agent responds without host-only auth errors.
- [ ] Remember credentials are **distro-local**: sign in inside the selected distro (`wsl -d <distro> -- claude` / `codex login` / `grok`) if the agent is missing or unauthenticated there. Host Windows installs are not used when WSL mode is on.

### 9. PR via **no-mistakes** (not the overnight loop)

- [ ] Do **not** merge to upstream `main` from the implement loop or from ad-hoc automation.
- [ ] Open the human PR through **[`no-mistakes`](../CONTRIBUTING.md)** per `CONTRIBUTING.md` (signature required on PRs targeting `main`).
- [ ] Point reviewers at this checklist if Windows tray UX is in scope for the PR.

## Pass criteria

| Area | Pass |
| --- | --- |
| Install / launch | Portable **or** NSIS starts the tray app |
| SmartScreen | Warning acceptable; app still runs after bypass |
| Tray | Icon visible and clickable |
| Popover | Opens on click; blur hides it |
| Login item | Works when packaged (NSIS or portable); N/A for source/dev only |
| Agent PATH | Optional; only if a CLI is present |
| WSL mode | Optional; enable → distro → probe → one turn; credentials distro-local |
| PR process | Human + no-mistakes; loop never merges `main` |

## Related

- Packaging and dual-platform notes: [development.md](./development.md)
- Commands and architecture: [AGENTS.md](../AGENTS.md)
- Human PR gate: [CONTRIBUTING.md](../CONTRIBUTING.md)
