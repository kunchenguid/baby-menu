import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { DEFAULT_WSL_DISTRO, wrapCliSpawnForWsl } from "../../shared/wsl-agent.js";
import { childEnv } from "./child-env.js";

/**
 * Spawns an agent CLI. When BABY_MENU_AGENT_RUNTIME=wsl, the child is launched
 * via `wsl -d <distro> -- bash -lc '…'` so Claude/Codex run inside WSL while the
 * adapter process stays on the Windows host. Stdio stays attached to the outer
 * wsl process for ACP streaming.
 *
 * Kept free of main-process imports: adapters are bundled as standalone Node
 * programs and only see shared pure helpers plus env set by the host launch.
 */
export function spawnAgentCli(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    /** Injectable for tests. Defaults to node:child_process.spawn. */
    spawnImpl?: typeof spawn;
  },
): ChildProcessWithoutNullStreams {
  const env = childEnv(options.env);
  const runtime = env.BABY_MENU_AGENT_RUNTIME?.trim().toLowerCase();
  const distro = env.BABY_MENU_WSL_DISTRO?.trim() || DEFAULT_WSL_DISTRO;
  const spawnFn = options.spawnImpl ?? spawn;

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
  return spawnFn(spawnCommand, spawnArgs, spawnOptions) as ChildProcessWithoutNullStreams;
}
