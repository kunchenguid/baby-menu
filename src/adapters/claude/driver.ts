import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type * as schema from "@agentclientprotocol/sdk";
import type { SessionDriver, UpdateSink } from "../shared/types.js";
import { LineReader } from "../shared/line-reader.js";
import { logDebug, logError } from "../shared/log.js";
import { childEnv } from "../shared/child-env.js";
import { mapClaudeEvent, type ClaudeEvent } from "./mapper.js";

const SCOPE = "claude-adapter";
const TERMINATION_GRACE_MS = 1000;

export type ClaudeDriverOptions = {
  /** Override the claude binary (tests inject a fake). Defaults to "claude". */
  command?: string;
  /** Extra args appended after the defaults (e.g. --model). */
  extraArgs?: string[];
};

/**
 * Drives `claude -p` per turn. The first turn runs `claude -p <prompt>` and
 * captures the session id from the stream; subsequent turns run
 * `claude -p --resume <id> <prompt>` so conversation memory carries over.
 *
 * Why per-turn instead of one persistent process: `claude -p --input-format
 * stream-json` does NOT process input until stdin reaches EOF (it is not a
 * realtime REPL), so a persistent stdin-open process hangs. Per-turn + --resume
 * is the supported way to keep memory, and mirrors the codex adapter.
 *
 * baby-menu is approve-all and Claude runs its own tools directly in cwd (the
 * change-session snapshot captures the edits), so we pass
 * `--permission-mode bypassPermissions`.
 */
export class ClaudeDriver implements SessionDriver {
  private readonly command: string;
  private readonly extraArgs: string[];
  private cwd: string | null = null;
  private sessionId: string | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private activePrompt: Promise<schema.StopReason> | null = null;
  private activeCancel: (() => void) | null = null;

  constructor(options: ClaudeDriverOptions = {}) {
    this.command = options.command ?? "claude";
    this.extraArgs = options.extraArgs ?? [];
  }

  async start(cwd: string): Promise<void> {
    this.cwd = cwd;
  }

  async prompt(text: string, sink: UpdateSink, signal: AbortSignal): Promise<schema.StopReason> {
    const cwd = this.cwd;
    if (!cwd) throw new Error("claude session not started");
    if (this.child) throw new Error("a prompt is already in progress");

    const flags = [
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      // Run lean and scoped to the extension workspace. Without these, the
      // embedded agent inherits the user's ~/.claude config - global CLAUDE.md,
      // skills, MCP servers, and SessionStart hooks - which bloats context and
      // slows every turn. Project/local settings come from cwd (the workspace).
      "--setting-sources",
      "project,local",
      // No --mcp-config is passed, so strict mode means zero MCP servers.
      "--strict-mcp-config",
      "--disable-slash-commands",
      ...this.extraArgs,
    ];
    const args = this.sessionId
      ? ["-p", "--resume", this.sessionId, ...flags, text]
      : ["-p", ...flags, text];

    logDebug(SCOPE, "spawn", this.command, this.sessionId ? "(resume)" : "(new)");
    const child = spawn(this.command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: childEnv() });
    this.child = child;
    // claude reads stdin until EOF before producing output; the prompt is passed
    // as an arg, so close stdin immediately.
    child.stdin.end();
    const reader = new LineReader();

    const activePrompt = new Promise<schema.StopReason>((resolve, reject) => {
      let settled = false;
      let stopReason: schema.StopReason | null = null;
      let cancelled = false;
      let forceKillTimer: ReturnType<typeof setTimeout> | null = null;

      const settle = (reason: schema.StopReason) => {
        if (settled) return;
        settled = true;
        if (forceKillTimer) clearTimeout(forceKillTimer);
        this.child = null;
        this.activePrompt = null;
        this.activeCancel = null;
        signal.removeEventListener("abort", onAbort);
        resolve(reason);
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        if (forceKillTimer) clearTimeout(forceKillTimer);
        this.child = null;
        this.activePrompt = null;
        this.activeCancel = null;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      };

      const onAbort = () => {
        if (settled || cancelled) return;
        cancelled = true;
        logDebug(SCOPE, "cancel: killing claude");
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), TERMINATION_GRACE_MS);
      };
      this.activeCancel = onAbort;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        for (const line of reader.push(chunk)) {
          let event: ClaudeEvent & { session_id?: string };
          try {
            event = JSON.parse(line) as ClaudeEvent & { session_id?: string };
          } catch {
            logDebug(SCOPE, "non-json stdout line", line);
            continue;
          }
          // The driver owns session id capture (the mapper is pure/ACP-only).
          if (event.session_id) this.sessionId = event.session_id;
          const result = mapClaudeEvent(event);
          for (const update of result.updates) sink(update);
          if (result.errorMessage) {
            sink({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: result.errorMessage } });
          }
          if (result.stopReason) stopReason = result.stopReason;
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => logDebug(SCOPE, "stderr", chunk.trimEnd()));
      child.on("error", (err) => {
        if (cancelled) settle("cancelled");
        else fail(err instanceof Error ? err : new Error(String(err)));
      });
      child.on("exit", (code) => {
        logDebug(SCOPE, "claude exited", code);
        if (cancelled) {
          settle("cancelled");
          return;
        }
        if (stopReason) settle(stopReason);
        else if (code === 0) settle("end_turn");
        else fail(new Error(`claude exited with code ${code}`));
      });
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    });
    this.activePrompt = activePrompt;
    return activePrompt;
  }

  async dispose(): Promise<void> {
    const activePrompt = this.activePrompt;
    const activeCancel = this.activeCancel;
    if (activePrompt && activeCancel) {
      activeCancel();
      await activePrompt.catch(() => undefined);
      return;
    }
    if (this.child) {
      this.child.kill("SIGTERM");
    }
  }
}
