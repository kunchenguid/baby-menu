import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type * as schema from "@agentclientprotocol/sdk";
import type { SessionDriver, UpdateSink } from "../shared/types.js";
import { LineReader } from "../shared/line-reader.js";
import { logDebug, logError } from "../shared/log.js";
import { childEnv } from "../shared/child-env.js";
import { mapCodexEvent, type CodexExecEvent } from "./mapper.js";

const SCOPE = "codex-adapter";
const TERMINATION_GRACE_MS = 1000;

export type CodexDriverOptions = {
  /** Override the codex binary (tests inject a fake). Defaults to "codex". */
  command?: string;
  /**
   * Model to pass as `--model`. `--ignore-user-config` (below) discards the
   * `model` line from ~/.codex/config.toml, so without this codex falls back to
   * a built-in default that is unsupported on ChatGPT-account logins. When
   * undefined, no `--model` is passed and codex picks its own default.
   */
  model?: string;
};

/**
 * Drives `codex exec --json` per turn. The first turn runs `codex exec <prompt>`
 * with `--color never` and captures the `thread.started` id; subsequent turns
 * run `codex exec resume <id> <prompt>` without `--color`, because the resume
 * subcommand rejects that flag, so conversation memory carries over.
 *
 * Each turn is its own short-lived child (exec is one-shot), which keeps us off
 * the `codex app-server` path that starts the computer-use MCP server behind
 * issue #296. baby-menu is approve-all, so we pass
 * `--dangerously-bypass-approvals-and-sandbox` and codex edits cwd directly
 * (captured by the change-session snapshot).
 */
export class CodexDriver implements SessionDriver {
  private readonly command: string;
  private readonly model: string | null;
  private cwd: string | null = null;
  private threadId: string | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private activePrompt: Promise<schema.StopReason> | null = null;
  private activeCancel: (() => void) | null = null;

  constructor(options: CodexDriverOptions = {}) {
    this.command = options.command ?? "codex";
    this.model = options.model ?? null;
  }

  async start(cwd: string): Promise<void> {
    this.cwd = cwd;
  }

  async prompt(text: string, sink: UpdateSink, signal: AbortSignal): Promise<schema.StopReason> {
    const cwd = this.cwd;
    if (!cwd) throw new Error("codex session not started");
    if (this.child) throw new Error("a prompt is already in progress");

    const common = [
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      // Run lean and scoped to the extension workspace. Without these, the
      // embedded agent inherits ~/.codex/config.toml - including its MCP
      // servers and user settings - plus execpolicy rules, which bloat context
      // and slow every turn. Auth still resolves via CODEX_HOME. Project
      // context comes from the cwd (the workspace) and its AGENTS.md.
      "--ignore-user-config",
      "--ignore-rules",
      // Re-inject the model that --ignore-user-config just discarded. `--model`
      // is a CLI flag, so it survives both the ignore and the resume subcommand
      // (unlike --color), and it points codex at a model the account supports.
      ...(this.model ? ["--model", this.model] : []),
    ];
    // `--color` is valid on `codex exec` but the `resume` subcommand rejects it
    // (clap exits 2), so it stays off the resume path. Output is `--json`
    // anyway, so this only suppresses any incidental coloring on the first turn.
    const args = this.threadId
      ? ["exec", "resume", this.threadId, ...common, text]
      : ["exec", ...common, "--color", "never", text];

    logDebug(SCOPE, "spawn", this.command, args.slice(0, -1).join(" "), "<prompt>");
    // codex exec takes the prompt as an arg and ignores stdin, but we pipe all
    // three streams so the handle types as ChildProcessWithoutNullStreams.
    const child = spawn(this.command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: childEnv() });
    this.child = child;
    // Close stdin immediately: codex exec reads stdin to EOF before finishing,
    // so leaving the pipe open makes it hang (and exit non-zero on teardown).
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
        logDebug(SCOPE, "cancel: killing codex exec");
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), TERMINATION_GRACE_MS);
      };
      this.activeCancel = onAbort;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        for (const line of reader.push(chunk)) {
          let event: CodexExecEvent;
          try {
            event = JSON.parse(line) as CodexExecEvent;
          } catch {
            logDebug(SCOPE, "non-json stdout line", line);
            continue;
          }
          // The driver owns thread id capture (the mapper is pure/ACP-only).
          if (event.type === "thread.started" && event.thread_id) {
            this.threadId = event.thread_id;
          }
          const result = mapCodexEvent(event);
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
        logDebug(SCOPE, "codex exec exited", code);
        if (cancelled) {
          settle("cancelled");
          return;
        }
        // turn.completed is the authoritative end; if the process exits without
        // it, fall back to the captured reason or a clean end on success.
        if (stopReason) settle(stopReason);
        else if (code === 0) settle("end_turn");
        else fail(new Error(`codex exec exited with code ${code}`));
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
