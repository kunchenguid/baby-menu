import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves codex's config/auth home, matching the CLI: $CODEX_HOME if set,
 * otherwise ~/.codex. Auth already resolves via CODEX_HOME (see driver.ts), and
 * the model lives next to it in config.toml.
 */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME ?? join(homedir(), ".codex");
}

/**
 * Extracts the top-level `model` from a codex config.toml.
 *
 * Only the top-level key counts: in TOML, top-level keys appear before the first
 * table header, so we stop at the first `[...]`. A `model` under `[profiles.*]`
 * (or any other table) is a different setting and must not be mistaken for the
 * active default. Handles single- and double-quoted strings and skips comments.
 */
export function parseCodexModel(toml: string): string | null {
  for (const line of toml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) break; // entered a table; top-level keys are above it
    const match = trimmed.match(/^model\s*=\s*["']([^"']+)["']/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Reads the configured codex model from <home>/config.toml, or null if the file
 * is missing or has no top-level model. The adapter runs codex with
 * `--ignore-user-config` to stay lean, which also discards this model line, so
 * the driver re-injects it explicitly as `--model`.
 */
export function readCodexModel(home: string = codexHome()): string | null {
  let raw: string;
  try {
    raw = readFileSync(join(home, "config.toml"), "utf8");
  } catch {
    return null;
  }
  return parseCodexModel(raw);
}
