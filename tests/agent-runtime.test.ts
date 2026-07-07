import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AcpRuntimeEvent, AcpRuntimeTurn } from "acpx/runtime";
import {
  AgentTimeoutError,
  AgentTurnFailedError,
  BabyMenuAgentRuntime,
  agentRuntimeStatusForEvent,
  buildBabyMenuAgentPrompt,
  collectAgentTurnOutput,
  getAgentRuntimeCwd,
  resolveAgentTimeoutMs,
  resolveDefaultAgentName,
  withAgentTimeout,
} from "../src/main/agent-runtime";

function available(commands: string[]) {
  const commandSet = new Set(commands);
  return (command: string) => commandSet.has(command);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(condition: () => boolean, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition");
    await wait(1);
  }
}

function fakeTurn({
  events,
  cancel = vi.fn(async () => undefined),
  closeStream = vi.fn(async () => undefined),
}: {
  events: AsyncIterable<AcpRuntimeEvent>;
  cancel?: AcpRuntimeTurn["cancel"];
  closeStream?: AcpRuntimeTurn["closeStream"];
}): AcpRuntimeTurn {
  return {
    requestId: "test-turn",
    events,
    result: Promise.resolve({ status: "completed" }),
    cancel,
    closeStream,
  };
}

describe("agent runtime defaults", () => {
  it("honors BABY_MENU_AGENT before auto-detecting local agents", () => {
    expect(
      resolveDefaultAgentName({
        env: { BABY_MENU_AGENT: "mock-target" },
        commandExists: available(["codex", "claude"]),
      }),
    ).toBe("mock-target");
  });

  it("prefers Claude before Codex for the default ACP path", () => {
    expect(
      resolveDefaultAgentName({
        env: {},
        commandExists: available(["codex", "claude", "npx"]),
      }),
    ).toBe("claude");
  });

  it("uses Codex when Claude is unavailable", () => {
    expect(
      resolveDefaultAgentName({
        env: {},
        commandExists: available(["codex", "npx"]),
      }),
    ).toBe("codex");
  });

  it("uses Codex when it is the only preferred local agent available", () => {
    expect(
      resolveDefaultAgentName({
        env: {},
        commandExists: available(["codex"]),
      }),
    ).toBe("codex");
  });

  it("falls back to Claude instead of OpenCode when no preferred CLI is detected", () => {
    expect(
      resolveDefaultAgentName({
        env: {},
        commandExists: available([]),
      }),
    ).toBe("claude");
  });

  it("uses a bounded default request timeout", () => {
    expect(resolveAgentTimeoutMs({})).toBe(300_000);
  });

  it("launches embedded agents from the tracked extension workspace by default", () => {
    expect(getAgentRuntimeCwd("/repo")).toBe("/repo/extensions");
  });

  it("launches embedded agents from extensions-dev when dev mode provides one", () => {
    expect(getAgentRuntimeCwd("/repo", { BABY_MENU_EXTENSIONS_DIR: "/repo/extensions-dev" })).toBe(
      "/repo/extensions-dev",
    );
  });

  it("resolves relative dev extension workspaces inside the repo", () => {
    expect(getAgentRuntimeCwd("/repo", { BABY_MENU_EXTENSIONS_DIR: "extensions-dev" })).toBe(
      "/repo/extensions-dev",
    );
  });

  it("allows BABY_MENU_AGENT_TIMEOUT_MS to override the request timeout", () => {
    expect(resolveAgentTimeoutMs({ BABY_MENU_AGENT_TIMEOUT_MS: "45000" })).toBe(45_000);
  });

  it("rejects and runs cleanup when an agent operation times out", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const pending = new Promise<string>(() => undefined);

    const timed = withAgentTimeout(pending, {
      timeoutMs: 25,
      phase: "starting agent session",
      onTimeout: cleanup,
    });
    const assertion = expect(timed).rejects.toThrow("Agent request timed out after 25ms while starting agent session");

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(cleanup).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("keeps waiting while an ACP turn emits activity before the idle timeout", async () => {
    vi.useFakeTimers();

    async function* events(): AsyncIterable<AcpRuntimeEvent> {
      yield { type: "tool_call", text: "shell: git status" };
      await wait(40);
      yield { type: "text_delta", stream: "thought", text: "thinking" };
      await wait(40);
      yield { type: "text_delta", stream: "output", text: "done" };
    }

    const collected = collectAgentTurnOutput(fakeTurn({ events: events() }), { idleTimeoutMs: 50 });

    await vi.advanceTimersByTimeAsync(40);
    await vi.advanceTimersByTimeAsync(40);

    await expect(collected).resolves.toBe("done");
    vi.useRealTimers();
  });

  it("cancels the ACP turn when it produces no activity before the idle timeout", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    const closeStream = vi.fn(async () => undefined);

    async function* events(): AsyncIterable<AcpRuntimeEvent> {
      await wait(1_000);
      yield { type: "text_delta", stream: "output", text: "too late" };
    }

    const collected = collectAgentTurnOutput(fakeTurn({ events: events(), cancel, closeStream }), {
      idleTimeoutMs: 25,
    });
    const assertion = expect(collected).rejects.toThrow(AgentTimeoutError);

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(cancel).toHaveBeenCalledWith({ reason: "timeout" });
    expect(closeStream).toHaveBeenCalledWith({ reason: "timeout" });
    vi.useRealTimers();
  });

  it("only turns assistant output text into user-facing status text", () => {
    expect(
      agentRuntimeStatusForEvent({
        type: "tool_call",
        text: "shell command",
        title: "checking GitHub",
      } as AcpRuntimeEvent),
    ).toBeNull();
    expect(
      agentRuntimeStatusForEvent({ type: "status", text: "usage updated: 100 tokens" } as AcpRuntimeEvent),
    ).toBeNull();
    expect(
      agentRuntimeStatusForEvent({ type: "text_delta", stream: "thought", text: "thinking" } as AcpRuntimeEvent),
    ).toBeNull();
    expect(
      agentRuntimeStatusForEvent({ type: "text_delta", stream: "output", text: "final answer" } as AcpRuntimeEvent),
    ).toEqual({ text: "final answer", eventType: "text_delta" });
  });

  it("does not publish partial streamed assistant chunks as status", async () => {
    const statuses: string[] = [];

    async function* events(): AsyncIterable<AcpRuntimeEvent> {
      yield { type: "text_delta", stream: "output", text: "Built the" };
      yield { type: "text_delta", stream: "output", text: " widget." };
    }

    const collected = collectAgentTurnOutput(fakeTurn({ events: events() }), {
      idleTimeoutMs: 50,
      onStatus: (status) => {
        statuses.push(status.text);
      },
    });

    await expect(collected).resolves.toBe("Built the widget.");
    expect(statuses).toEqual(["Built the widget."]);
  });

  it("tells agents to keep new widget capabilities hot reloadable", () => {
    const prompt = buildBabyMenuAgentPrompt("Build a Codex quota widget");

    expect(prompt).toContain("Build a Codex quota widget");
    expect(prompt).toContain("self-contained extensions");
    expect(prompt).toContain("current extension workspace");
    expect(prompt).toContain("Do not modify files outside your current extension workspace");
    expect(prompt).toContain("stable window.babyMenu bridge");
    expect(prompt).toContain("window.babyMenu.capabilities.invoke");
    expect(prompt).toContain("server.ts");
    expect(prompt).toContain("Do not add new preload methods");
    expect(prompt).toContain("server action");
    expect(prompt).toContain("recipes/");
  });

  it("aligns runtime guidance with extension-only verification", () => {
    const prompt = buildBabyMenuAgentPrompt("Build a Codex quota widget");

    expect(prompt).not.toContain("test-driven");
    expect(prompt).not.toContain("Run relevant tests");
    expect(prompt).toContain("Do not write test files");
    expect(prompt).toContain("do not write README or other documentation files");
  });

  it("requires grounding live/system data widgets in the real source before writing code, and verifying against real data before reporting done", () => {
    const prompt = buildBabyMenuAgentPrompt("Build a Codex quota widget");

    expect(prompt).toContain("inspect that actual source directly");
    expect(prompt).toContain("before writing any parsing or rendering code");
    expect(prompt).toContain("targeted, read-only check against a specific known source");
    expect(prompt).toContain("not permission to run broad or recursive searches");
    expect(prompt).toMatch(/never guess or pattern-complete/i);
    expect(prompt).toContain("verify the finished widget against that same live data");
    expect(prompt).toContain("print only non-secret metadata or explicitly redacted placeholders");
    expect(prompt).toContain("never echo raw tokens, credential blobs, cookies, auth headers");
    expect(prompt).not.toContain(
      "Verify extension work by reasoning through widget render output and server action return shapes.",
    );
  });

  it("rejects a second send while an agent turn is already running", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-agent-runtime-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    const runtime = new BabyMenuAgentRuntime(rootDir, {
      agentName: "mock-agent",
      paths: {
        extensionsDir,
        agentStateDir: join(rootDir, ".cache", "acp-sessions"),
        snapshotDir: join(rootDir, ".cache", "snapshots"),
      },
    });
    const pendingOutputs: Array<(output: string) => void> = [];
    const runtimeInternals = runtime as unknown as {
      ensureAgentRuntimeCwd: () => Promise<string>;
      beginChangeSession: () => Promise<{
        startedClean: boolean;
        canSave: boolean;
        canRollback: boolean;
        snapshot: (message?: string) => { startedClean: boolean; canSave: boolean; canRollback: boolean; head: string | null; message?: string };
        save: () => Promise<{ ok: boolean }>;
        rollback: () => Promise<{ ok: boolean }>;
      }>;
      ensureRuntime: () => Promise<{
        ensureSession: () => Promise<object>;
        startTurn: () => AcpRuntimeTurn;
      }>;
      collectTurnOutput: () => Promise<string>;
    };
    runtimeInternals.ensureAgentRuntimeCwd = vi.fn(async () => extensionsDir);
    runtimeInternals.beginChangeSession = vi.fn(async () => ({
      startedClean: true,
      canSave: true,
      canRollback: true,
      snapshot: (message?: string) => ({ startedClean: true, canSave: true, canRollback: true, head: "HEAD", message }),
      save: vi.fn(async () => ({ ok: true })),
      rollback: vi.fn(async () => ({ ok: true })),
    }));
    runtimeInternals.ensureRuntime = vi.fn(async () => ({
      ensureSession: vi.fn(async () => ({})),
      startTurn: vi.fn(() => fakeTurn({ events: (async function* () {})() })),
    }));
    runtimeInternals.collectTurnOutput = vi.fn(
      () => new Promise<string>((resolve) => pendingOutputs.push(resolve)),
    );

    const firstSend = runtime.send("first widget");
    await waitUntil(() => pendingOutputs.length === 1);

    const secondSend = runtime.send("second widget");
    const secondResult = await Promise.race([
      secondSend,
      wait(25).then(() => "still-running" as const),
    ]);

    for (const resolve of pendingOutputs) resolve("first done");
    await Promise.allSettled([firstSend, secondSend]);

    expect(secondResult).not.toBe("still-running");
    expect(secondResult).toMatchObject({
      assistantText: expect.stringContaining("already running"),
    });
    expect(runtimeInternals.beginChangeSession).toHaveBeenCalledOnce();
    expect(runtimeInternals.collectTurnOutput).toHaveBeenCalledOnce();
  });
});

describe("agent runtime switching", () => {
  function buildRuntime() {
    const runtime = new BabyMenuAgentRuntime("/repo", { agentName: "claude" });
    const internals = runtime as unknown as {
      runtime: { close: ReturnType<typeof vi.fn> } | null;
      handle: object | null;
      activeSession: object | null;
    };
    return { runtime, internals };
  }

  it("reports the configured agent as the current agent", () => {
    const { runtime } = buildRuntime();
    expect(runtime.currentAgent).toBe("claude");
  });

  it("ignores a switch to the same or empty agent", async () => {
    const { runtime, internals } = buildRuntime();
    const close = vi.fn(async () => undefined);
    internals.runtime = { close };
    internals.handle = {};

    await runtime.setAgent("claude");
    await runtime.setAgent("   ");

    expect(close).not.toHaveBeenCalled();
    expect(runtime.currentAgent).toBe("claude");
  });

  it("switches agent and resets the live session with discarded state", async () => {
    const { runtime, internals } = buildRuntime();
    const close = vi.fn(async () => undefined);
    internals.runtime = { close };
    internals.handle = { sessionKey: "baby-menu-agent-chat" };
    internals.activeSession = { startedClean: true };

    await runtime.setAgent("codex");

    expect(close).toHaveBeenCalledWith({
      handle: { sessionKey: "baby-menu-agent-chat" },
      reason: "agent-switch",
      discardPersistentState: true,
    });
    expect(runtime.currentAgent).toBe("codex");
    expect(internals.runtime).toBeNull();
    expect(internals.handle).toBeNull();
    expect(internals.activeSession).toBeNull();
  });

  it("switches agent even when no runtime is active yet", async () => {
    const { runtime } = buildRuntime();
    await runtime.setAgent("codex");
    expect(runtime.currentAgent).toBe("codex");
  });

  it("setRegistryOverrides replaces the overrides used to build the next runtime", async () => {
    const runtime = new BabyMenuAgentRuntime("/repo", { agentName: "claude", registryOverrides: { claude: "old" } });
    const internals = runtime as unknown as { registryOverrides: Record<string, string> | undefined };
    expect(internals.registryOverrides).toEqual({ claude: "old" });

    await runtime.setRegistryOverrides({ claude: "old", gemini: "gemini acp" });
    expect(internals.registryOverrides).toEqual({ claude: "old", gemini: "gemini acp" });

    // Empty/undefined collapses to undefined so createAgentRegistry gets no overrides.
    await runtime.setRegistryOverrides({});
    expect(internals.registryOverrides).toBeUndefined();
  });

  it("setRegistryOverrides closes an active runtime without discarding persistent state", async () => {
    const { runtime, internals } = buildRuntime();
    const close = vi.fn(async () => undefined);
    internals.runtime = { close };
    internals.handle = { sessionKey: "baby-menu-agent-chat" };

    await runtime.setRegistryOverrides({ claude: "updated command" });

    expect(close).toHaveBeenCalledWith({
      handle: { sessionKey: "baby-menu-agent-chat" },
      reason: "registry-overrides-change",
      discardPersistentState: undefined,
    });
    expect(internals.runtime).toBeNull();
    expect(internals.handle).toBeNull();
  });

  it("setRegistryOverrides waits to close the runtime until a pending change session is resolved", async () => {
    const { runtime, internals } = buildRuntime();
    const close = vi.fn(async () => undefined);
    internals.runtime = { close };
    internals.handle = { sessionKey: "baby-menu-agent-chat" };
    internals.activeSession = {
      canSave: true,
      canRollback: true,
      save: vi.fn(async () => ({ ok: true })),
    };

    await runtime.setRegistryOverrides({ claude: "updated command" });

    expect(close).not.toHaveBeenCalled();

    await runtime.save();

    expect(close).toHaveBeenCalledWith({
      handle: { sessionKey: "baby-menu-agent-chat" },
      reason: "registry-overrides-change",
      discardPersistentState: undefined,
    });
    expect(internals.runtime).toBeNull();
    expect(internals.handle).toBeNull();
  });
});

describe("agent runtime change-session snapshot", () => {
  function buildRuntime() {
    const runtime = new BabyMenuAgentRuntime("/repo", { agentName: "claude" });
    const internals = runtime as unknown as {
      activeSession: unknown;
      activeTurn: boolean;
      activeTurnInfo: { title: string; startedAt: number } | null;
    };
    return { runtime, internals };
  }

  it("returns null when no change session is open", async () => {
    const { runtime } = buildRuntime();
    expect(await runtime.currentSessionSnapshot()).toBeNull();
  });

  it("returns null when the open session can no longer be saved or rolled back", async () => {
    const { runtime, internals } = buildRuntime();
    const snapshot = vi.fn();
    internals.activeSession = { canSave: false, canRollback: false, snapshot };
    expect(await runtime.currentSessionSnapshot()).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("returns the active session snapshot, enriched with the diff, so the renderer can re-hydrate", async () => {
    const { runtime, internals } = buildRuntime();
    const snap = { startedClean: true, canSave: true, canRollback: true, head: null, message: "m" };
    const changes = [{ type: "extension", extensionId: "battery", kind: "updated" }];
    internals.activeSession = {
      canSave: true,
      canRollback: true,
      snapshot: vi.fn(() => ({ ...snap })),
      describeChanges: vi.fn(async () => changes),
      hasChanges: vi.fn(async () => true),
    };
    expect(await runtime.currentSessionSnapshot()).toEqual({ ...snap, changes, dirty: true });
  });

  it("does not leave a saveable session open after a no-change turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-runtime-"));
    const runtime = new BabyMenuAgentRuntime(rootDir, { agentName: "claude" });
    const internals = runtime as unknown as {
      activeSession: unknown;
      activeTurn: boolean;
      activeTurnInfo: { title: string; startedAt: number } | null;
    };
    const session = {
      startedClean: true,
      canSave: true,
      canRollback: true,
      snapshot: vi.fn((message?: string) => ({ startedClean: true, canSave: true, canRollback: true, head: "HEAD", message })),
      describeChanges: vi.fn(async () => []),
      hasChanges: vi.fn(async () => false),
      save: vi.fn(async () => ({ ok: true })),
      rollback: vi.fn(async () => ({ ok: true })),
    };
    const sendInternals = runtime as unknown as {
      ensureAgentRuntimeCwd: () => Promise<string>;
      beginChangeSession: () => Promise<unknown>;
      ensureRuntime: () => Promise<unknown>;
      collectTurnOutput: () => Promise<string>;
    };
    sendInternals.ensureAgentRuntimeCwd = vi.fn(async () => join(rootDir, "extensions"));
    sendInternals.beginChangeSession = vi.fn(async () => session);
    sendInternals.ensureRuntime = vi.fn(async () => ({
      ensureSession: vi.fn(async () => ({})),
      startTurn: vi.fn(() => fakeTurn({ events: (async function* () {})() })),
    }));
    sendInternals.collectTurnOutput = vi.fn(async () => "No edits needed.");

    const result = await runtime.send("make no edits");

    expect(result.session?.dirty).toBe(false);
    expect(session.save).toHaveBeenCalledOnce();
    expect(internals.activeSession).toBeNull();
    expect(runtime.agentSwitchDisabledReason).toBeUndefined();
  });

  it("does NOT report a saveable snapshot while a turn is still running", async () => {
    const { runtime, internals } = buildRuntime();
    // The change session is created at the start of a turn, so it is saveable the
    // whole time the build runs - but the renderer must not show Keep/Rollback yet.
    const snapshot = vi.fn();
    internals.activeSession = { canSave: true, canRollback: true, snapshot };
    internals.activeTurn = true;
    expect(await runtime.currentSessionSnapshot()).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("exposes the running turn so the renderer can restore the run strip", () => {
    const { runtime, internals } = buildRuntime();
    expect(runtime.currentTurn()).toBeNull();
    const info = { title: "add a codex widget", startedAt: 1_700_000_000_000 };
    internals.activeTurnInfo = info;
    expect(runtime.currentTurn()).toBe(info);
  });
});

describe("agent runtime telemetry", () => {
  function recordingTelemetry() {
    const events: Array<{ name: string; fields: Record<string, unknown> }> = [];
    return {
      events,
      client: {
        track: (name: string, fields: Record<string, unknown> = {}) => {
          events.push({ name, fields });
        },
        pageview: () => {},
        close: async () => {},
      },
    };
  }

  type SendInternals = {
    ensureAgentRuntimeCwd: () => Promise<string>;
    beginChangeSession: () => Promise<unknown>;
    ensureRuntime: () => Promise<unknown>;
    collectTurnOutput: () => Promise<string>;
  };

  function stubCleanSend(runtime: BabyMenuAgentRuntime, extensionsDir: string, collect: () => Promise<string>) {
    const internals = runtime as unknown as SendInternals;
    internals.ensureAgentRuntimeCwd = vi.fn(async () => extensionsDir);
    internals.beginChangeSession = vi.fn(async () => ({
      startedClean: true,
      canSave: true,
      canRollback: true,
      snapshot: (message?: string) => ({ startedClean: true, canSave: true, canRollback: true, head: "HEAD", message }),
      save: vi.fn(async () => ({ ok: true })),
      rollback: vi.fn(async () => ({ ok: true })),
    }));
    internals.ensureRuntime = vi.fn(async () => ({
      ensureSession: vi.fn(async () => ({})),
      startTurn: vi.fn(() => fakeTurn({ events: (async function* () {})() })),
    }));
    internals.collectTurnOutput = vi.fn(collect);
  }

  it("reports an agent_switch event when the active agent changes", async () => {
    const telemetry = recordingTelemetry();
    const runtime = new BabyMenuAgentRuntime("/repo", { agentName: "claude", telemetry: telemetry.client });

    await runtime.setAgent("codex");

    expect(telemetry.events).toContainEqual({ name: "agent_switch", fields: { agent: "codex" } });
  });

  it("reports custom instead of user-defined agent names", async () => {
    const telemetry = recordingTelemetry();
    const runtime = new BabyMenuAgentRuntime("/repo", { agentName: "claude", telemetry: telemetry.client });

    await runtime.setAgent("my-private-agent");

    expect(telemetry.events).toContainEqual({ name: "agent_switch", fields: { agent: "custom" } });
  });

  it("does not report agent_switch for a no-op switch", async () => {
    const telemetry = recordingTelemetry();
    const runtime = new BabyMenuAgentRuntime("/repo", { agentName: "claude", telemetry: telemetry.client });

    await runtime.setAgent("claude");

    expect(telemetry.events).toHaveLength(0);
  });

  it("reports a successful agent_turn after a completed send", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-telemetry-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    const telemetry = recordingTelemetry();
    const runtime = new BabyMenuAgentRuntime(rootDir, {
      agentName: "mock-agent",
      telemetry: telemetry.client,
      paths: {
        extensionsDir,
        agentStateDir: join(rootDir, ".cache", "acp-sessions"),
        snapshotDir: join(rootDir, ".cache", "snapshots"),
      },
    });
    stubCleanSend(runtime, extensionsDir, async () => "built a widget");

    await runtime.send("add a widget");

    expect(telemetry.events).toContainEqual({
      name: "agent_turn",
      fields: { agent: "custom", status: "success" },
    });
  });

  it("reports a failed agent_turn when the turn throws", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-telemetry-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    const telemetry = recordingTelemetry();
    const runtime = new BabyMenuAgentRuntime(rootDir, {
      agentName: "mock-agent",
      telemetry: telemetry.client,
      paths: {
        extensionsDir,
        agentStateDir: join(rootDir, ".cache", "acp-sessions"),
        snapshotDir: join(rootDir, ".cache", "snapshots"),
      },
    });
    stubCleanSend(runtime, extensionsDir, async () => {
      throw new Error("boom");
    });

    await expect(runtime.send("add a widget")).rejects.toThrow("boom");

    expect(telemetry.events).toContainEqual({
      name: "agent_turn",
      fields: { agent: "custom", status: "error" },
    });
  });
});

describe("agent runtime session resume recovery", () => {
  function failedTurn(error: {
    message: string;
    code?: string;
    detailCode?: string;
    retryable?: boolean;
  }): AcpRuntimeTurn {
    return {
      requestId: "failed-turn",
      events: (async function* () {})(),
      result: Promise.resolve({ status: "failed", error }),
      cancel: vi.fn(async () => undefined),
      closeStream: vi.fn(async () => undefined),
    };
  }

  it("throws a structured AgentTurnFailedError carrying the acpx detail code", async () => {
    const turn = failedTurn({
      message: "Persistent ACP session 810619c3 could not be resumed: agent does not support session/load",
      code: "RUNTIME",
      detailCode: "SESSION_RESUME_REQUIRED",
      retryable: true,
    });

    await expect(collectAgentTurnOutput(turn, { idleTimeoutMs: 50 })).rejects.toMatchObject({
      name: "AgentTurnFailedError",
      detailCode: "SESSION_RESUME_REQUIRED",
      retryable: true,
    });
  });

  type RecoveryInternals = {
    ensureAgentRuntimeCwd: () => Promise<string>;
    beginChangeSession: () => Promise<unknown>;
    ensureRuntime: () => Promise<unknown>;
    collectTurnOutput: () => Promise<string>;
  };

  async function buildRecoveryRuntime(collectImpls: Array<() => Promise<string>>) {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-resume-"));
    const extensionsDir = join(rootDir, "extensions-dev");
    const agentStateDir = join(rootDir, ".cache", "acp-sessions");
    const sessionFile = join(agentStateDir, "sessions", "baby-menu-agent-chat.json");
    await mkdir(join(agentStateDir, "sessions"), { recursive: true });
    await writeFile(sessionFile, JSON.stringify({ stale: true }), "utf8");

    const telemetry: Array<{ name: string; fields: Record<string, unknown> }> = [];
    const runtime = new BabyMenuAgentRuntime(rootDir, {
      agentName: "codex",
      telemetry: {
        track: (name: string, fields: Record<string, unknown> = {}) => telemetry.push({ name, fields }),
        pageview: () => {},
        close: async () => {},
      },
      paths: { extensionsDir, agentStateDir, snapshotDir: join(rootDir, ".cache", "snapshots") },
    });

    const internals = runtime as unknown as RecoveryInternals;
    internals.ensureAgentRuntimeCwd = vi.fn(async () => extensionsDir);
    internals.beginChangeSession = vi.fn(async () => ({
      startedClean: true,
      canSave: true,
      canRollback: true,
      snapshot: (message?: string) => ({ startedClean: true, canSave: true, canRollback: true, head: "HEAD", message }),
      save: vi.fn(async () => ({ ok: true })),
      rollback: vi.fn(async () => ({ ok: true })),
    }));
    internals.ensureRuntime = vi.fn(async () => ({
      ensureSession: vi.fn(async () => ({})),
      startTurn: vi.fn(() => fakeTurn({ events: (async function* () {})() })),
    }));
    const collect = vi.fn();
    for (const impl of collectImpls) collect.mockImplementationOnce(impl);
    internals.collectTurnOutput = collect;

    return { runtime, telemetry, sessionFile, collect };
  }

  it("recovers from SESSION_RESUME_REQUIRED by discarding the persisted session and retrying once", async () => {
    const { runtime, telemetry, sessionFile, collect } = await buildRecoveryRuntime([
      async () => {
        throw new AgentTurnFailedError({
          message: "Persistent ACP session could not be resumed: agent does not support session/load",
          code: "RUNTIME",
          detailCode: "SESSION_RESUME_REQUIRED",
          retryable: true,
        });
      },
      async () => "built the widget after a fresh session",
    ]);

    expect(existsSync(sessionFile)).toBe(true);

    const result = await runtime.send("add a widget");

    expect(result.assistantText).toContain("built the widget after a fresh session");
    expect(collect).toHaveBeenCalledTimes(2);
    // The stale persisted session record is deleted so the retry starts fresh.
    expect(existsSync(sessionFile)).toBe(false);
    // A recovered turn reports success, not error.
    expect(telemetry).toContainEqual({ name: "agent_turn", fields: { agent: "codex", status: "success" } });
    expect(telemetry).not.toContainEqual({ name: "agent_turn", fields: { agent: "codex", status: "error" } });
  });

  it("does not discard the session or retry for an unrelated turn failure", async () => {
    const { runtime, telemetry, sessionFile, collect } = await buildRecoveryRuntime([
      async () => {
        throw new AgentTurnFailedError({ message: "model error", code: "RUNTIME", detailCode: "ACP_TURN_FAILED" });
      },
    ]);

    await expect(runtime.send("add a widget")).rejects.toThrow("model error");

    expect(collect).toHaveBeenCalledTimes(1);
    expect(existsSync(sessionFile)).toBe(true);
    expect(telemetry).toContainEqual({ name: "agent_turn", fields: { agent: "codex", status: "error" } });
  });
});
