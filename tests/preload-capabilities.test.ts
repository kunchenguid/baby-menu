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

    await api.db.query("SELECT 1", [1]);
    expect(invoke).toHaveBeenCalledWith("baby-menu:db:query", "SELECT 1", [1]);

    await api.db.get("SELECT 1");
    expect(invoke).toHaveBeenCalledWith("baby-menu:db:get", "SELECT 1", undefined);

    await api.db.run("INSERT INTO t VALUES (?)", ["x"]);
    expect(invoke).toHaveBeenCalledWith("baby-menu:db:run", "INSERT INTO t VALUES (?)", ["x"]);

    await api.db.exec("CREATE TABLE t (a)");
    expect(invoke).toHaveBeenCalledWith("baby-menu:db:exec", "CREATE TABLE t (a)");

    await api.popover.setContentHeight(333);
    expect(invoke).toHaveBeenCalledWith("baby-menu:popover:set-content-height", 333);

    await api.popover.getVisibility();
    expect(invoke).toHaveBeenCalledWith("baby-menu:popover:get-visibility");

    await api.settings.get();
    expect(invoke).toHaveBeenCalledWith("baby-menu:settings:get");

    await api.settings.setOpenAtLogin(true);
    expect(invoke).toHaveBeenCalledWith("baby-menu:settings:set-open-at-login", true);

    await api.app.quit();
    expect(invoke).toHaveBeenCalledWith("baby-menu:app:quit");
  });

  it("exposes popover visibility events from the main process", async () => {
    await import("../src/preload/index");
    const api = exposeInMainWorld.mock.calls[0]?.[1];
    const listener = vi.fn();

    const unsubscribe = api.popover.onVisibility(listener);
    const handler = on.mock.calls.at(-1)?.[1];
    handler({}, { visible: false });

    expect(on).toHaveBeenCalledWith("baby-menu:popover:visibility", expect.any(Function));
    expect(listener).toHaveBeenCalledWith({ visible: false });

    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith("baby-menu:popover:visibility", handler);
  });

  it("fans many visibility subscribers out from a single ipc listener", async () => {
    await import("../src/preload/index");
    const api = exposeInMainWorld.mock.calls[0]?.[1];
    const listeners = Array.from({ length: 12 }, () => vi.fn());

    const unsubscribers = listeners.map((listener) => api.popover.onVisibility(listener));
    const visibilityCalls = on.mock.calls.filter(([channel]) => channel === "baby-menu:popover:visibility");
    expect(visibilityCalls).toHaveLength(1);

    const handler = visibilityCalls[0]?.[1];
    handler({}, { visible: true });
    for (const listener of listeners) expect(listener).toHaveBeenCalledWith({ visible: true });

    unsubscribers[0]();
    unsubscribers[0]();
    handler({}, { visible: false });
    expect(listeners[0]).toHaveBeenCalledTimes(1);
    expect(listeners[1]).toHaveBeenCalledTimes(2);
    expect(removeListener).not.toHaveBeenCalled();

    for (const unsubscribe of unsubscribers) unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("baby-menu:popover:visibility", handler);
  });

  it("keeps one callback subscribed twice as two independent subscriptions", async () => {
    await import("../src/preload/index");
    const api = exposeInMainWorld.mock.calls[0]?.[1];
    const listener = vi.fn();

    const unsubscribeFirst = api.popover.onVisibility(listener);
    const unsubscribeSecond = api.popover.onVisibility(listener);
    const visibilityCalls = on.mock.calls.filter(([channel]) => channel === "baby-menu:popover:visibility");
    expect(visibilityCalls).toHaveLength(1);

    const handler = visibilityCalls[0]?.[1];
    handler({}, { visible: true });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribeFirst();
    unsubscribeFirst();
    listener.mockClear();
    handler({}, { visible: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ visible: false });
    expect(removeListener).not.toHaveBeenCalled();

    unsubscribeSecond();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("baby-menu:popover:visibility", handler);
    listener.mockClear();
    handler({}, { visible: true });
    expect(listener).not.toHaveBeenCalled();
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
