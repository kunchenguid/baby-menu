import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { childEnv } from "./child-env.js";

/**
 * Spawns an agent CLI. When BABY_MENU_AGENT_RUNTIME=wsl, the child is launched
 * via `wsl -d <distro> -- bash -lc '…'` so Claude/Codex run inside WSL while the
 * adapter process stays on the Windows host. Stdio stays attached to the outer
 * wsl process for ACP streaming.
 *
 * Kept free of main-process imports: adapters are bundled as standalone Node
 * programs and only see this shared tree plus env set by the host launch.
 */
export function spawnAgentCli(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  },
): ChildProcessWithoutNullStreams {
  const env = childEnv(options.env);
  const runtime = env.BABY_MENU_AGENT_RUNTIME?.trim().toLowerCase();
  const distro = env.BABY_MENU_WSL_DISTRO?.trim() || "Ubuntu";

  let spawnCommand = command;
  let spawnArgs: string[] = [...args];
  let spawnCwd: string | undefined = options.cwd;

  if (runtime === "wsl") {
    const wrapped = wrapCliSpawnForWsl(command, args, distro, { cwd: options.cwd });
    spawnCommand = wrapped.command;
    spawnArgs = wrapped.args;
    // Do not pass a /mnt/... path as Node's cwd on Windows; bash applies cd inside WSL.
    spawnCwd = undefined;
  }

  const spawnOptions: SpawnOptionsWithoutStdio = {
    cwd: spawnCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env,
    windowsHide: true,
  };
  return spawn(spawnCommand, spawnArgs, spawnOptions) as ChildProcessWithoutNullStreams;
}

/** Mirrors main/agent-runtime-mode wrapCliSpawnForWsl (kept local for adapter bundle). */
function wrapCliSpawnForWsl(
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
    const wslCwd = looksLikeWindowsPath(raw) ? windowsPathToWslPath(raw) : raw.replace(/\\/g, "/");
    script = `cd ${bashSingleQuote(wslCwd)} && ${script}`;
  }

  return {
    command: "wsl",
    args: ["-d", distro, "--", "bash", "-lc", script],
  };
}

function looksLikeWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p.trim());
}

function windowsPathToWslPath(p: string): string {
  const trimmed = p.trim();
  const driveMatch = /^([a-zA-Z]):[\\/]?(.*)$/.exec(trimmed);
  if (driveMatch) {
    const drive = driveMatch[1]!.toLowerCase();
    const rest = (driveMatch[2] ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  }
  return trimmed.replace(/\\/g, "/");
}

function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
