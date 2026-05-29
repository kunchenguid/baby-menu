import type * as schema from "@agentclientprotocol/sdk";
import type { MapResult } from "../shared/types.js";

/**
 * Pure mapping from a single `codex exec --json` event to the ACP session
 * updates it produces. A turn ends on `turn.completed` (or `error`).
 *
 * We drive `codex exec` (NOT `codex app-server`) deliberately: app-server starts
 * the `computer-use` MCP server, which is the machinery behind issue #296
 * (SkyComputerUseClient crash). The plain `codex exec` path never starts it.
 *
 * Shapes are from real recordings (codex-cli 0.130.0) in
 * tests/fixtures/protocols/codex/exec-*.jsonl. The item structure is FLAT -
 * `item.{ id, type, ...fields }`, e.g.:
 *   {"type":"thread.started","thread_id":"..."}            -> captured for resume
 *   {"type":"item.completed","item":{"id","type":"reasoning","text"}}
 *   {"type":"item.started","item":{"id","type":"file_change","changes":[{path,kind}],"status"}}
 *   {"type":"item.completed","item":{"id","type":"file_change","changes","status":"completed"}}
 *   {"type":"item.completed","item":{"id","type":"command_execution","command","status","aggregated_output","exit_code"}}
 *   {"type":"item.completed","item":{"id","type":"agent_message","text"}}
 *   {"type":"turn.completed","usage":{...}}                 -> end_turn
 *
 * Note `file_change` emits item.started + item.completed (paired by id), while
 * `command_execution` is observed only as item.completed - so the mapper makes
 * the command case self-contained (opens and closes the tool call together).
 * Unlike app-server, exec emits NO incremental text deltas; full text arrives
 * once on item.completed.
 */
export type CodexExecEvent = {
  type?: string;
  thread_id?: string;
  message?: string;
  item?: CodexItem;
};

type CodexItem = {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  status?: string;
  exit_code?: number;
  aggregated_output?: string;
  changes?: Array<{ path?: string; kind?: string }>;
};

const EMPTY: MapResult = { updates: [] };

export function mapCodexEvent(event: CodexExecEvent): MapResult {
  switch (event.type) {
    case "item.started":
      return mapItemStarted(event.item);
    case "item.completed":
      return mapItemCompleted(event.item);
    case "turn.completed":
      return { updates: [], stopReason: "end_turn" };
    case "turn.failed":
    case "error":
      return { updates: [], stopReason: "refusal", errorMessage: event.message };
    // thread.started / turn.started carry no ACP content (thread_id is read by
    // the driver directly, not the mapper).
    default:
      return EMPTY;
  }
}

function mapItemStarted(item: CodexItem | undefined): MapResult {
  if (!item?.id) return EMPTY;
  // Open a tool call when a long-running item begins so the UI shows it running.
  if (item.type === "file_change") {
    return { updates: [openToolCall(item)] };
  }
  if (item.type === "command_execution") {
    return { updates: [openToolCall(item)] };
  }
  return EMPTY;
}

function mapItemCompleted(item: CodexItem | undefined): MapResult {
  if (!item) return EMPTY;
  switch (item.type) {
    case "agent_message":
      return item.text
        ? { updates: [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: item.text } }] }
        : EMPTY;
    case "reasoning":
      return item.text
        ? { updates: [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: item.text } }] }
        : EMPTY;
    case "file_change":
      // file_change opened on item.started; just close it here.
      return item.id ? { updates: [closeToolCall(item)] } : EMPTY;
    case "command_execution":
      // command_execution is observed only as item.completed - emit both the
      // opener and the closer so the tool call is self-contained.
      return item.id ? { updates: [openToolCall(item), closeToolCall(item)] } : EMPTY;
    default:
      return EMPTY;
  }
}

function openToolCall(item: CodexItem): schema.SessionUpdate {
  return {
    sessionUpdate: "tool_call",
    toolCallId: item.id!,
    title: toolTitle(item),
    kind: item.type === "file_change" ? "edit" : "execute",
    status: "in_progress",
    rawInput: item.type === "file_change" ? { changes: item.changes } : { command: item.command },
  };
}

function closeToolCall(item: CodexItem): schema.SessionUpdate {
  return {
    sessionUpdate: "tool_call_update",
    toolCallId: item.id!,
    status: isFailure(item) ? "failed" : "completed",
    content: outputContent(item),
  };
}

function isFailure(item: CodexItem): boolean {
  if (typeof item.exit_code === "number") return item.exit_code !== 0;
  return item.status === "failed";
}

function toolTitle(item: CodexItem): string {
  if (item.type === "file_change") {
    const first = item.changes?.[0]?.path;
    return first ? `edit ${first.split("/").pop()}` : "file change";
  }
  if (typeof item.command === "string") return item.command.split("\n")[0]!.slice(0, 80);
  return "command";
}

function outputContent(item: CodexItem): schema.ToolCallContent[] {
  if (item.aggregated_output) {
    return [{ type: "content", content: { type: "text", text: item.aggregated_output } }];
  }
  if (item.changes?.length) {
    const summary = item.changes.map((c) => `${c.kind} ${c.path}`).join("\n");
    return [{ type: "content", content: { type: "text", text: summary } }];
  }
  return [];
}
