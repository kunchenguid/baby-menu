/**
 * Builds the environment for a spawned CLI child.
 *
 * baby-menu launches the adapters with the bundled Electron run as Node
 * (`ELECTRON_RUN_AS_NODE=1`). That variable must NOT leak into the agent CLI we
 * spawn: codex inherits it and exits non-zero (its helper subprocesses
 * misinterpret it), and other Electron internals can similarly confuse child
 * tools. Strip the Electron-as-node markers so the CLI sees a normal env.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_NO_ASAR;
  return env;
}
