// AUTO-GENERATED - DO NOT EDIT BY HAND.
// Generated from src/shared/contracts.ts by scripts/generate-extension-dts.mjs.
// Run `pnpm generate:contracts` after changing the extension-facing contract.
//
// This file makes `@babymenu/contracts` resolve inside the extension workspace,
// where the host source (src/shared/contracts.ts) is not present. Import the
// types you need from the stable specifier - never reach back into host paths
// like ../../src/shared/contracts, which do not exist in a packaged install:
//
//   import type { RefreshableBabyMenuWidget, BabyMenuServerContext } from "@babymenu/contracts";
//
// These are type-only imports: the host compiler erases them, so they add no
// runtime dependency and are always allowed. Importing a *value* from this
// specifier will be rejected - there is nothing to import at runtime.

declare module "@babymenu/contracts" {
  import type { ReactNode } from "react";

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
}

interface Window {
  babyMenu?: import("@babymenu/contracts").BabyMenuExtensionApi;
}
