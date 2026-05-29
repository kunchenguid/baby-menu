import type * as schema from "@agentclientprotocol/sdk";

/**
 * A sink the mappers/drivers use to emit ACP session updates for the current
 * turn. The generic agent wires this to `AgentSideConnection.sessionUpdate`.
 */
export type UpdateSink = (update: schema.SessionUpdate) => void;

/**
 * The result of mapping a single CLI event. A mapper is a pure reducer: given a
 * parsed backend event, it returns the ACP updates to emit and, when the turn
 * has ended, the terminal stop reason.
 */
export type MapResult = {
  updates: schema.SessionUpdate[];
  /** Set once the turn is complete; resolves the ACP prompt. */
  stopReason?: schema.StopReason;
  /** Optional human-facing error detail (surfaced as a final agent message). */
  errorMessage?: string;
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
