<h1 align="center">baby-menu</h1>
<p align="center">
  <a href="https://github.com/kunchenguid/baby-menu/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/kunchenguid/baby-menu/ci.yml?style=flat-square&label=ci" /></a>
  <a href="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue?style=flat-square"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-blue?style=flat-square" /></a>
  <a href="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square"><img alt="Electron" src="https://img.shields.io/badge/electron-42-9feaf9?style=flat-square" /></a>
  <a href="https://x.com/kunchenguid"><img alt="X" src="https://img.shields.io/badge/X-@kunchenguid-black?style=flat-square" /></a>
  <a href="https://discord.gg/Wsy2NpnZDu"><img alt="Discord" src="https://img.shields.io/discord/1439901831038763092?style=flat-square&label=discord" /></a>
</p>

<h3 align="center">Adopt a baby menu and help it grow.</h3>

<p align="center">
  <img
    alt="Ask baby-menu to build a cpu and a claude usage widget and watch them appear in your menu bar"
    src="marketing-video/baby-menu-marketing-square.gif"
    width="960"
  />
</p>

Every menu-bar app ships a fixed set of widgets.
Want your CPU usage next to your Claude usage next to your next calendar event?
Good luck waiting for someone to build exactly that.

baby-menu flips it.
The popover menu can run your coding agent to edit the menu on the fly.
You ask for a feature in plain English, the agent writes an extension and it hot reloads into the menu in real time.

- **Personal self-evolving software** - jump into the future where every piece of software is personal and self-evolving towards your exact needs.
- **Ask, don't configure** - tweak the menu using natural language, not configuration.
- **Worry-free** - every agent turn can be kept or undone.

## Quick Start

Requires macOS 13 Ventura or newer, Homebrew, and a supported, already-authenticated agent CLI such as `claude` or `codex` on `PATH`.
On Linux, install a distribution package instead - see [Linux](#linux).

```sh
brew install --cask kunchenguid/tap/baby-menu
open -a "Baby Menu"
```

Click the tray icon, then ask for a widget in the composer such as:

```text
add a CPU usage widget that shows current load in %
```

Baby Menu writes changes under `~/.baby-menu/extensions`, mounts updated widgets or layouts live, and shows a Keep / Undo bar only when files actually changed.
The bar labels the real diff (`Added the cpu extension`, `Updated the layout`) so you can keep or throw away each turn.

Open the popover header to reload the layout, reach Settings (an overlay that preserves your menu state), quit, or install an update.
Reloading the layout remounts the widget canvas and root layout while preserving the agent conversation and Settings state.
Settings lets you toggle launch-at-login, pick the embedded agent, and manage custom ACP agents.

## Install Details

The packaged app stores extensions, the local database, caches, agent sessions, and preferences under `~/.baby-menu`, so upgrades preserve user-created widgets and extension state. Baby Menu refreshes its provider-neutral managed defaults from the release on each launch.
If `~/.baby-menu/extensions` is a symlink, Baby Menu seeds bundled defaults and compiles widget or layout CSS from the resolved writable target while leaving the symlink itself in place.

Update with Homebrew:

```sh
brew update
brew upgrade --cask baby-menu
```

When a newer release exists, Baby Menu shows an update indicator in the popover header.

For agent selection, custom ACP agents, telemetry, and environment flags, see [docs/configuration.md](docs/configuration.md).

## Linux

Requires a Wayland session. Verified on Hyprland with waybar; KDE Plasma and GNOME are supported by design.

### Install

Download the artifact for your distribution from the
[latest release](https://github.com/kunchenguid/baby-menu/releases/latest). x86_64 only.

```bash
# Arch
sudo pacman -U baby-menu-<version>-x64.pacman

# Debian, Ubuntu
sudo dpkg -i baby-menu-<version>-amd64.deb

# Fedora, RHEL
sudo rpm -U baby-menu-<version>-x86_64.rpm

# AppImage
chmod +x baby-menu-<version>-x86_64.AppImage
./baby-menu-<version>-x86_64.AppImage
```

The `.deb`, `.rpm`, and pacman packages run a postinstall step that configures the Chromium
sandbox for your system: it installs an AppArmor profile on Ubuntu 24.04 and later, and falls
back to a setuid `chrome-sandbox` helper only where the kernel has no unprivileged user
namespaces at all. The AppImage has no install step, so on Ubuntu 24.04+, where AppArmor
restricts unprivileged user namespaces by default, its sandbox can fail to start; pass
`--no-sandbox`:

```bash
./baby-menu-<version>-x86_64.AppImage --no-sandbox
```

`--no-sandbox` turns the Chromium sandbox off for that run rather than working around the
AppArmor restriction, so prefer the `.deb` on Ubuntu 24.04+ if you want to keep it. Allowing
unprivileged user namespaces system-wide (`sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`)
also lets the AppImage sandbox start normally.

On Arch and most other distros, unprivileged user namespaces are available by default and the
AppImage runs its sandbox normally with no extra flags.

Toggle the popover:

- Click the tray icon. On GNOME and KDE the AppIndicator host maps left click to the menu, so use `Open Baby Menu` there.
- `baby-menu --toggle`, bound to a key in your own compositor config.

There is no built-in global hotkey on purpose: Chromium cannot grab global keys under native Wayland, so a built-in binding would look broken instead of just missing.

Hyprland (`~/.config/hypr/hyprland.conf`):

```
bind = SUPER, B, exec, baby-menu --toggle
windowrulev2 = float, class:^(baby-menu)$
```

The windowrule matters: without it, Hyprland tiles the frameless popover.

KDE Plasma: System Settings, Shortcuts, Add Command, `baby-menu --toggle`.

GNOME: Settings, Keyboard, Custom Shortcuts, command `baby-menu --toggle`.
GNOME also shows no tray icon at all without the AppIndicator extension, so on a stock GNOME session the `--toggle` shortcut is the only entry point.

Launch at login is a Settings toggle in packaged Linux builds.
It writes or removes `~/.config/autostart/baby-menu.desktop`. Running from source the toggle stays off, because only a packaged production build may touch your session autostart.

## How It Works

```
   ┌─────────────────────┐
   │    tray popover     │   (React renderer, adaptive size)
   │ + Menu / Settings   │
   │ + Reload layout     │
   │ + Update / Quit     │
   └──────────┬──────────┘
              │  send()
              ▼
   ┌───────────────────────┐       ┌──────────────────────┐
   │  BabyMenuAgentRuntime ├──────►│    Change Session    │
   │   wraps acpx/runtime  │       │   git or snapshot    │
   └──────────┬────────────┘       │   by runtime mode    │
              │                    └──────────┬───────────┘
              │ edits files                   │ save / rollback
              ▼                               ▼
   ┌─────────────────────┐       ┌──────────────────────┐
   │ active extensions/  │       │   save snapshot or   │
   │  layout.tsx         │◄──────┤   rollback files     │
   │  <id>/widget.tsx    │       │   safely             │
   │  <id>/server.ts     │       │                      │
   └──────────┬──────────┘       │                      │
              │ hot-reload       └──────────────────────┘
              ▼
   ┌─────────────────────┐
   │     WidgetHost      │
   │ mounts layout/widget│
   └─────────────────────┘
```

- **Three processes, one bridge** - the renderer never touches git, the agent, or the filesystem; everything goes through `window.babyMenu`.
- **Recipes are specs, not prompts** - HTML files under `extensions/recipes/` describe a widget's capability and data sources; the agent reads the matching recipe before implementing.
  For live or system data, recipe guidance requires the agent to inspect the real source before parsing it and verify the finished widget against that same data before reporting done.
  The bundled quota recipes cover Claude Code, Codex, Cursor, GitHub Copilot, and Grok.
  Cursor, GitHub Copilot, and Grok quota recipes avoid separate quota helpers such as `quota-axi`; each recipe is authoritative for its provider-owned state, API, and credential-refresh contract.
- **Bundled ACP adapters** - built-in Claude Code and Codex run through clean-room adapters isolated from user-level agent configuration.
- **Diff-derived Keep / Undo** - the change bar reflects the actual git or snapshot diff, not agent wording, and clears itself when nothing changed on disk.
- **Extensions own their capabilities** - widgets, layouts, settings sections, server actions, background tasks, and a shared SQLite store, all behind the stable bridge.

For the full design notes and repository layout, see [docs/architecture.md](docs/architecture.md).

## Docs

- [docs/configuration.md](docs/configuration.md) - agent selection, custom ACP agents, telemetry, environment flags
- [docs/architecture.md](docs/architecture.md) - runtime design notes and repository layout
- [docs/development.md](docs/development.md) - building, testing, and packaging Baby Menu itself

## License

Baby Menu is released under the MIT License.
See [LICENSE](LICENSE) for details.
