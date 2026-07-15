#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

let connection;
let sessionId = null;

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
  async newSession() {
    sessionId = randomUUID();
    return { sessionId };
  },
  async prompt(params) {
    if (params.sessionId !== sessionId) throw new Error("unknown test session");
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
