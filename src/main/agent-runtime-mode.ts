import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import type { BabyMenuAgentRuntimeMode } from "../shared/contracts";
import {
  DEFAULT_WSL_DISTRO,
  bashSingleQuote,
  looksLikeWindowsPath,
  normalizeWslDistroName,
  resolveWslExecutable,
  sanitizeStoredWslDistro,
  splitLaunchCommand,
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
  resolveWslExecutable,
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
    resolveWslExecutable(),
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

/** Quote a single argv token for acpx space-separated launch strings. */
function shellJoinToken(token: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(token)) return token;
  return `"${token.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function shellJoin(tokens: readonly string[]): string {
  return tokens.map(shellJoinToken).join(" ");
}

/**
 * Applies WSL wrapping to registry launch overrides.
 *
 * - Adapter agents (Claude/Codex): host Node adapter + nested CLI via WSL.
 * - Pure ACP (Grok, customs): host Electron-as-node + `wsl-acp-proxy.mjs`
 *   (session/new cwd rewrite). The spawn command **must** be an `.exe` (or other
 *   non-batch file): acpx sets `shell: true` for `.cmd`/`.bat`, and Windows
 *   `cmd.exe` then splits paths with spaces (e.g. `Baby Menu Dev.exe` → `Baby`)
 *   with exit 9009 / "no se reconoce como un comando".
 *
 * @param pureAcpProxyLaunch typically `[electronExe, proxy.mjs]`. Remaining args
 *   filled here: `--distro <distro> -- <agent tokens...>`. Host cwd goes via
 *   `BABY_MENU_WSL_PROXY_CWD` (see `applyAgentRuntimeModeEnv`), not argv.
 */
export function applyWslModeToOverrides(
  overrides: Record<string, string>,
  catalog: readonly AgentDefinition[],
  distro: string,
  options: { hostCwd?: string; pureAcpProxyLaunch?: readonly string[] } = {},
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
      continue;
    }

    const tokens = splitLaunchCommand(launchCommand);
    if (tokens.length === 0) {
      next[name] = launchCommand;
      continue;
    }

    if (options.pureAcpProxyLaunch && options.pureAcpProxyLaunch.length > 0) {
      // electron.exe proxy.mjs --distro Ubuntu -- grok agent stdio
      next[name] = shellJoin([
        ...options.pureAcpProxyLaunch,
        "--distro",
        distro,
        "--",
        ...tokens,
      ]);
    } else {
      // Unit-test fallback without a proxy path (not used by the production app).
      next[name] = wrapLaunchCommandForWsl(launchCommand, distro, { cwd: options.hostCwd });
    }
  }
  return next;
}

export type ApplyAgentRuntimeModeEnvOptions = {
  /** Host extensions cwd for pure-ACP proxy `cd` inside WSL. */
  hostCwd?: string;
};

/**
 * Host process env mirror of the preference (adapters + pure-ACP proxy children
 * inherit these via acpx spawn). Prefs are the source of truth when applying —
 * launch-time env is overwritten at startup and whenever Settings changes mode/distro.
 *
 * On win32 WSL mode also sets `ELECTRON_RUN_AS_NODE=1` so acpx can spawn
 * `process.execPath` + `wsl-acp-proxy.mjs` without a batch file (see
 * `applyWslModeToOverrides`). Cleared when leaving WSL mode so a later
 * `app.relaunch()` does not start the GUI under Electron-as-node.
 */
export function applyAgentRuntimeModeEnv(
  prefs: AgentRuntimeModePrefs | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  options: ApplyAgentRuntimeModeEnvOptions = {},
): void {
  if (platform === "win32" && prefs?.agentRuntimeMode === "wsl") {
    env.BABY_MENU_AGENT_RUNTIME = "wsl";
    env.BABY_MENU_WSL_DISTRO = sanitizeStoredWslDistro(prefs.wslDistro) || DEFAULT_WSL_DISTRO;
    env.ELECTRON_RUN_AS_NODE = "1";
    const hostCwd = options.hostCwd?.trim();
    if (hostCwd) env.BABY_MENU_WSL_PROXY_CWD = hostCwd;
    else delete env.BABY_MENU_WSL_PROXY_CWD;
    return;
  }
  env.BABY_MENU_AGENT_RUNTIME = "host";
  delete env.BABY_MENU_WSL_DISTRO;
  delete env.BABY_MENU_WSL_PROXY_CWD;
  if (platform === "win32") {
    delete env.ELECTRON_RUN_AS_NODE;
  }
}

function shellToken(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
