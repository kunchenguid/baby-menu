import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import type { BabyMenuAgentRuntimeMode } from "../shared/contracts";
import {
  DEFAULT_WSL_DISTRO,
  bashSingleQuote,
  looksLikeWindowsPath,
  normalizeWslDistroName,
  sanitizeStoredWslDistro,
  toWslCwd,
  windowsPathToWslPath,
  wrapCliSpawnForWsl,
  wrapLaunchCommandForWsl,
} from "../shared/wsl-agent";
import type { AgentDefinition } from "./agent-catalog";

export type AgentRuntimeMode = BabyMenuAgentRuntimeMode;

export type AgentRuntimeModePrefs = {
  agentRuntimeMode?: AgentRuntimeMode;
  wslDistro?: string;
};

export {
  DEFAULT_WSL_DISTRO,
  bashSingleQuote,
  looksLikeWindowsPath,
  normalizeWslDistroName,
  sanitizeStoredWslDistro,
  toWslCwd,
  windowsPathToWslPath,
  wrapCliSpawnForWsl,
  wrapLaunchCommandForWsl,
};

const WSL_PROBE_TIMEOUT_MS = 5_000;

/** WSL mode is only effective on win32. Non-Windows hosts always run agents on the host. */
export function isWslMode(
  prefs?: AgentRuntimeModePrefs | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") return false;
  // After startup, applyAgentRuntimeModeEnv mirrors prefs into env. Prefer env when
  // set so mid-process updates and adapter children agree; fall back to prefs.
  const fromEnv = env.BABY_MENU_AGENT_RUNTIME?.trim().toLowerCase();
  if (fromEnv === "wsl") return true;
  if (fromEnv === "host") return false;
  return prefs?.agentRuntimeMode === "wsl";
}

export function resolveWslDistro(
  prefs?: AgentRuntimeModePrefs | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // Env is written from prefs on apply; prefer env when present so adapters match host.
  const fromEnv = env.BABY_MENU_WSL_DISTRO?.trim();
  if (fromEnv && /^[A-Za-z0-9._-]+$/.test(fromEnv)) return fromEnv;
  const fromPrefs = sanitizeStoredWslDistro(prefs?.wslDistro);
  if (fromPrefs) return fromPrefs;
  return DEFAULT_WSL_DISTRO;
}

/**
 * Translates a host workspace path to the form used *inside* WSL wrap scripts
 * (`cd '/mnt/...'`). Not for acpx/session cwd: on win32 those must stay host
 * Windows paths so `path.resolve` does not produce `\mnt\c\...` garbage.
 */
export function resolveAgentProcessCwd(
  hostCwd: string,
  prefs?: AgentRuntimeModePrefs | null,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (!isWslMode(prefs, env, platform)) return hostCwd;
  return toWslCwd(hostCwd);
}

type SpawnSyncFn = (
  command: string,
  args: readonly string[],
  options?: SpawnSyncOptions,
) => { status: number | null; error?: Error | null; signal?: NodeJS.Signals | null };

/**
 * Probes whether `command` resolves inside the WSL distro.
 * Uses injectable spawnSync so Linux CI never needs a real distro. Bounded timeout
 * so a stuck WSL does not block Settings/main forever.
 */
export function wslCommandExists(
  command: string,
  distro: string,
  spawn: SpawnSyncFn = spawnSync as SpawnSyncFn,
): boolean {
  const name = command.trim();
  if (!name || /[\s;|&$`<>]/.test(name)) return false;
  // Distro must already be allowlisted by callers; refuse odd values as a belt.
  if (!/^[A-Za-z0-9._-]+$/.test(distro)) return false;

  const result = spawn(
    "wsl",
    ["-d", distro, "--", "bash", "-lc", `command -v ${bashSingleQuote(name)} >/dev/null 2>&1`],
    { stdio: "ignore", windowsHide: true, timeout: WSL_PROBE_TIMEOUT_MS },
  );
  if (result.error || result.signal) return false;
  return result.status === 0;
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
 *
 * @param hostCwd optional Windows extensions path embedded as `cd` for pure-ACP wraps
 * so session tools that ignore process cwd still land in the workspace.
 */
export function applyWslModeToOverrides(
  overrides: Record<string, string>,
  catalog: readonly AgentDefinition[],
  distro: string,
  options: { hostCwd?: string } = {},
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
      next[name] = wrapLaunchCommandForWsl(launchCommand, distro, { cwd: options.hostCwd });
    }
  }
  return next;
}

/**
 * Host process env mirror of the preference (adapters read these).
 * Prefs are the source of truth when applying - launch-time env is overwritten
 * at startup and whenever Settings changes mode/distro.
 */
export function applyAgentRuntimeModeEnv(
  prefs: AgentRuntimeModePrefs | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32" && prefs?.agentRuntimeMode === "wsl") {
    env.BABY_MENU_AGENT_RUNTIME = "wsl";
    env.BABY_MENU_WSL_DISTRO = sanitizeStoredWslDistro(prefs.wslDistro) || DEFAULT_WSL_DISTRO;
    return;
  }
  env.BABY_MENU_AGENT_RUNTIME = "host";
  delete env.BABY_MENU_WSL_DISTRO;
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
