/**
 * Pure WSL path / spawn helpers shared by main (catalog + launch wraps) and the
 * bundled adapters (CLI child spawn). Keep this free of Electron/main imports
 * so adapter esbuild can bundle it.
 */

export const DEFAULT_WSL_DISTRO = "Ubuntu";

/** WSL distro names: letters, digits, dot, dash, underscore only. */
export const WSL_DISTRO_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Translates a Windows absolute path to the WSL mount form.
 * `C:\Users\me\file` -> `/mnt/c/Users/me/file`
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

  return trimmed.replace(/\\/g, "/");
}

/** True when the path looks like a Windows drive path (C:\... or C:/...). */
export function looksLikeWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p.trim()) || /^[a-zA-Z]:$/.test(p.trim());
}

/** Single-quote a string for bash -lc / argv embedding. */
export function bashSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Tokenize a launch command the way acpx-style space-separated argv expects:
 * bare tokens and double-quoted spans (with backslash escapes inside quotes).
 */
export function splitLaunchCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let escaped = false;

  for (const ch of command.trim()) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inDouble && /\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Normalize a host cwd for use inside WSL (translate Windows drive paths). */
export function toWslCwd(cwd: string): string {
  const raw = cwd.trim();
  if (!raw) return raw;
  if (looksLikeWindowsPath(raw)) return windowsPathToWslPath(raw);
  return raw.replace(/\\/g, "/");
}

/**
 * Rewrites a CLI spawn (command + argv) so the child is launched via WSL.
 * Node's spawn cwd is not set to a /mnt path; bash applies cd when cwd is set.
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
    script = `cd ${bashSingleQuote(toWslCwd(options.cwd))} && ${script}`;
  }

  return {
    command: "wsl",
    args: ["-d", distro, "--", "bash", "-lc", script],
  };
}

/**
 * Escape a string for inclusion inside double quotes for acpx's splitCommandLine
 * (same rules as POSIX-ish: backslash and double-quote).
 * acpx does NOT understand bash `'\''` nesting — outer single-quoted -lc payloads
 * break when the script itself contains single quotes (e.g. bashSingleQuote tokens).
 */
function acpxDoubleQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Wraps an ACP launch command for WSL. Tokenizes the launch string and
 * bash-quotes each token so metacharacters stay literal (host mode parity).
 * Optional hostCwd becomes an explicit `cd` inside the distro.
 *
 * The returned string is a single space-separated command line that **acpx
 * splitCommandLine** can parse into argv. The bash script is always the last
 * argument, double-quoted for acpx (not bash `'\''` nested single quotes).
 */
export function wrapLaunchCommandForWsl(
  launchCommand: string,
  distro: string,
  options: { cwd?: string } = {},
): string {
  const tokens = splitLaunchCommand(launchCommand);
  if (tokens.length === 0) {
    throw new Error("Launch command is empty.");
  }
  // PATH uses double quotes inside the bash script so $HOME expands in WSL.
  const pathExport = 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"';
  const argv = tokens.map((token) => bashSingleQuote(token)).join(" ");
  let script = `${pathExport}; exec ${argv}`;
  if (options.cwd?.trim()) {
    script = `cd ${bashSingleQuote(toWslCwd(options.cwd))} && ${script}`;
  }
  // Distro is allowlisted before call; quote for acpx outer split safety.
  const distroToken = acpxDoubleQuote(distro);
  return `wsl -d ${distroToken} -- bash -lc ${acpxDoubleQuote(script)}`;
}

/** Validate/normalize a WSL distro name. Throws on illegal characters. */
export function normalizeWslDistroName(value: string, fallback = DEFAULT_WSL_DISTRO): string {
  const trimmed = value.trim() || fallback;
  if (!WSL_DISTRO_PATTERN.test(trimmed)) {
    throw new Error("WSL distro name may only contain letters, numbers, dot, dash, or underscore.");
  }
  return trimmed;
}

/** Soft normalize for prefs load: invalid values become undefined. */
export function sanitizeStoredWslDistro(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || !WSL_DISTRO_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}
