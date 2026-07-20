import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTaskScheduler } from "../src/main/background-task-scheduler";
import { createExtensionDatabase } from "../src/main/extension-database";
import { createBackgroundTaskSource, createServerActionRegistry } from "../src/main/server-action-registry";
import type { BabyMenuApi, BabyMenuKimiQuotaBroker, KimiQuotaResult } from "../src/shared/contracts";

const repoRoot = join(__dirname, "..");
const extensionDir = join(repoRoot, "extensions", "kimi-code-quota");
const tempDirs: string[] = [];

const normalized: KimiQuotaResult = {
  status: "fresh",
  stale: false,
  source: "api",
  credentialSource: "pi-kimi-coding",
  checkedAt: "2026-07-19T12:00:00.000Z",
  snapshot: {
    provider: "kimi",
    label: "Kimi",
    source: "api",
    credentialSource: "pi-kimi-coding",
    refreshedAt: "2026-07-19T12:00:00.000Z",
    windows: [{ id: "weekly", label: "week", kind: "weekly", percentUsed: 33, percentRemaining: 67 }],
  },
};

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function cacheDir() {
  const dir = await mkdtemp(join(tmpdir(), "baby-menu-kimi-extension-"));
  tempDirs.push(dir);
  return dir;
}

describe("Kimi Code quota extension host integration", () => {
  it("projects only the normalized broker result through its server capability", async () => {
    const db = createExtensionDatabase(":memory:");
    const acquire = vi.fn(async () => normalized);
    const readCached = vi.fn(() => normalized);
    const registry = createServerActionRegistry({
      rootDir: repoRoot,
      actionRoots: [extensionDir],
      cacheDir: await cacheDir(),
      db,
      kimiQuota: { acquire, readCached } satisfies BabyMenuKimiQuotaBroker,
    });

    const result = await registry.invoke("kimi-code-quota", "getQuota");

    expect(acquire).toHaveBeenCalledWith({ maxAgeMs: 60_000 });
    expect(result).toEqual(normalized);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/access_token|refresh_token|authorization|bearer|raw|account|plan|fingerprint/i);
    db.close();
  });

  it("reads a completed background result without starting another acquisition", async () => {
    const db = createExtensionDatabase(":memory:");
    const acquire = vi.fn(async () => normalized);
    const readCached = vi.fn(() => normalized);
    const registry = createServerActionRegistry({
      rootDir: repoRoot,
      actionRoots: [extensionDir],
      cacheDir: await cacheDir(),
      db,
      kimiQuota: { acquire, readCached },
    });

    await expect(registry.invoke("kimi-code-quota", "getCachedQuota")).resolves.toEqual(normalized);
    expect(readCached).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    db.close();
  });

  it("declares a five-minute run-on-start host background task", async () => {
    const source = createBackgroundTaskSource({
      rootDir: repoRoot,
      actionRoots: [extensionDir],
      cacheDir: await cacheDir(),
    });
    const tasks = await source.list();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ extensionId: "kimi-code-quota", intervalMs: 300_000, runOnStart: true });
  });

  it("uses the host scheduler for startup and cadence without a private timer", async () => {
    vi.useFakeTimers();
    const acquire = vi.fn(async () => normalized);
    const db = createExtensionDatabase(":memory:");
    const scheduler = createBackgroundTaskScheduler({
      source: createBackgroundTaskSource({
        rootDir: repoRoot,
        actionRoots: [extensionDir],
        cacheDir: await cacheDir(),
      }),
      context: {
        rootDir: repoRoot,
        db,
        notify: vi.fn(),
        kimiQuota: { acquire, readCached: vi.fn(() => normalized) },
      },
    });

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(acquire).toHaveBeenCalledWith({ force: true });
    expect(acquire).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(acquire).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(acquire).toHaveBeenCalledTimes(2);

    scheduler.stop();
    db.close();
  });

  it("keeps renderer code on the capability bridge and contains no auth, network, database, or timer implementation", async () => {
    const [storeSource, componentsSource, widgetSource] = await Promise.all([
      readFile(join(extensionDir, "store.ts"), "utf8"),
      readFile(join(extensionDir, "components.tsx"), "utf8"),
      readFile(join(extensionDir, "widget.tsx"), "utf8"),
    ]);
    const rendererSource = `${storeSource}\n${componentsSource}\n${widgetSource}`;

    expect(rendererSource).toContain("capabilities.invoke");
    expect(rendererSource).not.toMatch(/KIMI_API_KEY|KIMI_CODE_HOME|kimi-code\.json|auth\.json|access_token|refresh_token|Authorization|Bearer|api\.kimi\.com|\bfetch\s*\(|\.db\.|setInterval|setTimeout|child_process|spawn\s*\(/);
  });

  it("coalesces renderer capability calls and re-reads after a host background update", async () => {
    const { createKimiQuotaViewStore } = await import("../extensions/kimi-code-quota/store");
    let release: ((result: KimiQuotaResult) => void) | undefined;
    const invoke = vi.fn(() => new Promise<KimiQuotaResult>((resolve) => (release = resolve)));
    let backgroundListener: ((event: { extensionId: string }) => void) | undefined;
    const api = {
      capabilities: { invoke },
      background: {
        onUpdate: vi.fn((listener) => {
          backgroundListener = listener;
          return () => {
            backgroundListener = undefined;
          };
        }),
      },
    } as unknown as BabyMenuApi;
    const store = createKimiQuotaViewStore(api);

    const first = store.refresh();
    const second = store.refresh();
    expect(invoke).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toEqual({ result: null, refreshing: true });
    release?.(normalized);
    await Promise.all([first, second]);
    expect(store.getSnapshot()).toEqual({ result: normalized, refreshing: false });
    expect(invoke).toHaveBeenCalledWith("kimi-code-quota", "getQuota");

    invoke.mockResolvedValue(normalized);
    const unsubscribe = store.connectBackground();
    backgroundListener?.({ extensionId: "another-extension" });
    expect(invoke).toHaveBeenCalledTimes(1);
    backgroundListener?.({ extensionId: "kimi-code-quota" });
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenLastCalledWith("kimi-code-quota", "getCachedQuota");
    unsubscribe();
  });
});
