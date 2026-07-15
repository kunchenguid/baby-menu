import type * as schema from "@agentclientprotocol/sdk";

/**
 * A sink the mappers/drivers use to emit ACP session updates for the current
 * turn. The generic agent wires this to `AgentSideConnection.sessionUpdate`.
 */
export type UpdateSink = (update: schema.SessionUpdate) => void;

export type AdapterTurnErrorCode =
  | "AUTHENTICATION_FAILED"
  | "RATE_LIMITED"
  | "PROVIDER_FAILED"
  | "CLI_START_FAILED"
  | "CLI_EXIT_FAILED"
  | "ADAPTER_FAILED";

/** A safe terminal adapter failure whose message may cross ACP into the UI. */
export class AdapterTurnError extends Error {
  constructor(
    readonly code: AdapterTurnErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdapterTurnError";
  }
}

type AdapterName = "Claude" | "Codex";

export function providerTurnError(agent: AdapterName, detail: unknown): AdapterTurnError {
  const text = typeof detail === "string" ? detail : "";
  if (/\b401\b|unauthorized|authentication|not logged in|missing bearer/i.test(text)) {
    const message =
      agent === "Codex"
        ? "Codex is not authenticated. Run `codex login` and try again."
        : "Claude is not authenticated. Run `claude` and complete sign-in, then try again.";
    return new AdapterTurnError("AUTHENTICATION_FAILED", message);
  }
  if (/\b429\b|rate.?limit|quota/i.test(text)) {
    return new AdapterTurnError("RATE_LIMITED", `${agent} is rate limited. Wait for access to recover, then try again.`);
  }
  return new AdapterTurnError("PROVIDER_FAILED", `${agent} provider failed the request.`);
}

export function safeAdapterTurnError(error: unknown): AdapterTurnError {
  if (error instanceof AdapterTurnError) return error;
  return new AdapterTurnError("ADAPTER_FAILED", "The embedded agent failed while processing the request.");
}

/**
 * The result of mapping a single CLI event. A mapper is a pure reducer: given a
 * parsed backend event, it returns the ACP updates to emit and, when the turn
 * has ended, the terminal stop reason.
 */
export type MapResult = {
  updates: schema.SessionUpdate[];
  /** Set once the turn completes successfully; resolves the ACP prompt. */
  stopReason?: schema.StopReason;
  /** Safe typed failure for a terminal provider event. */
  terminalError?: AdapterTurnError;
};

/**
 * Backend-agnostic session driver. Each adapter (claude, codex) implements this
 * over its CLI; the generic ACP agent drives it.
 */
export interface SessionDriver {
  /** Start (or lazily prepare) the backend for a session rooted at `cwd`. */
  start(cwd: string): Promise<void>;
  /**
   * Run one user turn. Emit ACP updates via `sink` as backend events arrive and
   * resolve with the terminal stop reason once the turn completes. Must honor
   * `signal` (ACP cancel) and resolve with "cancelled" when aborted.
   */
  prompt(text: string, sink: UpdateSink, signal: AbortSignal): Promise<schema.StopReason>;
  /** Tear down any backend process. */
  dispose(): Promise<void>;
}

export const EMPTY: MapResult = { updates: [] };
