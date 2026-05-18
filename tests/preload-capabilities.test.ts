import { beforeEach, describe, expect, it, vi } from "vitest";

const exposeInMainWorld = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const removeListener = vi.fn();

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

describe("preload capabilities bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    invoke.mockResolvedValue(undefined);
  });

  it("exposes stable capability list and invoke helpers", async () => {
    await import("../src/preload/index");
    const api = exposeInMainWorld.mock.calls[0]?.[1];

    await api.capabilities.list();
    expect(invoke).toHaveBeenCalledWith("baby-menu:capabilities:list");

    await api.capabilities.invoke("demo", "ping", { ok: true });
    expect(invoke).toHaveBeenCalledWith("baby-menu:capabilities:invoke", "demo", "ping", { ok: true });

    await api.widgets.list();
    expect(invoke).toHaveBeenCalledWith("baby-menu:widgets:list");

    await api.popover.setContentHeight(333);
    expect(invoke).toHaveBeenCalledWith("baby-menu:popover:set-content-height", 333);

    await api.settings.get();
    expect(invoke).toHaveBeenCalledWith("baby-menu:settings:get");

    await api.settings.setOpenAtLogin(true);
    expect(invoke).toHaveBeenCalledWith("baby-menu:settings:set-open-at-login", true);
  });

  it("exposes agent status events from the main process", async () => {
    await import("../src/preload/index");
    const api = exposeInMainWorld.mock.calls[0]?.[1];
    const listener = vi.fn();

    const unsubscribe = api.agent.onStatus(listener);
    const handler = on.mock.calls[0]?.[1];
    handler({}, { text: "I built the widget", eventType: "text_delta" });

    expect(on).toHaveBeenCalledWith("baby-menu:agent:status", expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ text: "I built the widget", eventType: "text_delta" });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("baby-menu:agent:status", handler);
  });
});
