# Configuration

How a running Baby Menu install stores state, picks an agent, and can be tuned.

## Where state lives

The packaged app keeps everything mutable under `~/.baby-menu`: extensions, the local SQLite database, caches, agent sessions, the custom agent catalog, and preferences.
Upgrades preserve this directory, so generated widgets and extension state survive.

On launch, packaged Baby Menu refreshes bundled defaults (`AGENTS.md`, `babymenu-env.d.ts`, recipes, starter extensions) from the app template while leaving your own extension directories untouched.
If `~/.baby-menu/extensions` is a symlink, Baby Menu resolves it for seeding and packaged widget/layout CSS compilation, which supports managed symlinks into writable dotfiles directories such as home-manager `mkOutOfStoreSymlink`.
Read-only or otherwise invalid targets are skipped with a log message instead of blocking startup.

## Choosing an agent

Baby Menu detects supported agents in order: Claude Code (`claude`), Codex (`codex`), then Grok Build (`grok`).
Claude and Codex run through bundled clean-room ACP adapters that drive the authenticated local CLI without inheriting user-level settings, skills, MCP servers, or extra rules.
Grok Build speaks ACP directly (`grok agent stdio`); availability still probes the `grok` CLI on PATH.

| Mechanism | Effect |
| --- | --- |
| Settings | Persist an agent choice across launches; add, edit, or remove custom agents. |
| `BABY_MENU_AGENT=<name>` | Override auto-detection before a preference is saved. |
| `agents.json` | Override or append catalog entries manually. |

If a send fails, the popover shows bounded, actionable guidance instead of raw provider diagnostics or a generic unavailable hint.
For built-in agents, authentication failures prompt you to run `codex login` or launch `claude` and complete sign-in before trying again.
If the failed turn edited files before stopping, Baby Menu keeps those partial changes available for Keep or Undo; a failed turn with no file changes closes cleanly.

### WSL mode (Windows)

On Windows, Settings can enable **Run agents via WSL**. When on:

- Agent CLI discovery (`claude`, `codex`, `grok`, …) probes inside the selected WSL distro (`wsl -d <distro> -- command -v …`).
- Pure ACP launch commands (Grok Build and custom agents) run inside that distro (launch argv is tokenized and quoted; not expanded by bash).
- Claude/Codex adapters still start as host Node processes; they spawn the nested CLI via WSL and pass `BABY_MENU_AGENT_RUNTIME=wsl` / `BABY_MENU_WSL_DISTRO=<distro>`.
- The extension workspace stays on the Windows host (`~/.baby-menu/extensions`). Node/acpx always use a Windows host path for spawn and ACP session cwd (so `path.resolve` never sees `/mnt/...`). Linux process cwd inside the distro comes from wrap-script `cd '/mnt/<drive>/…'` (pure-ACP launches and adapter CLI spawns) and from WSL inheriting the Windows spawn directory.
- **Credentials are distro-local.** Host Windows installs of `claude` / `codex` / `grok` and their auth stores are not used when WSL mode is on. Sign in inside the selected distro (for example `wsl -d Ubuntu -- claude` / `codex login` / `grok`) before expecting turns to succeed.
- **Host environment may be visible in WSL.** Windows-spawned `wsl` children can inherit host process env vars (API keys, tokens, `PATH`, etc.). Prefer distro-local credentials and avoid relying on host secrets for agent auth. Baby Menu does not fully filter the host env matrix for every WSL child.

Default distro is `Ubuntu` (letters, numbers, `.`, `-`, `_` only). An empty or whitespace-only distro preference **normalizes to `Ubuntu`**. WSL mode has no effect on macOS or Linux builds.

**Session reset on mode/distro change:** toggling WSL mode or changing the selected distro discards the active agent conversation / runtime session for that agent so the next turn starts cleanly against the new host-vs-WSL target. Settings confirms before applying when a conversation would be reset, and refuses mode/distro changes while an agent turn is running or Keep/Undo is pending.

### Codex model exception

The Codex adapter reads only the top-level `model` from `$CODEX_HOME/config.toml` or `~/.codex/config.toml` and passes it as `--model`, because it otherwise runs Codex with `--ignore-user-config`.

## Custom ACP agents

Add agents from Settings (id, optional label, ACP launch command) or by editing `agents.json` directly.
Packaged mode reads `~/.baby-menu/agents.json`; source mode reads `agents.json` at the repo root.
Settings-added agents are editable and removable; built-in Claude Code, Codex, and Grok Build stay read-only.

Each entry is an object with `name`, optional `label`, `command`, `installHint`, and `launchCommand`.
Custom entries with `launchCommand` register as [`acpx`](https://github.com/openclaw/acpx) overrides and show as available.
Built-ins always probe their CLI (`command`) for availability, including Grok Build.

```json
[
  {
    "name": "pi",
    "label": "Pi",
    "launchCommand": "npx pi-acp"
  }
]
```

`launchCommand` is any Agent Client Protocol (ACP) server command.
The underlying CLI must be installed and authenticated.
Examples:

| Agent | `launchCommand` |
| --- | --- |
| Pi | `npx pi-acp` |
| Cursor | `cursor-agent acp` |
| GitHub Copilot | `copilot --acp --stdio` |
| Qwen Code | `qwen --acp` |
| OpenCode | `npx -y opencode-ai acp` |

## Updates

Update with Homebrew:

```sh
brew update
brew upgrade --cask baby-menu
```

When a newer GitHub Release exists, Baby Menu shows an indicator in the popover header that opens a dialog with the same command and a link to the release notes.
If Baby Menu is running during a Cask upgrade, the cask quits the old app and relaunches the new one after replacement.
Fresh installs and upgrades while Baby Menu is closed do not launch the app automatically.

## Telemetry

Packaged release builds send anonymous, best-effort usage telemetry to a self-hosted Umami instance.

- **Records:** app startup, popover opens (`/popover` page views plus named events), agent turn outcomes, agent switches.
- **Never includes:** user/device id, prompts, file contents, generated code, extension data, or local paths.
- Network failures are ignored.

Set `BABY_MENU_TELEMETRY=0` in the launch environment to opt out.

## Environment flags

| Var                               | Effect                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BABY_MENU_KEEP_POPOVER_OPEN=1`   | Disables blur-to-hide so devtools / external windows stay up                                                                                                                                                      |
| `BABY_MENU_AGENT=<name>`          | Overrides agent auto-detection when no saved Settings choice exists                                                                                                                                               |
| `BABY_MENU_AGENT_TIMEOUT_MS=<ms>` | Overrides the embedded-agent request timeout                                                                                                                                                                      |
| `BABY_MENU_AGENT_RUNTIME=wsl`     | Host process env mirror of the Settings preference (and adapter env). Written at startup and whenever Settings changes mode; a launch-time value does **not** override a saved preference after the app starts. Adapters read this to spawn CLIs via `wsl`. |
| `BABY_MENU_WSL_DISTRO=<name>`     | WSL distro for agent probes and launches (default `Ubuntu`). Same prefs-as-source-of-truth rule as `BABY_MENU_AGENT_RUNTIME`.                                                                                      |
| `BABY_MENU_EXTENSIONS_DIR=<dir>`  | Overrides the active extension workspace in source/dev runs. Dev Tailwind scans only `extensions/` and `extensions-dev/`, so overrides outside those paths need matching `@source` coverage for widget utilities. |
| `CODEX_HOME=<dir>`                | When Codex is the selected built-in agent, points the adapter at `<dir>/config.toml` for the top-level `model`; other Codex user config is still ignored.                                                         |
| `BABY_MENU_TELEMETRY=0`           | Disables packaged-release telemetry; `false` and `off` are also accepted                                                                                                                                          |
| `BABY_MENU_UMAMI_HOST=<url>`      | Overrides the self-hosted Umami endpoint used by telemetry. Source/dev/test builds are no-op unless a website id is also configured.                                                                               |
| `BABY_MENU_UMAMI_WEBSITE_ID=<id>` | Overrides or supplies the Umami website id used by telemetry. The release workflow reads this from the GitHub Actions `vars.*` context, not a secret.                                                             |
