import type { ReactNode } from "react";

export type RecipeMetadata = {
  id: string;
  title: string;
  fileName: string;
  path: string;
};

export type GitSessionSnapshot = {
  startedClean: boolean;
  canSave: boolean;
  canRollback: boolean;
  head: string | null;
  message?: string;
};

export type GitActionResult = {
  ok: boolean;
  reason?: string;
  commit?: string;
};

export type AgentChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
};

export type AgentChatResult = {
  assistantText: string;
  session?: GitSessionSnapshot;
};

export type AgentRuntimeStatus = {
  text: string;
  eventType: "text_delta";
};

export type BabyMenuAgentOption = {
  name: string;
  label: string;
  available: boolean;
  installHint?: string;
};

export type BabyMenuSettings = {
  openAtLogin: boolean;
  /** Name of the active embedded agent. */
  agentName: string;
  /** Present when the current runtime state prevents switching agents. */
  agentSwitchDisabledReason?: string;
  /** Selectable agents; unavailable ones are shown disabled with an install hint. */
  agents: BabyMenuAgentOption[];
};

// SQL bind parameters: positional (an array) or named (an object keyed by the
// bare parameter name, e.g. { name } for ":name").
export type SqlParams = unknown[] | Record<string, unknown>;

export type SqlRunResult = {
  changes: number;
  lastInsertRowid: number | bigint;
};

// The synchronous SQL surface extensions use from server actions and background
// tasks. The host's ExtensionDatabase implements this plus lifecycle (close).
export type BabyMenuDatabase = {
  query: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => T[];
  get: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => T | undefined;
  run: (sql: string, params?: SqlParams) => SqlRunResult;
  exec: (sql: string) => void;
  transaction: <T>(fn: () => T) => T;
};

export type BabyMenuNotification = {
  title: string;
  body?: string;
};

// Passed to every server action and background task. Privileged, main-process side.
export type BabyMenuServerContext = {
  rootDir: string;
  db: BabyMenuDatabase;
  // Show a native system notification. The main reason a background task is worth
  // having: it can alert the user (e.g. a threshold breach) while the popover is closed.
  notify: (notification: BabyMenuNotification) => void;
};

// Declared as `export const background` in an extension's server.ts. The host runs
// `run` on its own timer (clamped to a 60s floor) whether or not the popover is open,
// so it is the place for work that must keep happening in the background. Persist
// results with `context.db` and a widget can read them on open.
export type BabyMenuBackgroundTask = {
  intervalMs: number;
  run: (context: BabyMenuServerContext) => void | Promise<void>;
  // Whether to run once as soon as the task is scheduled (default true) so data is
  // warm before the first refresh tick.
  runOnStart?: boolean;
};

export type BackgroundTaskUpdate = {
  extensionId: string;
};

export type BabyMenuCapabilityDescriptor = {
  id: string;
  extensionId: string;
  action: string;
};

export type BabyMenuWidgetModuleDescriptor = {
  id: string;
  extensionId: string;
  moduleUrl: string;
  // Compiled per-widget Tailwind stylesheet, present only in packaged/compiled
  // mode. In dev/source mode widget utilities come from the global stylesheet.
  cssUrl?: string;
};

export type BabyMenuWidget = {
  id: string;
  title: string;
  render: () => ReactNode;
};

export type RefreshableBabyMenuWidget = BabyMenuWidget &
  (
    | {
        // View refresh re-renders a visible widget. It is owned by the host and
        // paused while the popover is hidden. It is not a way to sync data in the
        // background - declare a `background` task in server.ts for that.
        viewRefreshIntervalMs?: number;
        refreshView: () => void | Promise<void>;
      }
    | {
        viewRefreshIntervalMs?: never;
        refreshView?: never;
      }
  );

export type PopoverVisibilityState = {
  visible: boolean;
};

export type BabyMenuApi = {
  recipes: {
    list: () => Promise<RecipeMetadata[]>;
  };
  git: {
    save: (message?: string) => Promise<GitActionResult>;
    rollback: () => Promise<GitActionResult>;
  };
  agent: {
    send: (prompt: string) => Promise<AgentChatResult>;
    onStatus: (listener: (status: AgentRuntimeStatus) => void) => () => void;
  };
  capabilities: {
    list: () => Promise<BabyMenuCapabilityDescriptor[]>;
    invoke: <T = unknown>(extensionId: string, action: string, input?: unknown) => Promise<T>;
  };
  // Direct access to the shared local SQLite store. Queries run synchronously in the
  // main process, so keep renderer-side queries small and indexed; push heavy work
  // into a background task that writes results back to a table.
  db: {
    query: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => Promise<T[]>;
    get: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => Promise<T | undefined>;
    run: (sql: string, params?: SqlParams) => Promise<SqlRunResult>;
    exec: (sql: string) => Promise<void>;
  };
  widgets: {
    list: () => Promise<BabyMenuWidgetModuleDescriptor[]>;
  };
  background: {
    // Fires when an extension's background task finishes a run, so an open widget
    // can re-read its data. Nothing arrives while the task runs with the popover
    // closed - the widget just reads warm data the next time it opens.
    onUpdate: (listener: (event: BackgroundTaskUpdate) => void) => () => void;
  };
  popover: {
    setContentHeight: (height: number) => Promise<{ ok: boolean }>;
    getVisibility: () => Promise<PopoverVisibilityState>;
    onVisibility: (listener: (state: PopoverVisibilityState) => void) => () => void;
  };
  settings: {
    get: () => Promise<BabyMenuSettings>;
    setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuSettings>;
    /** Switches the embedded agent; callers should confirm because this resets the current conversation. */
    setAgent: (agentName: string) => Promise<BabyMenuSettings>;
  };
  app: {
    /** Fully quits the Electron app from the popover shell. */
    quit: () => Promise<{ ok: boolean }>;
  };
};

declare global {
  interface Window {
    babyMenu?: BabyMenuApi;
    __BABY_MENU_WIDGET_HOST__?: {
      React: unknown;
      jsxRuntime: unknown;
      ui: unknown;
    };
  }
}
