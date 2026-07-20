import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type MergeShellPathOptions = {
  currentPath?: string;
  homeDir?: string;
  shellPath?: string;
  /** Override platform detection so win32 merge can be unit-tested on Linux. */
  platform?: NodeJS.Platform;
  /** Env used for win32 Path/PATH and common-dir expansion. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Override path delimiter (`;` on win32, `:` elsewhere). */
  pathDelimiter?: string;
  /**
   * Best-effort User/System PATH segments from the Windows registry.
   * When omitted on win32, mergeShellPath does not read the registry itself —
   * callers (expandProcessPathForGuiLaunch) pass readWindowsRegistryPathSegments().
   * Injectable for tests so no real registry is required.
   * REG_EXPAND_SZ tokens (`%USERPROFILE%`, etc.) are expanded against `env`.
   */
  registryPathSegments?: string[];
  /** Override the candidate common CLI directories list (before existence filter on win32). */
  commonDirs?: string[];
  /** Existence check for win32 common dirs. Defaults to existsSync. */
  pathExists?: (dir: string) => boolean;
};

export type ReadLoginShellPathOptions = {
  platform?: NodeJS.Platform;
  spawn?: typeof spawnSync;
};

export type ReadWindowsRegistryPathOptions = {
  platform?: NodeJS.Platform;
  spawn?: typeof spawnSync;
  timeoutMs?: number;
};

export type ExpandProcessPathOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathExists?: (dir: string) => boolean;
  readRegistryPathSegments?: () => string[];
  readShellPath?: () => string | undefined;
};

const UNIX_COMMON_GUI_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

function pathDelimiterFor(platform: NodeJS.Platform, override?: string): string {
  if (override !== undefined) return override;
  return platform === "win32" ? ";" : ":";
}

/**
 * Prefer non-empty `Path`, then non-empty `PATH`.
 * Empty string must not shadow a populated sibling (GUI hosts sometimes set Path="").
 */
function firstNonEmptyEnvPath(env: NodeJS.ProcessEnv): string | undefined {
  if (env.Path) return env.Path;
  if (env.PATH) return env.PATH;
  return undefined;
}

/**
 * Expand `%NAME%` tokens against env (case-insensitive key lookup).
 * Unknown tokens are left unchanged. Used for REG_EXPAND_SZ Path values from `reg query`.
 */
export function expandWindowsEnvVars(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/gi, (match, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key === undefined) return match;
    const resolved = env[key];
    if (resolved === undefined || resolved === "") return match;
    return resolved;
  });
}

function dedupePathSegments(
  segments: string[],
  delimiter: string,
  caseInsensitive = false,
): string {
  if (!caseInsensitive) {
    return [...new Set(segments.map((segment) => segment.trim()).filter(Boolean))].join(delimiter);
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment) continue;
    const key = segment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(segment);
  }
  return ordered.join(delimiter);
}

function splitPathValue(value: string | undefined, delimiter: string): string[] {
  if (!value) return [];
  return value.split(delimiter);
}

/** Candidate Windows CLI directories; only those that exist are merged. */
export function windowsCommonCliDirs(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  // Always use win32 join so unit tests on Linux produce authentic Windows paths.
  const { join } = path.win32;
  const localAppData = env.LOCALAPPDATA ?? join(homeDir, "AppData", "Local");
  const appData = env.APPDATA ?? join(homeDir, "AppData", "Roaming");
  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

  return [
    join(localAppData, "Microsoft", "WindowsApps"),
    join(appData, "npm"),
    join(homeDir, ".local", "bin"),
    join(programFiles, "nodejs"),
    join(programFiles, "Git", "cmd"),
    join(programFiles, "Git", "bin"),
    join(programFilesX86, "Git", "cmd"),
    join(programFilesX86, "Git", "bin"),
  ];
}

/**
 * Best-effort User + System PATH from the Windows registry via `reg query`.
 * Fail-soft: any spawn error, non-zero exit, timeout, or parse failure yields [].
 * No-op (returns []) when not on win32 unless platform is overridden to win32 for tests.
 * Values are returned as `reg query` prints them (may still contain `%VAR%`);
 * mergeShellPath expands those tokens against env.
 */
export function readWindowsRegistryPathSegments(
  options: ReadWindowsRegistryPathOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return [];

  const spawn = options.spawn ?? spawnSync;
  const timeout = options.timeoutMs ?? 1500;
  const keys = [
    "HKCU\\Environment",
    "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
  ];

  const segments: string[] = [];
  for (const key of keys) {
    try {
      const result: SpawnSyncReturns<string> = spawn("reg", ["query", key, "/v", "Path"], {
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      if (result.error || result.status !== 0 || !result.stdout) continue;
      const parsed = parseRegQueryPathValue(result.stdout);
      if (parsed) segments.push(parsed);
    } catch {
      // fail-soft
    }
  }
  return segments;
}

/** Extract the Path value from `reg query ... /v Path` stdout. */
export function parseRegQueryPathValue(stdout: string): string | undefined {
  // Typical line: "    Path    REG_EXPAND_SZ    C:\...;C:\..."
  // or REG_SZ. Match the last whitespace-separated token group after type.
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^Path\s+REG_(?:EXPAND_)?SZ\s+/i.test(l));
  if (!line) return undefined;
  const match = line.match(/^Path\s+REG_(?:EXPAND_)?SZ\s+(.+)$/i);
  const value = match?.[1]?.trim();
  return value || undefined;
}

export function mergeShellPath(options: MergeShellPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const delimiter = pathDelimiterFor(platform, options.pathDelimiter);
  const homeDir = options.homeDir ?? homedir();

  if (platform === "win32") {
    const env = options.env ?? process.env;
    // Treat empty Path as missing so a populated PATH is used (some hosts set Path="").
    const currentPath = options.currentPath ?? firstNonEmptyEnvPath(env) ?? "";
    const pathExists = options.pathExists ?? existsSync;
    const commonCandidates = options.commonDirs ?? windowsCommonCliDirs(env, homeDir);
    const presentCommon = commonCandidates.filter((dir) => pathExists(dir));
    const registrySegments = (options.registryPathSegments ?? []).map((value) =>
      expandWindowsEnvVars(value, env),
    );

    const segments = [
      ...splitPathValue(currentPath, delimiter),
      ...registrySegments.flatMap((value) => splitPathValue(value, delimiter)),
      ...presentCommon,
      ...splitPathValue(options.shellPath, delimiter),
    ];
    return dedupePathSegments(segments, delimiter, true);
  }

  const segments = [
    ...splitPathValue(options.currentPath ?? "", delimiter),
    ...UNIX_COMMON_GUI_PATHS,
    path.posix.join(homeDir, ".local", "bin"),
    ...splitPathValue(options.shellPath ?? "", delimiter),
  ];
  return dedupePathSegments(segments, delimiter, false);
}

export function readLoginShellPath(options: ReadLoginShellPathOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return undefined;

  const spawn = options.spawn ?? spawnSync;
  const result = spawn("/bin/zsh", ["-lc", "print -r -- $PATH"], {
    encoding: "utf8",
    timeout: 2000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  return result.stdout?.trim() || undefined;
}

/**
 * Expand process PATH for GUI launches so agent CLIs are discoverable.
 * - win32: merge Path/PATH + best-effort registry User/System PATH + common CLI dirs that exist.
 *   Never spawns zsh. Sets both PATH and Path.
 * - darwin/linux: merge current PATH + common GUI bins + login-shell PATH (zsh).
 */
export function expandProcessPathForGuiLaunch(options: ExpandProcessPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "win32") {
    // Treat empty Path as missing so a populated PATH is used (some hosts set Path="").
    const currentPath = firstNonEmptyEnvPath(env) ?? "";
    const registryPathSegments =
      options.readRegistryPathSegments?.() ??
      readWindowsRegistryPathSegments({ platform: "win32" });
    const merged = mergeShellPath({
      platform: "win32",
      currentPath,
      homeDir: options.homeDir,
      env,
      registryPathSegments,
      pathExists: options.pathExists,
    });
    env.PATH = merged;
    env.Path = merged;
    return merged;
  }

  const shellPath = options.readShellPath?.() ?? readLoginShellPath({ platform });
  const merged = mergeShellPath({
    platform,
    currentPath: env.PATH,
    homeDir: options.homeDir,
    shellPath,
  });
  env.PATH = merged;
  return merged;
}
