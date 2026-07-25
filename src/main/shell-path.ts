import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { homedir } from "node:os";

type MergeShellPathOptions = {
  currentPath?: string;
  homeDir?: string;
  shellPath?: string;
};

type SpawnSyncLike = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; timeout: number; stdio: ["ignore", "pipe", "ignore"] },
) => { status: number | null; stdout: string | null; error?: Error };

type ReadLoginShellPathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnSyncLike;
  timeoutMs?: number;
};

const COMMON_GUI_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

const DEFAULT_SHELL = "/bin/zsh";
/**
 * Shells whose `-i -l -c` behavior and `$PATH` scalar semantics we rely on.
 * Deliberately excludes fish, where `$PATH` is a list and expands
 * space-separated.
 */
const SUPPORTED_PROBE_SHELLS = new Set(["zsh", "bash", "sh", "ksh", "ksh93", "dash"]);
/**
 * Interactive rc files routinely print to stdout (prompt tools, version manager
 * banners), so the value is delimited instead of assuming stdout is only PATH.
 */
const PROBE_MARKER = "__BABY_MENU_PATH_PROBE__";
// `${PATH}` must be braced: bare `$PATH` followed by the marker would parse as
// one (unset) variable name and silently yield an empty value.
const PROBE_COMMAND = `printf '%s\\n' "${PROBE_MARKER}\${PATH}${PROBE_MARKER}"`;
/**
 * An interactive shell that initializes several version managers can take
 * seconds on a cold start; a timeout here silently costs us the real PATH.
 */
const PROBE_TIMEOUT_MS = 10_000;

export function mergeShellPath(options: MergeShellPathOptions = {}): string {
  const homeDir = options.homeDir ?? homedir();
  const segments = [
    ...(options.currentPath ?? "").split(":"),
    ...COMMON_GUI_PATHS,
    `${homeDir}/.local/bin`,
    ...(options.shellPath ?? "").split(":"),
  ];

  return [...new Set(segments.map((segment) => segment.trim()).filter(Boolean))].join(":");
}

export function resolveProbeShell(shell: string | undefined): string {
  const candidate = (shell ?? "").trim();
  if (!candidate.startsWith("/")) return DEFAULT_SHELL;
  return SUPPORTED_PROBE_SHELLS.has(basename(candidate)) ? candidate : DEFAULT_SHELL;
}

function extractProbePath(stdout: string | null): string | undefined {
  const start = stdout?.indexOf(PROBE_MARKER) ?? -1;
  if (start < 0) return undefined;
  const valueStart = start + PROBE_MARKER.length;
  const end = stdout!.indexOf(PROBE_MARKER, valueStart);
  if (end < 0) return undefined;
  const value = stdout!.slice(valueStart, end).trim();
  // Anything that is not recognizably a PATH must be rejected, not merged.
  if (!value.split(":").some((segment) => segment.trim().startsWith("/"))) return undefined;
  return value;
}

/**
 * Reads the PATH of an *interactive* login shell. A non-interactive login shell
 * never sources `~/.zshrc` (or `~/.bashrc`), which is where version managers
 * such as asdf, nvm, mise, rbenv, volta, and fnm install their shims - so the
 * non-interactive probe returns a PATH without them and GUI launches cannot
 * find the agent CLIs. Never throws and never blocks startup: any failure
 * returns `undefined` and the caller merges what it already has.
 */
export function readLoginShellPath(options: ReadLoginShellPathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return undefined;
  const env = options.env ?? process.env;
  const spawn = options.spawn ?? (spawnSync as unknown as SpawnSyncLike);
  const shell = resolveProbeShell(env.SHELL);

  let result: { status: number | null; stdout: string | null; error?: Error };
  try {
    result = spawn(shell, ["-i", "-l", "-c", PROBE_COMMAND], {
      encoding: "utf8",
      timeout: options.timeoutMs ?? PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
  // A timeout leaves `status` null (and sets `error`), which this rejects too.
  if (result.error || result.status !== 0) return undefined;
  return extractProbePath(result.stdout);
}

export function expandProcessPathForGuiLaunch(): string {
  process.env.PATH = mergeShellPath({ currentPath: process.env.PATH, shellPath: readLoginShellPath() });
  return process.env.PATH;
}
