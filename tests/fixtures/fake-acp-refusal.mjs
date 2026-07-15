#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

let connection;
let sessionId = null;
let cwd = null;

const agent = {
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    };
  },
  async authenticate() {
    return {};
  },
  async newSession(params) {
    cwd = params.cwd;
    sessionId = randomUUID();
    return { sessionId };
  },
  async prompt(params) {
    if (params.sessionId !== sessionId) throw new Error("unknown test session");
    const text = params.prompt.map((block) => (block.type === "text" ? block.text : "")).join("\n");
    if (text.includes("PARTIAL_EDIT")) {
      const extensionDir = join(cwd, "partial-widget");
      await mkdir(extensionDir, { recursive: true });
      await writeFile(join(extensionDir, "widget.tsx"), "export default function Widget() { return null; }\n");
    }
    await connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Bearer secret-provider-detail" },
      },
    });
    return { stopReason: "refusal" };
  },
  async cancel() {},
};

const input = Writable.toWeb(process.stdout);
const output = Readable.toWeb(process.stdin);
const stream = ndJsonStream(input, output);
connection = new AgentSideConnection(() => agent, stream);
