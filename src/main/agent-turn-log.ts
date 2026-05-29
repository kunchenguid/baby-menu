import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AcpRuntimeEvent } from "acpx/runtime";

const execFileAsync = promisify(execFile);
const MAX_PROMPT_PREVIEW_LENGTH = 500;

type TimeoutDetails = {
  timeoutMs: number;
  phase: string;
  message: string;
};

type AgentTurnLogEvent = {
  at: string;
  type: string;
  stream?: string;
};

type AgentTurnLogStatus = "started" | "completed" | "failed" | "timed_out";

type FailureDetails = {
  message: string;
  code?: string;
  detailCode?: string;
};

type AgentTurnLogRecord = {
  schemaVersion: 1;
  agentName: string;
  requestId: string;
  promptPreview: string;
  startedAt: string;
  endedAt?: string;
  lastActivityAt?: string;
  status: AgentTurnLogStatus;
  events: AgentTurnLogEvent[];
  timeout?: TimeoutDetails;
  error?: FailureDetails;
  gitStatusBeforeTimeout: string | null;
  gitStatusAfterTimeout?: string | null;
};

export class AgentTurnLogRecorder {
  private constructor(
    readonly filePath: string,
    private readonly rootDir: string,
    private readonly record: AgentTurnLogRecord,
  ) {}

  static async start({
    rootDir,
    agentName,
    requestId,
    prompt,
  }: {
    rootDir: string;
    agentName: string;
    requestId: string;
    prompt: string;
  }): Promise<AgentTurnLogRecorder> {
    const logDir = join(rootDir, ".cache", "baby-menu", "agent-turns");
    await mkdir(logDir, { recursive: true });
    const startedAt = new Date().toISOString();
    const filePath = join(logDir, `${safeFileSegment(startedAt)}-${safeFileSegment(requestId)}.json`);
    const recorder = new AgentTurnLogRecorder(filePath, rootDir, {
      schemaVersion: 1,
      agentName,
      requestId,
      promptPreview: previewPrompt(prompt),
      startedAt,
      status: "started",
      events: [],
      gitStatusBeforeTimeout: await readGitStatus(rootDir),
    });
    await recorder.write();
    return recorder;
  }

  async recordEvent(event: AcpRuntimeEvent): Promise<void> {
    const at = new Date().toISOString();
    const logEvent: AgentTurnLogEvent = {
      at,
      type: event.type,
    };
    const stream = streamForEvent(event);
    if (stream) logEvent.stream = stream;
    this.record.events.push(logEvent);
    this.record.lastActivityAt = at;
    await this.write();
  }

  async recordTimeout(error: TimeoutDetails): Promise<void> {
    this.record.status = "timed_out";
    this.record.endedAt = new Date().toISOString();
    this.record.timeout = {
      timeoutMs: error.timeoutMs,
      phase: error.phase,
      message: error.message,
    };
    this.record.gitStatusAfterTimeout = await readGitStatus(this.rootDir);
    await this.write();
  }

  async finish(status: Exclude<AgentTurnLogStatus, "started" | "timed_out">): Promise<void> {
    this.record.status = status;
    this.record.endedAt = new Date().toISOString();
    await this.write();
  }

  // Records why a turn failed so a swallowed runtime error (for example the
  // adapter rejecting a stale persisted session) is diagnosable from the log.
  async finishFailed(error: FailureDetails): Promise<void> {
    this.record.status = "failed";
    this.record.endedAt = new Date().toISOString();
    this.record.error = error;
    await this.write();
  }

  private async write(): Promise<void> {
    await writeFile(this.filePath, `${JSON.stringify(this.record, null, 2)}\n`, "utf8");
  }
}

async function readGitStatus(rootDir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: rootDir });
    return stdout.trim();
  } catch {
    return null;
  }
}

function previewPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim().slice(0, MAX_PROMPT_PREVIEW_LENGTH);
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function streamForEvent(event: AcpRuntimeEvent): string | undefined {
  const maybeStream = (event as { stream?: unknown }).stream;
  return typeof maybeStream === "string" ? maybeStream : undefined;
}
