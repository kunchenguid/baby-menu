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

export type BabyMenuSettings = {
  openAtLogin: boolean;
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
        refreshIntervalMs?: number;
        refresh: () => void | Promise<void>;
      }
    | {
        refreshIntervalMs?: never;
        refresh?: never;
      }
  );

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
  widgets: {
    list: () => Promise<BabyMenuWidgetModuleDescriptor[]>;
  };
  popover: {
    setContentHeight: (height: number) => Promise<{ ok: boolean }>;
  };
  settings: {
    get: () => Promise<BabyMenuSettings>;
    setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuSettings>;
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
