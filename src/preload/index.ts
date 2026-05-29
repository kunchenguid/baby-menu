import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentRuntimeStatus,
  BabyMenuApi,
  BabyMenuCustomAgentInput,
  BackgroundTaskUpdate,
  PopoverVisibilityState,
  SqlParams,
} from "../shared/contracts";

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
    onStatus: (listener: (status: AgentRuntimeStatus) => void) => {
      const handler = (_event: unknown, status: AgentRuntimeStatus) => listener(status);
      ipcRenderer.on("baby-menu:agent:status", handler);
      return () => ipcRenderer.removeListener("baby-menu:agent:status", handler);
    },
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
    onUpdate: (listener: (event: BackgroundTaskUpdate) => void) => {
      const handler = (_event: unknown, update: BackgroundTaskUpdate) => listener(update);
      ipcRenderer.on("baby-menu:background:update", handler);
      return () => ipcRenderer.removeListener("baby-menu:background:update", handler);
    },
  },
  popover: {
    setContentHeight: (height: number) => ipcRenderer.invoke("baby-menu:popover:set-content-height", height),
    setContentSize: (size: { width: number; height: number }) =>
      ipcRenderer.invoke("baby-menu:popover:set-content-size", size),
    getVisibility: () => ipcRenderer.invoke("baby-menu:popover:get-visibility"),
    onVisibility: (listener: (state: PopoverVisibilityState) => void) => {
      const handler = (_event: unknown, state: PopoverVisibilityState) => listener(state);
      ipcRenderer.on("baby-menu:popover:visibility", handler);
      return () => ipcRenderer.removeListener("baby-menu:popover:visibility", handler);
    },
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
