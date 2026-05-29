import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { CodexDriver } from "../src/adapters/codex/driver";
import type * as schema from "@agentclientprotocol/sdk";

const FAKE = join(__dirname, "fixtures", "fake-clis", "fake-codex.mjs");

describe("CodexDriver (against a fake codex CLI)", () => {
  let driver: CodexDriver | null = null;
  afterEach(async () => {
    await driver?.dispose();
    driver = null;
  });

  function makeDriver(): CodexDriver {
    driver = new CodexDriver({ command: FAKE });
    return driver;
  }

  it("streams an assistant chunk and resolves end_turn", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const updates: schema.SessionUpdate[] = [];
    const stop = await d.prompt("hello", (u) => updates.push(u), new AbortController().signal);
    expect(stop).toBe("end_turn");
    expect(updates.find((u) => u.sessionUpdate === "agent_message_chunk")).toMatchObject({
      content: { type: "text", text: "echo:hello" },
    });
  });

  it("resumes the session on the second prompt (carries memory)", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const s = new AbortController().signal;
    await d.prompt("first", () => {}, s);
    const updates: schema.SessionUpdate[] = [];
    await d.prompt("second", (u) => updates.push(u), s);
    // The fake replies "resumed:..." only when invoked via `exec resume <id>`,
    // proving the driver captured session.created and threaded it through.
    expect(updates.find((u) => u.sessionUpdate === "agent_message_chunk")).toMatchObject({
      content: { type: "text", text: "resumed:second" },
    });
  });

  it("surfaces a command tool_call and tool_call_update", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const updates: schema.SessionUpdate[] = [];
    await d.prompt("please RUN_TOOL now", (u) => updates.push(u), new AbortController().signal);
    expect(updates.some((u) => u.sessionUpdate === "tool_call")).toBe(true);
    expect(updates.some((u) => u.sessionUpdate === "tool_call_update")).toBe(true);
  });

  it("resolves cancelled when the signal aborts before spawning", async () => {
    const d = makeDriver();
    await d.start(tmpdir());
    const ac = new AbortController();
    ac.abort();
    expect(await d.prompt("hi", () => {}, ac.signal)).toBe("cancelled");
  });
});
