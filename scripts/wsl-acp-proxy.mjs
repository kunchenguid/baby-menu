#!/usr/bin/env node
/**
 * Host-side ACP stdio proxy for WSL-mode pure ACP agents (e.g. `grok agent stdio`).
 *
 * acpx on Windows always path.resolve()'s session cwd to a Windows path and sends
 * that to the agent via session/new. Linux agents (Grok in WSL) reject Windows
 * paths with JSON-RPC -32602 "Invalid params" / "Path is not absolute".
 *
 * This proxy:
 *  1. Spawns the real agent inside WSL (stdio bridged)
 *  2. Rewrites session/new and session/load `params.cwd` from Windows → /mnt/...
 *
 * Usage (argv after node script):
 *   node wsl-acp-proxy.mjs --distro Ubuntu -- [agent command tokens...]
 * Env:
 *   BABY_MENU_WSL_DISTRO (fallback distro)
 *   BABY_MENU_WSL_PROXY_CWD (optional host cwd hint for cd inside WSL)
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";

/** Prefer System32\wsl.exe so we never hit a random `wsl` on PATH (e.g. openwsman). */
function resolveWslExecutable() {
  if (process.platform === "win32") {
    const root = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    return join(root, "System32", "wsl.exe");
  }
  // Dev smoke from inside a Linux environment talking to Windows WSL:
  return "/mnt/c/Windows/System32/wsl.exe";
}

function windowsPathToWslPath(p) {
  const trimmed = String(p ?? "").trim();
  if (!trimmed) return trimmed;
  const driveMatch = /^([a-zA-Z]):[\\/]?(.*)$/.exec(trimmed);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = (driveMatch[2] ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    return rest ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
  }
  // Already POSIX / UNC left alone for rewrite pass
  if (trimmed.startsWith("/")) return trimmed.replace(/\\/g, "/");
  return trimmed.replace(/\\/g, "/");
}

function bashSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseArgs(argv) {
  let distro = process.env.BABY_MENU_WSL_DISTRO?.trim() || "Ubuntu";
  const agentTokens = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--distro" && argv[i + 1]) {
      distro = argv[i + 1];
      i += 2;
      continue;
    }
    if (a === "--") {
      agentTokens.push(...argv.slice(i + 1));
      break;
    }
    agentTokens.push(a);
    i += 1;
  }
  return { distro, agentTokens };
}

function rewriteCwdInJsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return line;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return line;
  }
  if (!msg || typeof msg !== "object") return line;
  const method = msg.method;
  if (method !== "session/new" && method !== "session/load" && method !== "session/loadSession") {
    return line;
  }
  const params = msg.params;
  if (!params || typeof params !== "object") return line;
  if (typeof params.cwd === "string" && params.cwd.length > 0) {
    const next = windowsPathToWslPath(params.cwd);
    if (next !== params.cwd) {
      msg = { ...msg, params: { ...params, cwd: next } };
      return JSON.stringify(msg);
    }
  }
  return line;
}

const { distro, agentTokens } = parseArgs(process.argv.slice(2));
if (agentTokens.length === 0) {
  console.error("wsl-acp-proxy: missing agent command after --");
  process.exit(2);
}
if (!/^[A-Za-z0-9._-]+$/.test(distro)) {
  console.error(`wsl-acp-proxy: invalid distro: ${distro}`);
  process.exit(2);
}

const pathExport = 'export PATH="$HOME/.local/bin:$HOME/.grok/bin:$PATH"';
const argv = agentTokens.map(bashSingleQuote).join(" ");
let script = `${pathExport}; exec ${argv}`;
const hintCwd = process.env.BABY_MENU_WSL_PROXY_CWD?.trim();
if (hintCwd) {
  script = `cd ${bashSingleQuote(windowsPathToWslPath(hintCwd))} && ${script}`;
}

// Strip Electron-as-node markers so WSL/grok never see them (same idea as adapters/child-env).
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.ELECTRON_NO_ATTACH_CONSOLE;
delete childEnv.ELECTRON_NO_ASAR;

const wslExe = resolveWslExecutable();
const child = spawn(wslExe, ["-d", distro, "--", "bash", "-lc", script], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
  env: childEnv,
});

child.on("error", (err) => {
  console.error(`wsl-acp-proxy: failed to spawn ${wslExe}: ${err.message}`);
  process.exit(1);
});

child.stderr.pipe(process.stderr);

// agent → client
child.stdout.pipe(process.stdout);

// client → agent (rewrite cwd)
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const out = rewriteCwdInJsonLine(line);
  if (child.stdin.writable) {
    child.stdin.write(out + "\n");
  }
});
rl.on("close", () => {
  child.stdin.end();
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
