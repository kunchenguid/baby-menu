import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * End-to-end proof that the bundled clean-room adapters drive the REAL claude /
 * codex CLIs over ACP, exactly as acpx does (raw JSON-RPC 2.0 over NDJSON on the
 * child's stdio). Gated: only runs when the wrapped CLI exists AND
 * RUN_REAL_AGENT_E2E=1 is set, because it spawns the real agent (network +
 * tokens). Build the adapters first (`pnpm build` or `node scripts/build-adapters.mjs`).
 */
const ADAPTERS = join(__dirname, "..", "out", "adapters");
const RUN = process.env.RUN_REAL_AGENT_E2E === "1";

function cliExists(command: string): boolean {
  return spawnSync("sh", ["-c", `command -v "$1"`, "sh", command], { stdio: "ignore" }).status === 0;
}

/** Minimal ACP client: handshake, one prompt, collect text + stopReason. */
async function runOnePrompt(
  adapterEntry: string,
  prompt: string,
  timeoutMs = 150_000,
): Promise<{ text: string; stopReason: string; toolCalls: number }> {
  const cwd = mkdtempSync(join(tmpdir(), "baby-menu-adapter-e2e-"));
  spawnSync("git", ["init", "-q"], { cwd });

  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [adapterEntry], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let buffer = "";
  let nextId = 1;
  const pending = new Map<number, (msg: Record<string, unknown>) => void>();
  let text = "";
  let toolCalls = 0;

  const send = (method: string, params: unknown): Promise<Record<string, unknown>> => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve) => pending.set(id, resolve));
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        pending.get(msg.id as number)?.(msg);
        pending.delete(msg.id as number);
      } else if (msg.method === "session/update") {
        const update = (msg.params as { update?: Record<string, unknown> })?.update;
        if (update?.sessionUpdate === "agent_message_chunk") {
          const content = update.content as { type?: string; text?: string };
          if (content?.type === "text") text += content.text ?? "";
        } else if (update?.sessionUpdate === "tool_call") {
          toolCalls += 1;
        }
      }
    }
  });

  try {
    const init = await send("initialize", { protocolVersion: 1, clientCapabilities: { fs: {}, terminal: false } });
    expect((init.result as { protocolVersion?: number })?.protocolVersion).toBe(1);
    const session = await send("session/new", { cwd, mcpServers: [] });
    const sessionId = (session.result as { sessionId?: string })?.sessionId;
    expect(typeof sessionId).toBe("string");

    const promptResult = await Promise.race([
      send("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("prompt timed out")), timeoutMs)),
    ]);
    return { text, stopReason: (promptResult.result as { stopReason?: string })?.stopReason ?? "", toolCalls };
  } finally {
    child.kill("SIGTERM");
  }
}

describe.skipIf(!RUN)("adapter e2e against the real CLIs", () => {
  it.skipIf(!cliExists("claude"))(
    "claude adapter streams a real answer and ends the turn",
    async () => {
      const entry = join(ADAPTERS, "claude", "index.mjs");
      expect(existsSync(entry), "build adapters first").toBe(true);
      const { text, stopReason } = await runOnePrompt(entry, "Reply with exactly the word: pong");
      expect(text.toLowerCase()).toContain("pong");
      expect(stopReason).toBe("end_turn");
    },
    180_000,
  );

  it.skipIf(!cliExists("codex"))(
    "codex adapter streams a real answer and ends the turn",
    async () => {
      const entry = join(ADAPTERS, "codex", "index.mjs");
      expect(existsSync(entry), "build adapters first").toBe(true);
      const { text, stopReason } = await runOnePrompt(entry, "Reply with exactly the word: pong");
      expect(text.toLowerCase()).toContain("pong");
      expect(stopReason).toBe("end_turn");
    },
    180_000,
  );
});
