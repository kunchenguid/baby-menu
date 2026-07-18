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

Dev packaging uses product name **Baby Menu Dev** (`com.kunchenguid.baby-menu.dev`) via `electron-builder.dev.yml`.

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

### 6. Settings open-at-login (packaged / installed only)

- [ ] Open **Settings** from the popover.
- [ ] Toggle **open at login** (or equivalent open-at-login control).
- [ ] Confirm it sticks after quit/relaunch when using a **packaged** install. Source/`pnpm dev` mode is a no-op for login items; skip this step for pure portable smoke if the UI disables it when not packaged.

### 7. Optional: agent CLI on PATH detected

- [ ] If `claude`, `codex`, or another catalog agent is installed and on the user PATH, open Settings and confirm the agent shows as available (or a turn can start).
- [ ] If no agent CLI is installed, skip - CI images often lack them; PATH merge is still covered by unit tests.

### 8. PR via **no-mistakes** (not the overnight loop)

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
| Login item | Works when packaged (or N/A for portable/dev) |
| Agent PATH | Optional; only if a CLI is present |
| PR process | Human + no-mistakes; loop never merges `main` |

## Related

- Packaging and dual-platform notes: [development.md](./development.md)
- Commands and architecture: [AGENTS.md](../AGENTS.md)
- Human PR gate: [CONTRIBUTING.md](../CONTRIBUTING.md)
