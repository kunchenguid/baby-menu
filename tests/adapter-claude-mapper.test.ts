import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapClaudeEvent, type ClaudeEvent } from "../src/adapters/claude/mapper";
import type * as schema from "@agentclientprotocol/sdk";

const FIXTURES = join(__dirname, "fixtures", "protocols", "claude");

function loadEvents(file: string): ClaudeEvent[] {
  // The real stream can carry a leading non-JSON warning line (e.g. claude's
  // "no stdin data received" notice); the driver skips those, so the loader
  // does too.
  const events: ClaudeEvent[] = [];
  for (const line of readFileSync(join(FIXTURES, file), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as ClaudeEvent);
    } catch {
      /* skip non-JSON noise */
    }
  }
  return events;
}

function runFixture(file: string): { updates: schema.SessionUpdate[]; stopReason?: schema.StopReason } {
  const updates: schema.SessionUpdate[] = [];
  let stopReason: schema.StopReason | undefined;
  for (const event of loadEvents(file)) {
    const result = mapClaudeEvent(event);
    updates.push(...result.updates);
    if (result.stopReason) stopReason = result.stopReason;
  }
  return { updates, stopReason };
}

describe("mapClaudeEvent", () => {
  it("ignores system (init + hook noise) and rate_limit events", () => {
    expect(mapClaudeEvent({ type: "system", subtype: "init" }).updates).toEqual([]);
    expect(mapClaudeEvent({ type: "system", subtype: "hook_started" }).updates).toEqual([]);
    expect(mapClaudeEvent({ type: "system", subtype: "hook_response" }).updates).toEqual([]);
    expect(mapClaudeEvent({ type: "rate_limit_event" }).updates).toEqual([]);
  });

  it("maps assistant text to agent_message_chunk", () => {
    const result = mapClaudeEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Hello, Kun!" }] },
    });
    expect(result.updates).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello, Kun!" } },
    ]);
  });

  it("maps assistant tool_use to tool_call with mapped kind", () => {
    const result = mapClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "echo hi" } }],
      },
    });
    expect(result.updates).toEqual([
      {
        sessionUpdate: "tool_call",
        toolCallId: "toolu_1",
        title: "Bash",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "echo hi" },
      },
    ]);
  });

  it("maps tool_result to tool_call_update with completed status", () => {
    const result = mapClaudeEvent({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "toolu_1", is_error: false, content: "hi" }],
      },
    });
    expect(result.updates).toEqual([
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "hi" } }],
      },
    ]);
  });

  it("marks failed tool results", () => {
    const result = mapClaudeEvent({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "boom" }] },
    });
    expect(result.updates[0]).toMatchObject({ sessionUpdate: "tool_call_update", status: "failed" });
  });

  it("resolves end_turn on a successful result without re-emitting text", () => {
    const result = mapClaudeEvent({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Final answer",
      stop_reason: "end_turn",
    });
    expect(result.updates).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("classifies an error result as a terminal provider failure", () => {
    const result = mapClaudeEvent({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "401 Unauthorized: Missing bearer authentication sk-private-fixture",
    });
    expect(result.stopReason).toBeUndefined();
    expect(result.terminalError).toMatchObject({
      name: "AdapterTurnError",
      code: "AUTHENTICATION_FAILED",
      message: "Claude is not authenticated. Run `claude` and complete sign-in, then try again.",
    });
  });

  describe("against real recorded fixtures", () => {
    it("oneshot produces one assistant chunk and end_turn", () => {
      const { updates, stopReason } = runFixture("01-oneshot-stream-json.jsonl");
      expect(updates.filter((u) => u.sessionUpdate === "agent_message_chunk").length).toBeGreaterThanOrEqual(1);
      expect(stopReason).toBe("end_turn");
    });

    it("tool-use fixture yields a tool_call and a matching tool_call_update", () => {
      const { updates, stopReason } = runFixture("03-tool-use.jsonl");
      const calls = updates.filter((u) => u.sessionUpdate === "tool_call");
      const completions = updates.filter((u) => u.sessionUpdate === "tool_call_update");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(completions.length).toBeGreaterThanOrEqual(1);
      const openedIds = new Set(calls.map((c) => (c as { toolCallId: string }).toolCallId));
      for (const completion of completions) {
        expect(openedIds.has((completion as { toolCallId: string }).toolCallId)).toBe(true);
      }
      expect(stopReason).toBe("end_turn");
    });
  });
});
