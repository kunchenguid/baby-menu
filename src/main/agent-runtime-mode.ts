import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import type { AgentDefinition } from "./agent-catalog";

export type AgentRuntimeMode = "host" | "wsl";

export type AgentRuntimeModePrefs = {
  agentRuntimeMode?: AgentRuntimeMode;
  wslDistro?: string;
};

const DEFAULT_WSL_DISTRO = "Ubuntu";

/** WSL mode is only effective on win32. Non-Windows hosts always run agents on the host. */
export function isWslMode(
  prefs?: AgentRuntimeModePrefs | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false;
  const fromEnv = env.BABY_MENU_AGENT_RUNTIME?.trim().toLowerCase();
  if (fromEnv === "wsl") return true;
  if (fromEnv === "host") return false;
  return prefs?.agentRuntimeMode === "wsl";
}

export function resolveWslDistro(
  prefs?: AgentRuntimeModePrefs | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = env.BABY_MENU_WSL_DISTRO?.trim();
  if (fromEnv) return fromEnv;
  const fromPrefs = prefs?.wslDistro?.trim();
  if (fromPrefs) return fromPrefs;
  return DEFAULT_WSL_DISTRO;
}

/**
 * Translates a Windows absolute path to the WSL mount form.
 * `C:\Users\me\file` -> `/mnt/c/Users/me/file`
 * Already-Unix paths are returned with backslashes normalized.
 */
export function windowsPathToWslPath(p: string): string {
  const trimmed = p.trim();
  if (!trimmed) return trimmed;

  const driveMatch = /^([a-zA-Z]):[\\/]?(.*)$/.exec(trimmed);
  if (driveMatch) {
    const drive = driveMatch[1]!.toLowerCase();
    const rest = (driveMatch[2] ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  }

  // UNC or relative: best-effort slash normalize (callers should pass drive paths).
  return trimmed.replace(/\\/g, "/");
}

/** True when the path looks like a Windows drive path (C:\... or C:/...). */
export function looksLikeWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p.trim());
}

/**
 * Resolves the cwd passed to acpx / agent processes. Host change-session paths
 * stay on the Windows filesystem; only the agent process cwd is translated.
 */
export function resolveAgentProcessCwd(
  hostCwd: string,
  prefs?: AgentRuntimeModePrefs | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!isWslMode(prefs, env, platform)) return hostCwd;
  if (looksLikeWindowsPath(hostCwd) || /^[a-zA-Z]:$/.test(hostCwd.trim())) {
    return windowsPathToWslPath(hostCwd);
  }
  // Already a WSL/Unix path (e.g. tests) - pass through.
  return hostCwd.replace(/\\/g, "/");
}

type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
) => { status: number | null };

/**
 * Probes whether `command` resolves inside the WSL distro.
 * Uses `wsl -d <distro> -- bash -lc 'command -v …'` so Linux CI can mock spawnSync.
 */
export function wslCommandExists(
  command: string,
  distro: string,
  spawn: SpawnSyncFn = spawnSync as SpawnSyncFn,
): boolean {
  const name = command.trim();
  if (!name || /[\s;|&$`<>]/.test(name)) return false;

  const result = spawn(
    "wsl",
    ["-d", distro, "--", "bash", "-lc", `command -v ${bashSingleQuote(name)} >/dev/null 2>&1`],
    { stdio: "ignore", windowsHide: true },
  );
  return result.status === 0;
}

/**
 * Wraps an ACP launch command so it runs inside WSL while keeping stdio attached
 * to the wsl.exe process (acpx talks stdio to the outer process).
 */
export function wrapLaunchCommandForWsl(launchCommand: string, distro: string): string {
  const inner = launchCommand.trim();
  const pathExport = 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"';
  const script = `${pathExport}; exec ${inner}`;
  // Quote distro for the outer shell token list that acpx will split; distro is
  // a simple name (Ubuntu) so leave unquoted when safe.
  const distroToken = /\s/.test(distro) ? `"${distro.replace(/"/g, '\\"')}"` : distro;
  return `wsl -d ${distroToken} -- bash -lc ${bashSingleQuote(script)}`;
}

/**
 * Rewrites a CLI spawn (command + argv) so the child is launched via WSL.
 * Node's spawn cwd is not set to a /mnt path (that fails on the Windows host);
 * the working directory is applied inside bash when `cwd` is provided.
 */
export function wrapCliSpawnForWsl(
  command: string,
  args: readonly string[],
  distro: string,
  options: { cwd?: string } = {},
): { command: string; args: string[] } {
  const pathExport = 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"';
  const argv = [command, ...args].map((token) => bashSingleQuote(token)).join(" ");
  let script = `${pathExport}; exec ${argv}`;

  if (options.cwd?.trim()) {
    const raw = options.cwd.trim();
    const wslCwd = looksLikeWindowsPath(raw) || /^[a-zA-Z]:$/.test(raw) ? windowsPathToWslPath(raw) : raw.replace(/\\/g, "/");
    script = `cd ${bashSingleQuote(wslCwd)} && ${script}`;
  }

  return {
    command: "wsl",
    args: ["-d", distro, "--", "bash", "-lc", script],
  };
}

/**
 * Injects BABY_MENU_AGENT_RUNTIME / BABY_MENU_WSL_DISTRO into an adapter launch
 * command (host Node still runs the adapter; only the nested CLI goes via WSL).
 */
export function injectAgentRuntimeEnvIntoLaunch(
  launchCommand: string,
  env: Record<string, string>,
): string {
  const assignments = Object.entries(env)
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${shellToken(value)}`)
    .join(" ");
  if (!assignments) return launchCommand;

  const trimmed = launchCommand.trim();
  if (/^env\s+/.test(trimmed)) {
    return trimmed.replace(/^env\s+/, `env ${assignments} `);
  }
  return `env ${assignments} ${trimmed}`;
}

/**
 * Applies WSL wrapping to registry launch overrides.
 * Adapter agents keep a host launch and receive runtime env; pure ACP launches
 * (Grok, customs) are wrapped to run entirely inside WSL.
 */
export function applyWslModeToOverrides(
  overrides: Record<string, string>,
  catalog: readonly AgentDefinition[],
  distro: string,
): Record<string, string> {
  if (Object.keys(overrides).length === 0) return overrides;

  const byName = new Map(catalog.map((agent) => [agent.name, agent]));
  const next: Record<string, string> = {};
  for (const [name, launchCommand] of Object.entries(overrides)) {
    const agent = byName.get(name);
    if (agent?.adapter) {
      next[name] = injectAgentRuntimeEnvIntoLaunch(launchCommand, {
        BABY_MENU_AGENT_RUNTIME: "wsl",
        BABY_MENU_WSL_DISTRO: distro,
      });
    } else {
      next[name] = wrapLaunchCommandForWsl(launchCommand, distro);
    }
  }
  return next;
}

/**
 * Host process env mirror of the preference (adapters read these).
 * Prefs are the source of truth when applying - stale env values from a prior
 * mode must not win over an explicit host preference write.
 */
export function applyAgentRuntimeModeEnv(
  prefs: AgentRuntimeModePrefs | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32" && prefs?.agentRuntimeMode === "wsl") {
    env.BABY_MENU_AGENT_RUNTIME = "wsl";
    // Prefer the preference (or default); do not keep a stale env distro when prefs omit one.
    env.BABY_MENU_WSL_DISTRO = prefs.wslDistro?.trim() || DEFAULT_WSL_DISTRO;
    return;
  }
  env.BABY_MENU_AGENT_RUNTIME = "host";
  delete env.BABY_MENU_WSL_DISTRO;
}

/** Single-quote a string for bash -lc / argv embedding. */
export function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
