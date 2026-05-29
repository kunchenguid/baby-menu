import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AcpRuntimeEvent } from "acpx/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTimeoutError } from "../src/main/agent-runtime";
import { AgentTurnLogRecorder } from "../src/main/agent-turn-log";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), "baby-menu-turn-log-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "tests@example.com"]);
  await git(repo, ["config", "user.name", "Baby Menu Turn Log Tests"]);
  await writeFile(join(repo, "tracked.txt"), "base\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  return repo;
}

async function readLog(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
}

describe("AgentTurnLogRecorder", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("records start metadata and ACP event types", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-turn-log-"));
    tempDirs.push(rootDir);

    const recorder = await AgentTurnLogRecorder.start({
      rootDir,
      agentName: "claude",
      requestId: "request-123",
      prompt: "Build\nwidget",
    });

    await recorder.recordEvent({ type: "tool_call", text: "shell: git status" } as AcpRuntimeEvent);
    await recorder.recordEvent({ type: "text_delta", stream: "thought", text: "thinking" } as AcpRuntimeEvent);
    await recorder.finish("completed");

    const log = await readLog(recorder.filePath);

    expect(recorder.filePath).toContain(join(".cache", "baby-menu", "agent-turns"));
    expect(log).toMatchObject({
      agentName: "claude",
      requestId: "request-123",
      promptPreview: "Build widget",
      status: "completed",
    });
    expect(log.startedAt).toEqual(expect.any(String));
    expect(log.endedAt).toEqual(expect.any(String));
    expect(log.lastActivityAt).toEqual(expect.any(String));
    expect(log.events).toEqual([
      expect.objectContaining({ type: "tool_call" }),
      expect.objectContaining({ type: "text_delta", stream: "thought" }),
    ]);
  });

  it("records the failure error detail when a turn fails", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-turn-log-"));
    tempDirs.push(rootDir);

    const recorder = await AgentTurnLogRecorder.start({
      rootDir,
      agentName: "codex",
      requestId: "request-failed",
      prompt: "do the thing",
    });

    await recorder.finishFailed({
      message: "Persistent ACP session abc could not be resumed: agent does not support session/load",
      code: "RUNTIME",
      detailCode: "SESSION_RESUME_REQUIRED",
    });

    const log = await readLog(recorder.filePath);

    expect(log).toMatchObject({
      status: "failed",
      error: {
        message: expect.stringContaining("could not be resumed"),
        code: "RUNTIME",
        detailCode: "SESSION_RESUME_REQUIRED",
      },
    });
    expect(log.endedAt).toEqual(expect.any(String));
  });

  it("records git status before and after an idle timeout", async () => {
    const repo = await createRepo();
    tempDirs.push(repo);
    const recorder = await AgentTurnLogRecorder.start({
      rootDir: repo,
      agentName: "claude",
      requestId: "request-timeout",
      prompt: "Take your time",
    });
    await writeFile(join(repo, "tracked.txt"), "changed\n");

    await recorder.recordTimeout(new AgentTimeoutError(300_000, "waiting for agent activity"));

    const log = await readLog(recorder.filePath);

    expect(log).toMatchObject({
      status: "timed_out",
      gitStatusBeforeTimeout: "",
      timeout: {
        timeoutMs: 300_000,
        phase: "waiting for agent activity",
      },
    });
    expect(log.endedAt).toEqual(expect.any(String));
    expect(log.gitStatusAfterTimeout).toEqual(expect.stringContaining("tracked.txt"));
  });
});
