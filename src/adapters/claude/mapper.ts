import type * as schema from "@agentclientprotocol/sdk";
import { providerTurnError, type MapResult } from "../shared/types.js";

/**
 * Pure mapping from a single `claude -p --output-format stream-json` event to
 * the ACP session updates it produces. A turn ends when a `result` event
 * arrives, which carries the terminal stop reason.
 *
 * Shapes are taken from real recordings (claude 2.1.156) in
 * tests/fixtures/protocols/claude/. The driver runs with
 * `--setting-sources project,local`, so user-level SessionStart hooks no longer
 * fire; we still ignore any `type:"system"` event defensively (older fixtures,
 * project-level hooks, future event types).
 */
export type ClaudeEvent = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string;
  message?: { role?: string; content?: ClaudeBlock[] | string };
};

type ClaudeBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input?: unknown }
  | { type: "tool_result"; tool_use_id: string; is_error?: boolean; content?: unknown };

const EMPTY: MapResult = { updates: [] };

export function mapClaudeEvent(event: ClaudeEvent): MapResult {
  switch (event.type) {
    case "assistant":
      return mapAssistant(event);
    case "user":
      return mapUser(event);
    case "result":
      return mapResult(event);
    // "system" (init + hook_* noise) and "rate_limit_event" carry no turn content.
    default:
      return EMPTY;
  }
}

function mapAssistant(event: ClaudeEvent): MapResult {
  const blocks = Array.isArray(event.message?.content) ? event.message!.content : [];
  const updates: schema.SessionUpdate[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text) {
      updates.push({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: block.text } });
    } else if (block.type === "tool_use") {
      updates.push({
        sessionUpdate: "tool_call",
        toolCallId: block.id,
        title: block.name,
        kind: toolKind(block.name),
        status: "in_progress",
        rawInput: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return { updates };
}

function mapUser(event: ClaudeEvent): MapResult {
  const blocks = Array.isArray(event.message?.content) ? event.message!.content : [];
  const updates: schema.SessionUpdate[] = [];
  for (const block of blocks) {
    if (block.type === "tool_result") {
      updates.push({
        sessionUpdate: "tool_call_update",
        toolCallId: block.tool_use_id,
        status: block.is_error ? "failed" : "completed",
        content: toToolContent(block.content),
      });
    }
  }
  return { updates };
}

function mapResult(event: ClaudeEvent): MapResult {
  // The final `result` text was already streamed via assistant chunks; do not
  // re-emit it. Just resolve the turn with the mapped stop reason.
  const stopReason = mapStopReason(event);
  if (event.is_error) {
    return { updates: [], terminalError: providerTurnError("Claude", event.result) };
  }
  return { updates: [], stopReason };
}

function mapStopReason(event: ClaudeEvent): schema.StopReason {
  if (event.is_error) return "refusal";
  switch (event.stop_reason) {
    case "max_tokens":
      return "max_tokens";
    case "end_turn":
    default:
      return "end_turn";
  }
}

function toToolContent(content: unknown): schema.ToolCallContent[] {
  const text = normalizeContentText(content);
  if (!text) return [];
  return [{ type: "content", content: { type: "text", text } }];
}

function normalizeContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && "text" in block ? String((block as { text: unknown }).text) : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function toolKind(name: string): schema.ToolKind {
  switch (name) {
    case "Bash":
    case "BashOutput":
    case "KillShell":
      return "execute";
    case "Read":
    case "NotebookRead":
      return "read";
    case "Edit":
    case "Write":
    case "NotebookEdit":
    case "MultiEdit":
      return "edit";
    case "Glob":
    case "Grep":
      return "search";
    case "WebFetch":
    case "WebSearch":
      return "fetch";
    default:
      return "other";
  }
}
