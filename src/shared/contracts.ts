import type { ReactNode } from "react";

export type RecipeMetadata = {
  id: string;
  title: string;
  fileName: string;
  path: string;
};

// What a single workspace surface had done to it during an agent turn, derived
// from the actual diff (git status / snapshot comparison), never from the
// agent's prose. A change targets either a specific extension or the root layout.
export type WorkspaceChangeKind = "created" | "updated" | "removed";

export type WorkspaceChange =
  | { kind: WorkspaceChangeKind; type: "extension"; extensionId: string }
  | { kind: WorkspaceChangeKind; type: "layout" };

export type GitSessionSnapshot = {
  startedClean: boolean;
  canSave: boolean;
  canRollback: boolean;
  head: string | null;
  message?: string;
  // Classification of what the turn changed. Absent when the change session
  // could not be inspected; empty when the turn touched only files we do not
  // attribute to a surface (recipes, AGENTS.md, etc.).
  changes?: WorkspaceChange[];
  // Whether the workspace actually differs from its pre-turn state. False means
  // the agent reported back without making any on-disk change.
  dirty?: boolean;
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

// The turn currently executing in the main process. `startedAt` is an epoch ms
// timestamp so the renderer can render the elapsed timer after a remount.
export type AgentActiveTurn = {
  title: string;
  startedAt: number;
};

export type BabyMenuAgentOption = {
  name: string;
  label: string;
  available: boolean;
  installHint?: string;
  /** True for user-configured ACP agents (editable/removable); false for built-ins. */
  custom?: boolean;
  /** The configured ACP launch command; only present for custom agents (for the edit form). */
  command?: string;
};

/** Fields collected by the Settings UI when adding a custom ACP agent. */
export type BabyMenuCustomAgentInput = {
  /** acpx registry id; must be unique and not collide with a built-in. */
  name: string;
  /** Display label; defaults to the name when omitted. */
  label?: string;
  /** The ACP launch command string (acpx splits it into argv). */
  command: string;
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

export type KimiQuotaWindow = {
  id: string;
  label: string;
  kind: "session" | "weekly" | "unknown";
  percentUsed: number;
  percentRemaining: number;
  resetsAt?: string;
  windowSeconds?: number;
};

export type KimiQuotaDiagnostic = {
  code: "limits_invalid" | "limit_detail_invalid";
  index?: number;
};

export type KimiQuotaSnapshot = {
  provider: "kimi";
  label: "Kimi";
  source: "api";
  refreshedAt: string;
  windows: KimiQuotaWindow[];
  diagnostics?: KimiQuotaDiagnostic[];
};

export type KimiQuotaErrorCode =
  | "kimi_credential_unavailable"
  | "unsupported_credential_type"
  | "credential_resolution_failed"
  | "request_timeout"
  | "network_unavailable"
  | "tls_failed"
  | "redirect_rejected"
  | "provider_auth_rejected"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_unavailable"
  | "provider_request_rejected"
  | "unexpected_content_type"
  | "response_too_large"
  | "response_invalid_utf8"
  | "malformed_json"
  | "schema_invalid";

export type KimiQuotaFailure = {
  code: KimiQuotaErrorCode;
  category: "credential" | "rate_limit" | "service" | "transport" | "parser" | "request";
  message: string;
  httpStatus?: number;
};

export type KimiQuotaResult = {
  status: "fresh" | "stale" | "auth_required" | "rate_limited" | "error";
  stale: boolean;
  source: "api" | "cache";
  checkedAt: string;
  snapshot?: KimiQuotaSnapshot;
  error?: KimiQuotaFailure;
  retryAt?: string;
};

// The only Pi-backed operation exposed to extension server code. It returns a
// normalized, non-secret result and does not expose Pi SDK objects or arbitrary providers.
export type BabyMenuKimiQuotaBroker = {
  acquire: (options?: { force?: boolean; maxAgeMs?: number }) => Promise<KimiQuotaResult>;
  readCached: () => KimiQuotaResult | undefined;
};

// Passed to every server action and background task. Privileged, main-process side.
export type BabyMenuServerContext = {
  rootDir: string;
  db: BabyMenuDatabase;
  // Show a native system notification. The main reason a background task is worth
  // having: it can alert the user (e.g. a threshold breach) while the popover is closed.
  notify: (notification: BabyMenuNotification) => void;
  // Host-owned fixed-operation Kimi broker. Optional for compatibility with older
  // hosts and isolated extension tests; production Baby Menu always provides it.
  kimiQuota?: BabyMenuKimiQuotaBroker;
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

// The optional, agent-authored layout module at the root of the extension
// workspace (`layout.tsx`). When present the host renders its default export in
// place of the built-in stacked column; when absent the host falls back to the
// column, so this is purely additive and older apps that never look for it keep
// working. Loaded through the same pipeline as a widget module - `moduleUrl`
// (a `/@fs` URL in dev, a `baby-menu-widget://` URL when compiled) plus a sibling
// compiled `cssUrl` in packaged mode.
export type BabyMenuLayoutModuleDescriptor = {
  moduleUrl: string;
  cssUrl?: string;
};

export type BabyMenuWidget = {
  id: string;
  title: string;
  render: () => ReactNode;
};

// A configuration surface an extension contributes to the Settings page,
// exported from `widget.tsx` alongside its widget. Renderer-only, like a widget:
// the host draws the section frame (title, dividers, spacing) and the extension
// owns only the body. It reads and writes its own configuration through the
// existing bridges (`window.babyMenu.db`), so no per-extension IPC is added.
export type BabyMenuSettingsSection = {
  // Matches the extension id; used as the section key and for stable sort order.
  extensionId: string;
  // Terse section label, e.g. "CALENDAR".
  title: string;
  // Body only; the host draws the section frame around it.
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

// The metadata the host hands a custom layout for each active extension so it
// can decide what to place and where. The layout never imports widget files
// directly; it places each one by id through `renderWidget`.
export type BabyMenuLayoutWidget = {
  id: string;
  title: string;
};

// Props the host passes to the default export of `layout.tsx`. `renderWidget`
// returns the refresh-wired, title-less render of one extension by id (null for
// an unknown id), so the layout keeps the host's view-refresh wiring while
// owning the arrangement and the overall canvas size (the host measures the
// rendered layout and resizes the popover to fit its width and height).
export type BabyMenuLayoutProps = {
  widgets: BabyMenuLayoutWidget[];
  renderWidget: (id: string) => ReactNode;
};

// The default export shape of an `extensions/layout.tsx` module.
export type BabyMenuLayout = (props: BabyMenuLayoutProps) => ReactNode;

export type PopoverVisibilityState = {
  visible: boolean;
};

// Result of the host's background check against the latest published release.
// `updateAvailable` is true only when a newer version than the running build was
// found; `latestVersion`/`releaseUrl` are null when the check has not succeeded
// yet (offline, rate limited, etc.) so the shell can fail silent.
export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
};

export type BabyMenuApi = {
  recipes: {
    list: () => Promise<RecipeMetadata[]>;
  };
  git: {
    save: (message?: string) => Promise<GitActionResult>;
    rollback: () => Promise<GitActionResult>;
    // Snapshot of the outstanding agent change session, or null when none is open
    // OR a turn is still running. Lets the renderer re-hydrate a pending
    // Keep/Rollback prompt after a reload, since that prompt is otherwise ephemeral
    // renderer state. Returns null mid-turn so the prompt never appears before the
    // build finishes; pair with agent.getActiveTurn to restore the run strip.
    status: () => Promise<GitSessionSnapshot | null>;
  };
  agent: {
    send: (prompt: string) => Promise<AgentChatResult>;
    onStatus: (listener: (status: AgentRuntimeStatus) => void) => () => void;
    // The turn currently running in the main process, or null. Lets the renderer
    // restore the in-progress run strip after the popover view is remounted (e.g.
    // returning from Settings) instead of losing it or showing a premature prompt.
    getActiveTurn: () => Promise<AgentActiveTurn | null>;
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
  // Host-only: the agent-authored root layout module, or null when the workspace
  // has no `layout.tsx` (the renderer then uses the built-in column). Not part of
  // BabyMenuExtensionApi - extensions author the layout, they do not load it.
  layout: {
    get: () => Promise<BabyMenuLayoutModuleDescriptor | null>;
  };
  background: {
    // Fires when an extension's background task finishes a run, so an open widget
    // can re-read its data. Nothing arrives while the task runs with the popover
    // closed - the widget just reads warm data the next time it opens.
    onUpdate: (listener: (event: BackgroundTaskUpdate) => void) => () => void;
  };
  popover: {
    setContentHeight: (height: number) => Promise<{ ok: boolean }>;
    // Reports the desired popover size so both width and height adapt to the
    // layout content. The main process clamps to a usable range and the screen
    // work area, then repositions. `setContentHeight` is retained for older
    // callers; new code should use this.
    setContentSize: (size: { width: number; height: number }) => Promise<{ ok: boolean }>;
    getVisibility: () => Promise<PopoverVisibilityState>;
    onVisibility: (listener: (state: PopoverVisibilityState) => void) => () => void;
  };
  settings: {
    get: () => Promise<BabyMenuSettings>;
    setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuSettings>;
    /** Switches the embedded agent; callers should confirm because this resets the current conversation. */
    setAgent: (agentName: string) => Promise<BabyMenuSettings>;
    /** Adds a custom ACP agent. Rejects with an Error(message) on invalid input. */
    addAgent: (input: BabyMenuCustomAgentInput) => Promise<BabyMenuSettings>;
    /** Updates an existing custom agent's label/command (the name/id is immutable). */
    updateAgent: (name: string, input: { label?: string; command: string }) => Promise<BabyMenuSettings>;
    /** Removes a custom agent. Rejects if the agent is currently active. */
    removeAgent: (name: string) => Promise<BabyMenuSettings>;
  };
  app: {
    /** Fully quits the Electron app from the popover shell. */
    quit: () => Promise<{ ok: boolean }>;
    /** Current update status from the host's cached background release check. */
    getUpdateStatus: () => Promise<UpdateStatus>;
    /** Opens the latest release page in the user's default browser. */
    openReleasePage: () => Promise<{ ok: boolean }>;
  };
};

// The slice of the window.babyMenu bridge that extension widgets are meant to
// use: invoking server actions, reading the shared store, reacting to background
// runs, and the popover visibility signal. Host-only surfaces (git, agent,
// settings, app, recipes, widgets) are deliberately excluded. This is the value
// side of the `@babymenu/contracts` public surface; see extensions/babymenu-env.d.ts.
//
// Written out explicitly (not Pick<BabyMenuApi, ...>) so the codegen in
// scripts/generate-extension-dts.mjs can copy it verbatim into the shipped
// declaration file. A type test in tests/extension-contract-surface.test.ts
// asserts it stays structurally equal to the matching BabyMenuApi members, so
// the explicit copy and BabyMenuApi cannot silently drift apart.
export type BabyMenuExtensionApi = {
  capabilities: {
    list: () => Promise<BabyMenuCapabilityDescriptor[]>;
    invoke: <T = unknown>(extensionId: string, action: string, input?: unknown) => Promise<T>;
  };
  db: {
    query: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => Promise<T[]>;
    get: <T = Record<string, unknown>>(sql: string, params?: SqlParams) => Promise<T | undefined>;
    run: (sql: string, params?: SqlParams) => Promise<SqlRunResult>;
    exec: (sql: string) => Promise<void>;
  };
  background: {
    onUpdate: (listener: (event: BackgroundTaskUpdate) => void) => () => void;
  };
  popover: {
    setContentHeight: (height: number) => Promise<{ ok: boolean }>;
    setContentSize: (size: { width: number; height: number }) => Promise<{ ok: boolean }>;
    getVisibility: () => Promise<PopoverVisibilityState>;
    onVisibility: (listener: (state: PopoverVisibilityState) => void) => () => void;
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
