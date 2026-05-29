/**
 * Adapters speak ACP (newline-delimited JSON) on stdout, so ANY stray stdout
 * write corrupts the protocol. All diagnostic logging must go to stderr.
 */
export function logError(scope: string, ...args: unknown[]): void {
  process.stderr.write(`[${scope}] ${args.map(stringify).join(" ")}\n`);
}

export function logDebug(scope: string, ...args: unknown[]): void {
  if (!process.env.BABY_MENU_ADAPTER_DEBUG) return;
  process.stderr.write(`[${scope}] ${args.map(stringify).join(" ")}\n`);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
