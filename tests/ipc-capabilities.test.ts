import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BabyMenuAgentRuntimeSendOptions } from "../src/main/agent-runtime";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  }),
};

vi.mock("electron", () => ({ ipcMain }));

describe("capabilities IPC", () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("lists recipes from the active extension workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-ipc-recipes-"));
    const recipesDir = join(rootDir, "extensions-dev", "recipes");
    await mkdir(recipesDir, { recursive: true });
    await writeFile(
      join(recipesDir, "daily-standup.html"),
      `<html><head><title>Daily Standup</title></head><body><h1>Fallback</h1></body></html>\n`,
    );
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const agentRuntime = {
      send: vi.fn(),
      save: vi.fn(),
      rollback: vi.fn(),
    };

    registerIpcHandlers(rootDir, agentRuntime, undefined, undefined, undefined, undefined, { recipesDir });

    await expect(handlers.get("baby-menu:recipes:list")?.({})).resolves.toEqual([
      {
        id: "daily-standup",
        title: "Daily Standup",
        fileName: "daily-standup.html",
        path: join(recipesDir, "daily-standup.html"),
      },
    ]);
  });

  it("registers stable capability list and invoke channels", async () => {
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const agentRuntime = {
      send: vi.fn(),
      save: vi.fn(),
      rollback: vi.fn(),
    };
    const serverActions = {
      list: vi.fn(async () => [{ id: "demo.ping", extensionId: "demo", action: "ping" }]),
      invoke: vi.fn(async (extensionId: string, action: string, input: unknown) => ({ extensionId, action, input })),
    };

    registerIpcHandlers("/repo", agentRuntime, serverActions);

    await expect(handlers.get("baby-menu:capabilities:list")?.({})).resolves.toEqual([
      { id: "demo.ping", extensionId: "demo", action: "ping" },
    ]);
    await expect(
      handlers.get("baby-menu:capabilities:invoke")?.({}, "demo", "ping", { ok: true }),
    ).resolves.toEqual({ extensionId: "demo", action: "ping", input: { ok: true } });
    expect(serverActions.invoke).toHaveBeenCalledWith("demo", "ping", { ok: true });
  });

  it("discovers capability server actions from the dev extension workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-ipc-capabilities-"));
    const actionDir = join(rootDir, "extensions-dev", "demo");
    await mkdir(actionDir, { recursive: true });
    await writeFile(
      join(actionDir, "server.mjs"),
      `export const actions = { ping: async (input, context) => ({ input, rootDir: context.rootDir }) };\n`,
    );
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const { createServerActionRegistry } = await import("../src/main/server-action-registry");
    const agentRuntime = {
      send: vi.fn(),
      save: vi.fn(),
      rollback: vi.fn(),
    };

    registerIpcHandlers(
      rootDir,
      agentRuntime,
      createServerActionRegistry({ rootDir, actionRoots: [join(rootDir, "extensions-dev")] }),
    );

    await expect(handlers.get("baby-menu:capabilities:list")?.({})).resolves.toEqual([
      { id: "demo.ping", extensionId: "demo", action: "ping" },
    ]);
    await expect(handlers.get("baby-menu:capabilities:invoke")?.({}, "demo", "ping", { ok: true })).resolves.toEqual({
      input: { ok: true },
      rootDir,
    });
  });

  it("forwards agent runtime status events to the requesting renderer", async () => {
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const sender = { send: vi.fn() };
    const agentRuntime = {
      send: vi.fn(async (_prompt: string, options?: BabyMenuAgentRuntimeSendOptions) => {
        await options?.onStatus?.({ text: "I built the widget", eventType: "text_delta" });
        return { assistantText: "done" };
      }),
      save: vi.fn(),
      rollback: vi.fn(),
    };

    registerIpcHandlers("/repo", agentRuntime);

    await handlers.get("baby-menu:agent:send")?.({ sender }, "build a widget");

    expect(agentRuntime.send).toHaveBeenCalledWith("build a widget", { onStatus: expect.any(Function) });
    expect(sender.send).toHaveBeenCalledWith("baby-menu:agent:status", {
      text: "I built the widget",
      eventType: "text_delta",
    });
  });

  it("registers a widget module discovery channel", async () => {
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const agentRuntime = {
      send: vi.fn(),
      save: vi.fn(),
      rollback: vi.fn(),
    };
    const widgetModules = {
      list: vi.fn(async () => [{ id: "cpu-temp.widget", extensionId: "cpu-temp", moduleUrl: "/@fs/cpu-temp/widget.tsx" }]),
    };

    registerIpcHandlers("/repo", agentRuntime, undefined, widgetModules);

    await expect(handlers.get("baby-menu:widgets:list")?.({})).resolves.toEqual([
      { id: "cpu-temp.widget", extensionId: "cpu-temp", moduleUrl: "/@fs/cpu-temp/widget.tsx" },
    ]);
    expect(widgetModules.list).toHaveBeenCalledOnce();
  });

  it("registers a popover content-height channel", async () => {
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const agentRuntime = {
      send: vi.fn(),
      save: vi.fn(),
      rollback: vi.fn(),
    };

    registerIpcHandlers("/repo", agentRuntime);

    await expect(handlers.get("baby-menu:popover:set-content-height")?.({}, 333)).resolves.toEqual({ ok: true });
  });

  it("registers settings channels for open-at-login", async () => {
    const { registerIpcHandlers } = await import("../src/main/ipc");
    const agentRuntime = {
      send: vi.fn(),
      save: vi.fn(),
      rollback: vi.fn(),
    };
    const settings = {
      get: vi.fn(async () => ({ openAtLogin: false })),
      setOpenAtLogin: vi.fn(async (openAtLogin: boolean) => ({ openAtLogin })),
    };

    registerIpcHandlers("/repo", agentRuntime, undefined, undefined, undefined, settings);

    await expect(handlers.get("baby-menu:settings:get")?.({})).resolves.toEqual({ openAtLogin: false });
    await expect(handlers.get("baby-menu:settings:set-open-at-login")?.({}, true)).resolves.toEqual({ openAtLogin: true });
    expect(settings.setOpenAtLogin).toHaveBeenCalledWith(true);
  });
});
