import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { mockAgentCommand } from "acp-mock";
import { afterEach, describe, expect, it } from "vitest";
import { BabyMenuAgentRuntime } from "../src/main/agent-runtime";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(import.meta.dirname, "..");
const acpMockBinPath = join(repoRoot, "node_modules", "acp-mock", "dist", "cli.js");
const refusalAgentPath = join(repoRoot, "tests", "fixtures", "fake-acp-refusal.mjs");

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

async function gitText(cwd: string, args: string[]) {
  const { stdout } = await git(cwd, args);
  return stdout.trim();
}

async function createRepo() {
  const repo = await mkdtemp(join(tmpdir(), "baby-menu-acp-e2e-"));
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "tests@example.com"]);
  await git(repo, ["config", "user.name", "Baby Menu ACP Tests"]);
  await writeFile(join(repo, "README.md"), "# fixture\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-m", "initial"]);
  return repo;
}

async function readJsonLines(filePath: string): Promise<Record<string, unknown>[]> {
  if (!existsSync(filePath)) return [];
  return (await readFile(filePath, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function readTurnLogs(repo: string): Promise<Record<string, unknown>[]> {
  const logDir = join(repo, ".cache", "baby-menu", "agent-turns");
  if (!existsSync(logDir)) return [];
  const files = await readdir(logDir);
  return Promise.all(files.map((file) => readFile(join(logDir, file), "utf8").then((text) => JSON.parse(text) as Record<string, unknown>)));
}

function buildMockCommand(eventLogPath: string) {
  return mockAgentCommand({
    bin: acpMockBinPath,
    eventLogPath,
    agentMessageJson: {
      summary: "mock acp turn completed",
      changed: ["README.md"],
    },
    appendFile: {
      path: "../README.md",
      text: "- edited by acp-mock\n",
    },
  });
}

function buildSlowMockCommand(eventLogPath: string) {
  return mockAgentCommand({
    bin: acpMockBinPath,
    eventLogPath,
    promptDelayMs: 1_000,
  });
}

describe("BabyMenuAgentRuntime ACP e2e", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it.skipIf(process.platform === "win32")(
    "runs a prompt through real acpx against acp-mock and records a change session",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "mock-target",
        registryOverrides: {
          "mock-target": buildMockCommand(mockLogPath),
        },
      });

      const result = await runtime.send("Add a simple test line");
      const readme = await readFile(join(repo, "README.md"), "utf8");
      const events = (await readJsonLines(mockLogPath)).map((entry) => entry.event);
      const turnLogs = await readTurnLogs(repo);

      expect(result.assistantText).toContain("mock acp turn completed");
      expect(result.session).toMatchObject({
        startedClean: true,
        canSave: true,
        canRollback: true,
      });
      expect(readme).toContain("edited by acp-mock");
      expect(events).toContain("agent:initialize");
      expect(events).toContain("agent:newSession");
      expect(events).toContain("agent:prompt:start");
      expect(events).toContain("agent:prompt:done");
      expect(events).toContain("workspace:changed");
      expect(turnLogs).toHaveLength(1);
      expect(turnLogs[0]).toMatchObject({
        agentName: "mock-target",
        status: "completed",
      });
      expect(turnLogs[0]?.events).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text_delta" })]));

      const save = await runtime.save("Accept acp-mock changes");
      expect(save.ok).toBe(true);
      expect(await gitText(repo, ["rev-list", "--count", "HEAD"])).toBe("2");
      expect(await gitText(repo, ["log", "-1", "--pretty=%s"])).toBe("Accept acp-mock changes");
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "rejects an ACP refusal, records failure, and closes its clean change session",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      await writeFile(join(repo, ".gitignore"), ".cache/\n");
      await git(repo, ["add", ".gitignore"]);
      await git(repo, ["commit", "-m", "ignore runtime cache"]);

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "refusal-agent",
        registryOverrides: {
          "refusal-agent": `node ${JSON.stringify(refusalAgentPath)}`,
        },
      });

      await expect(runtime.send("make an edit")).rejects.toMatchObject({
        name: "AgentTurnFailedError",
        code: "AGENT_REFUSED",
        message: "Agent refused the request.",
      });
      expect(await runtime.currentSessionSnapshot()).toBeNull();
      expect(await gitText(repo, ["status", "--porcelain"])).toBe("");

      const turnLogs = await readTurnLogs(repo);
      expect(turnLogs).toHaveLength(1);
      expect(turnLogs[0]).toMatchObject({
        status: "failed",
        error: {
          message: "Agent refused the request.",
          code: "AGENT_REFUSED",
        },
      });
      expect(JSON.stringify(turnLogs[0])).not.toContain("secret-provider-detail");
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "keeps partial workspace changes reviewable when an ACP refusal follows an edit",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      await writeFile(join(repo, ".gitignore"), ".cache/\n");
      await git(repo, ["add", ".gitignore"]);
      await git(repo, ["commit", "-m", "ignore runtime cache"]);

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "refusal-agent",
        registryOverrides: {
          "refusal-agent": `node ${JSON.stringify(refusalAgentPath)}`,
        },
      });

      await expect(runtime.send("PARTIAL_EDIT then fail")).rejects.toMatchObject({
        name: "AgentTurnFailedError",
        code: "AGENT_REFUSED",
      });

      expect(existsSync(join(repo, "extensions", "partial-widget", "widget.tsx"))).toBe(true);
      expect(await runtime.currentSessionSnapshot()).toMatchObject({
        canSave: true,
        canRollback: true,
        dirty: true,
        changes: [{ type: "extension", extensionId: "partial-widget", kind: "created" }],
      });

      expect((await runtime.rollback()).ok).toBe(true);
      expect(existsSync(join(repo, "extensions", "partial-widget"))).toBe(false);
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "recovers a stale persisted session after a restart instead of failing the turn",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      // Source mode gitignores runtime state; without this the untracked .cache
      // files (turn logs, session store) would dirty the tree before the restart.
      await writeFile(join(repo, ".gitignore"), ".cache/\n");
      await git(repo, ["add", ".gitignore"]);
      await git(repo, ["commit", "-m", "ignore runtime cache"]);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");

      const makeRuntime = () =>
        new BabyMenuAgentRuntime(repo, {
          agentName: "mock-target",
          registryOverrides: { "mock-target": buildMockCommand(mockLogPath) },
        });

      // First launch: run a turn and accept it so the tree is clean for the restart.
      const first = makeRuntime();
      await first.send("first turn");
      await first.save("accept first");
      await first.close();

      // acpx persisted the session record to disk; a fresh process will try to resume it.
      const sessionFile = join(repo, ".cache", "baby-menu", "acp-sessions", "sessions", "baby-menu-agent-chat.json");
      expect(existsSync(sessionFile)).toBe(true);

      // Restart: acp-mock reports loadSession:false, so resuming the stale record
      // fails with SESSION_RESUME_REQUIRED. The runtime must discard it and start
      // fresh rather than surfacing "Agent unavailable".
      const second = makeRuntime();
      const result = await second.send("second turn after restart");
      await second.close();

      expect(result.assistantText).toContain("mock acp turn completed");

      const turnLogs = await readTurnLogs(repo);
      const failed = turnLogs.find((log) => log.status === "failed");
      // The failed attempt proves the restart actually hit the resume path (not that
      // resume silently worked) and that the reason is now recorded in the log.
      expect(failed?.error).toMatchObject({ detailCode: "SESSION_RESUME_REQUIRED" });
      expect(turnLogs.filter((log) => log.status === "completed")).toHaveLength(2);
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "rolls back changes produced through acpx and acp-mock",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "mock-target",
        registryOverrides: {
          "mock-target": buildMockCommand(mockLogPath),
        },
      });

      await runtime.send("Add a line that should be reverted");
      expect(await readFile(join(repo, "README.md"), "utf8")).toContain("edited by acp-mock");

      const rollback = await runtime.rollback();

      expect(rollback.ok).toBe(true);
      expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# fixture\n");
      expect(await gitText(repo, ["status", "--porcelain"])).toBe("");
      expect(await gitText(repo, ["rev-list", "--count", "HEAD"])).toBe("1");
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "blocks agent switching while generated changes are pending review",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "mock-target",
        registryOverrides: {
          "mock-target": buildMockCommand(mockLogPath),
          "next-agent": buildMockCommand(mockLogPath),
        },
      });

      await runtime.send("Add a line before switching");

      await expect(runtime.setAgent("next-agent")).rejects.toThrow("Save or Rollback the current agent changes before switching agents.");
      expect(runtime.currentAgent).toBe("mock-target");
      expect(await runtime.rollback()).toMatchObject({ ok: true });
      expect(await readFile(join(repo, "README.md"), "utf8")).toBe("# fixture\n");
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "blocks agent switching while a turn is running",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "mock-target",
        registryOverrides: {
          "mock-target": buildSlowMockCommand(mockLogPath),
          "next-agent": buildMockCommand(mockLogPath),
        },
      });

      const turn = runtime.send("Keep the agent busy");

      await expect(runtime.setAgent("next-agent")).rejects.toThrow("Agent is running. Wait for it to finish before switching agents.");
      expect(runtime.currentAgent).toBe("mock-target");
      await turn;
      expect(await runtime.rollback()).toMatchObject({ ok: true });
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "blocks ACP startup when the repo is dirty so rollback remains safe",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");
      await writeFile(join(repo, "README.md"), "# user changed this first\n");

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "mock-target",
        registryOverrides: {
          "mock-target": buildMockCommand(mockLogPath),
        },
      });

      const result = await runtime.send("Try to edit anyway");
      const events = await readJsonLines(mockLogPath);

      expect(result.assistantText).toContain("working tree is already dirty");
      expect(result.session).toMatchObject({
        startedClean: false,
        canSave: false,
        canRollback: false,
      });
      expect(events).toEqual([]);
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "returns a recoverable session when an ACP turn times out",
    async () => {
      const repo = await createRepo();
      tempDirs.push(repo);
      const logDir = await mkdtemp(join(tmpdir(), "baby-menu-acp-logs-"));
      tempDirs.push(logDir);
      const mockLogPath = join(logDir, "mock-acp.jsonl");

      const runtime = new BabyMenuAgentRuntime(repo, {
        agentName: "mock-target",
        requestTimeoutMs: 100,
        registryOverrides: {
          "mock-target": buildSlowMockCommand(mockLogPath),
        },
      });

      const result = await runtime.send("Take too long");

      expect(result.assistantText).toContain("timed out");
      expect(result.assistantText).toContain("mock-target agent");
      expect(result.assistantText).toContain("100ms");
      expect(result.session).toMatchObject({
        startedClean: true,
        canSave: true,
        canRollback: true,
      });
    },
    30_000,
  );
});
