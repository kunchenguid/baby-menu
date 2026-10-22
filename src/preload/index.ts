import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentRuntimeStatus,
  BabyMenuApi,
  BabyMenuCustomAgentInput,
  BackgroundTaskUpdate,
  PopoverVisibilityState,
  SqlParams,
} from "../shared/contracts";

// One ipcRenderer listener per channel, fanned out to every subscriber, so a
// layout with many widgets never trips Node's MaxListenersExceededWarning.
function createEventChannel<T>(channel: string) {
  const listeners = new Set<(payload: T) => void>();
  const handler = (_event: unknown, payload: T) => {
    for (const listener of [...listeners]) listener(payload);
  };
  return (listener: (payload: T) => void) => {
    // A fresh wrapper keeps a function subscribed twice as two independent subscriptions.
    const subscription = (payload: T) => listener(payload);
    if (listeners.size === 0) ipcRenderer.on(channel, handler);
    listeners.add(subscription);
    return () => {
      if (!listeners.delete(subscription)) return;
      if (listeners.size === 0) ipcRenderer.removeListener(channel, handler);
    };
  };
}

const api: BabyMenuApi = {
  recipes: {
    list: () => ipcRenderer.invoke("baby-menu:recipes:list"),
  },
  git: {
    save: (message?: string) => ipcRenderer.invoke("baby-menu:git:save", message),
    rollback: () => ipcRenderer.invoke("baby-menu:git:rollback"),
    status: () => ipcRenderer.invoke("baby-menu:git:status"),
  },
  agent: {
    send: (prompt: string) => ipcRenderer.invoke("baby-menu:agent:send", prompt),
    onStatus: createEventChannel<AgentRuntimeStatus>("baby-menu:agent:status"),
    getActiveTurn: () => ipcRenderer.invoke("baby-menu:agent:active-turn"),
  },
  capabilities: {
    list: () => ipcRenderer.invoke("baby-menu:capabilities:list"),
    invoke: (extensionId: string, action: string, input?: unknown) =>
      ipcRenderer.invoke("baby-menu:capabilities:invoke", extensionId, action, input),
  },
  db: {
    query: (sql: string, params?: SqlParams) => ipcRenderer.invoke("baby-menu:db:query", sql, params),
    get: (sql: string, params?: SqlParams) => ipcRenderer.invoke("baby-menu:db:get", sql, params),
    run: (sql: string, params?: SqlParams) => ipcRenderer.invoke("baby-menu:db:run", sql, params),
    exec: (sql: string) => ipcRenderer.invoke("baby-menu:db:exec", sql),
  },
  widgets: {
    list: () => ipcRenderer.invoke("baby-menu:widgets:list"),
  },
  layout: {
    get: () => ipcRenderer.invoke("baby-menu:layout:get"),
  },
  background: {
    onUpdate: createEventChannel<BackgroundTaskUpdate>("baby-menu:background:update"),
  },
  popover: {
    setContentHeight: (height: number) => ipcRenderer.invoke("baby-menu:popover:set-content-height", height),
    setContentSize: (size: { width: number; height: number }) =>
      ipcRenderer.invoke("baby-menu:popover:set-content-size", size),
    getVisibility: () => ipcRenderer.invoke("baby-menu:popover:get-visibility"),
    onVisibility: createEventChannel<PopoverVisibilityState>("baby-menu:popover:visibility"),
  },
  settings: {
    get: () => ipcRenderer.invoke("baby-menu:settings:get"),
    setOpenAtLogin: (openAtLogin: boolean) => ipcRenderer.invoke("baby-menu:settings:set-open-at-login", openAtLogin),
    setAgent: (agentName: string) => ipcRenderer.invoke("baby-menu:settings:set-agent", agentName),
    addAgent: (input: BabyMenuCustomAgentInput) => ipcRenderer.invoke("baby-menu:settings:add-agent", input),
    updateAgent: (name: string, input: { label?: string; command: string }) =>
      ipcRenderer.invoke("baby-menu:settings:update-agent", name, input),
    removeAgent: (name: string) => ipcRenderer.invoke("baby-menu:settings:remove-agent", name),
  },
  app: {
    quit: () => ipcRenderer.invoke("baby-menu:app:quit"),
    getUpdateStatus: () => ipcRenderer.invoke("baby-menu:app:get-update-status"),
    openReleasePage: () => ipcRenderer.invoke("baby-menu:app:open-release-page"),
  },
};

contextBridge.exposeInMainWorld("babyMenu", api);
