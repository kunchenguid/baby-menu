import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mapCodexEvent, type CodexExecEvent } from "../src/adapters/codex/mapper";
import type * as schema from "@agentclientprotocol/sdk";

const FIXTURES = join(__dirname, "fixtures", "protocols", "codex");

function runFixture(file: string): {
  updates: schema.SessionUpdate[];
  stopReason?: schema.StopReason;
} {
  const events = readFileSync(join(FIXTURES, file), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CodexExecEvent);
  const updates: schema.SessionUpdate[] = [];
  let stopReason: schema.StopReason | undefined;
  for (const event of events) {
    const result = mapCodexEvent(event);
    updates.push(...result.updates);
    if (result.stopReason) stopReason = result.stopReason;
  }
  return { updates, stopReason };
}

describe("mapCodexEvent (codex exec --json)", () => {
  it("ignores thread.started and turn.started", () => {
    expect(mapCodexEvent({ type: "thread.started", thread_id: "x" }).updates).toEqual([]);
    expect(mapCodexEvent({ type: "turn.started" }).updates).toEqual([]);
  });

  it("maps a completed agent_message to an agent_message_chunk", () => {
    const result = mapCodexEvent({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "Hello, Kun." },
    });
    expect(result.updates).toEqual([
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello, Kun." } },
    ]);
  });

  it("maps a completed reasoning item to an agent_thought_chunk", () => {
    const result = mapCodexEvent({
      type: "item.completed",
      item: { id: "item_0", type: "reasoning", text: "**Thinking**" },
    });
    expect(result.updates).toEqual([
      { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "**Thinking**" } },
    ]);
  });

  it("opens a tool_call when a file_change starts and closes it on completion (same id)", () => {
    const started = mapCodexEvent({
      type: "item.started",
      item: { id: "item_3", type: "file_change", changes: [{ path: "/x/hello.txt", kind: "add" }], status: "in_progress" },
    });
    expect(started.updates[0]).toMatchObject({
      sessionUpdate: "tool_call",
      toolCallId: "item_3",
      kind: "edit",
      status: "in_progress",
    });
    const done = mapCodexEvent({
      type: "item.completed",
      item: { id: "item_3", type: "file_change", changes: [{ path: "/x/hello.txt", kind: "add" }], status: "completed" },
    });
    expect(done.updates[0]).toMatchObject({ sessionUpdate: "tool_call_update", toolCallId: "item_3", status: "completed" });
  });

  it("emits a self-contained tool_call + update for a completed command_execution", () => {
    const result = mapCodexEvent({
      type: "item.completed",
      item: { id: "item_4", type: "command_execution", command: "echo done", status: "completed", exit_code: 0, aggregated_output: "done\n" },
    });
    expect(result.updates).toHaveLength(2);
    expect(result.updates[0]).toMatchObject({ sessionUpdate: "tool_call", toolCallId: "item_4", kind: "execute" });
    expect(result.updates[1]).toMatchObject({ sessionUpdate: "tool_call_update", toolCallId: "item_4", status: "completed" });
  });

  it("marks a non-zero exit_code command as failed", () => {
    const result = mapCodexEvent({
      type: "item.completed",
      item: { id: "item_4", type: "command_execution", command: "false", status: "completed", exit_code: 1 },
    });
    expect(result.updates[1]).toMatchObject({ status: "failed" });
  });

  it("resolves end_turn on turn.completed", () => {
    const result = mapCodexEvent({ type: "turn.completed" });
    expect(result.updates).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("classifies terminal authentication failures without retaining provider text", () => {
    const result = mapCodexEvent({
      type: "turn.failed",
      message: "401 Unauthorized: Missing bearer authentication sk-private-fixture",
    });
    expect(result.stopReason).toBeUndefined();
    expect(result.terminalError).toMatchObject({
      name: "AdapterTurnError",
      code: "AUTHENTICATION_FAILED",
      message: "Codex is not authenticated. Run `codex login` and try again.",
    });
    expect(result.terminalError?.message).not.toContain("sk-private-fixture");
  });

  describe("against real recorded fixtures", () => {
    it("hello turn emits one assistant chunk and ends end_turn", () => {
      const { updates, stopReason } = runFixture("exec-01-hello.jsonl");
      expect(updates.filter((u) => u.sessionUpdate === "agent_message_chunk").length).toBeGreaterThanOrEqual(1);
      expect(stopReason).toBe("end_turn");
    });

    it("file-edit turn opens and closes tool calls matched by id", () => {
      const { updates, stopReason } = runFixture("exec-02-file-edit.jsonl");
      const calls = updates.filter((u) => u.sessionUpdate === "tool_call");
      const ends = updates.filter((u) => u.sessionUpdate === "tool_call_update");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(ends.length).toBeGreaterThanOrEqual(1);
      const openedIds = new Set(calls.map((c) => (c as { toolCallId: string }).toolCallId));
      for (const end of ends) {
        expect(openedIds.has((end as { toolCallId: string }).toolCallId)).toBe(true);
      }
      // Both a file_change (edit) and a command_execution (execute) appear.
      expect(calls.some((c) => (c as { kind: string }).kind === "edit")).toBe(true);
      expect(calls.some((c) => (c as { kind: string }).kind === "execute")).toBe(true);
      expect(stopReason).toBe("end_turn");
    });
  });
});
