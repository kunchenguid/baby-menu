import { useEffect, useSyncExternalStore } from "react";
import type { BabyMenuExtensionApi, KimiQuotaResult } from "@babymenu/contracts";

const EXTENSION_ID = "kimi-code-quota";

type KimiQuotaViewState = {
  result: KimiQuotaResult | null;
  refreshing: boolean;
};

type KimiQuotaViewStore = {
  getSnapshot: () => KimiQuotaViewState;
  subscribe: (listener: () => void) => () => void;
  refresh: () => Promise<void>;
  connectBackground: () => () => void;
};

type QuotaAction = "getQuota" | "getCachedQuota";

export function createKimiQuotaViewStore(api?: BabyMenuExtensionApi): KimiQuotaViewStore {
  let state: KimiQuotaViewState = { result: null, refreshing: false };
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const getApi = (): BabyMenuExtensionApi | undefined => api ?? globalThis.window?.babyMenu;

  const publish = (next: KimiQuotaViewState): void => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const load = (action: QuotaAction): Promise<void> => {
    if (inFlight) return inFlight;
    publish({ ...state, refreshing: true });
    inFlight = (async () => {
      const bridge = getApi();
      if (!bridge) {
        publish({ result: bridgeUnavailable(), refreshing: false });
        return;
      }
      try {
        const result = await bridge.capabilities.invoke<KimiQuotaResult>(EXTENSION_ID, action);
        publish({ result, refreshing: false });
      } catch {
        publish({ result: bridgeUnavailable(), refreshing: false });
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const refresh = (): Promise<void> => load("getQuota");

  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    connectBackground() {
      return getApi()?.background.onUpdate((event) => {
        if (event.extensionId === EXTENSION_ID) void load("getCachedQuota");
      }) ?? (() => undefined);
    },
  };
}

const defaultStore = createKimiQuotaViewStore();

export function useKimiQuotaView(): KimiQuotaViewState {
  const state = useSyncExternalStore(defaultStore.subscribe, defaultStore.getSnapshot, defaultStore.getSnapshot);
  useEffect(() => defaultStore.connectBackground(), []);
  return state;
}

export function refreshKimiQuotaView(): Promise<void> {
  return defaultStore.refresh();
}

function bridgeUnavailable(): KimiQuotaResult {
  return {
    status: "error",
    stale: false,
    source: "api",
    checkedAt: new Date().toISOString(),
    error: {
      code: "network_unavailable",
      category: "transport",
      message: "Kimi quota bridge is unavailable",
    },
  };
}

export type { KimiQuotaViewState };
