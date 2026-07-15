import { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError, type Agent } from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { safeAdapterTurnError, type SessionDriver } from "./types.js";
import { logDebug, logError } from "./log.js";

/**
 * A generic ACP agent (server) that bridges acpx (the client) to a backend CLI
 * via a `SessionDriver`. Both the Claude and Codex adapters share this wiring;
 * only the driver differs.
 *
 * baby-menu runs a single persistent session per process (fixed sessionKey), so
 * this manages exactly one backend session and serializes prompts.
 */
export class BridgeAgent implements Agent {
  private conn: AgentSideConnection | null = null;
  private sessionId: string | null = null;
  private activeAbort: AbortController | null = null;

  constructor(
    private readonly driver: SessionDriver,
    private readonly scope: string,
  ) {}

  setConnection(conn: AgentSideConnection): void {
    this.conn = conn;
  }

  async initialize(params: schema.InitializeRequest): Promise<schema.InitializeResponse> {
    logDebug(this.scope, "initialize", params.protocolVersion);
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, embeddedContext: false },
      },
      authMethods: [],
    };
  }

  // baby-menu drives already-authenticated CLIs (the user's installed claude /
  // codex), so there is nothing to authenticate at the ACP layer.
  async authenticate(_params: schema.AuthenticateRequest): Promise<schema.AuthenticateResponse> {
    return {};
  }

  async newSession(params: schema.NewSessionRequest): Promise<schema.NewSessionResponse> {
    await this.driver.start(params.cwd);
    this.sessionId = randomUUID();
    logDebug(this.scope, "newSession", this.sessionId, params.cwd);
    return { sessionId: this.sessionId };
  }

  async prompt(params: schema.PromptRequest): Promise<schema.PromptResponse> {
    if (!this.conn) throw new Error("connection not established");
    if (params.sessionId !== this.sessionId) {
      throw new Error(`unknown session ${params.sessionId}`);
    }
    const text = extractText(params.prompt);
    const abort = new AbortController();
    this.activeAbort = abort;
    const sink = (update: schema.SessionUpdate) => {
      this.conn!.sessionUpdate({ sessionId: this.sessionId!, update }).catch((err: unknown) =>
        logError(this.scope, "sessionUpdate failed", err),
      );
    };
    try {
      const stopReason = await this.driver.prompt(text, sink, abort.signal);
      return { stopReason };
    } catch (error) {
      const safeError = safeAdapterTurnError(error);
      // Throwing rejects the ACP prompt so acpx and Baby Menu preserve failure
      // semantics. Log only the typed safe fields, never raw provider output.
      logError(this.scope, "prompt failed", safeError.code, safeError.message);
      const data = { adapterCode: safeError.code };
      throw safeError.code === "AUTHENTICATION_FAILED"
        ? RequestError.authRequired(data, safeError.message)
        : RequestError.internalError(data, safeError.message);
    } finally {
      this.activeAbort = null;
    }
  }

  async cancel(params: schema.CancelNotification): Promise<void> {
    if (params.sessionId !== this.sessionId) return;
    logDebug(this.scope, "cancel");
    this.activeAbort?.abort();
  }

  async dispose(): Promise<void> {
    this.activeAbort?.abort();
    await this.driver.dispose();
  }
}

function extractText(prompt: schema.ContentBlock[]): string {
  return prompt
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Entry point used by each adapter's index.ts: wire a BridgeAgent over stdio.
 * acpx spawns the adapter and speaks ACP (NDJSON) on the child's stdin/stdout.
 */
export function runAdapter(driver: SessionDriver, scope: string): void {
  const agent = new BridgeAgent(driver, scope);
  // ndJsonStream(input: WritableStream, output: ReadableStream): `input` is where
  // WE write protocol messages (our stdout); `output` is where we read the
  // client's messages (our stdin). Both are NDJSON over the child's stdio.
  const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);
  // Constructing the connection wires the agent to stdio; we keep no reference.
  new AgentSideConnection((c: AgentSideConnection) => {
    agent.setConnection(c);
    return agent;
  }, stream);

  const shutdown = () => {
    agent.dispose().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
