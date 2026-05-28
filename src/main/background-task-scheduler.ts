import { watch, type FSWatcher } from "node:fs";
import type { BabyMenuServerContext } from "../shared/contracts";
import type { BackgroundTaskSource, DiscoveredBackgroundTask } from "./server-action-registry";

// Background work runs whether or not the popover is open and keeps the machine awake
// on its cadence, so the framework enforces a hard floor. Tray data does not need to
// be fresher than this; extensions should usually ask for much longer.
export const MIN_BACKGROUND_INTERVAL_MS = 60_000;

const DEFAULT_WATCH_DEBOUNCE_MS = 300;

export type BackgroundTaskScheduler = {
  start: () => Promise<void>;
  resync: () => Promise<void>;
  stop: () => void;
};

export type BackgroundTaskSchedulerOptions = {
  source: BackgroundTaskSource;
  context: BabyMenuServerContext;
  // Directory to watch so newly added or edited tasks are picked up without a restart.
  watchDir?: string;
  minIntervalMs?: number;
  watchDebounceMs?: number;
  onTaskRun?: (extensionId: string) => void;
  onError?: (extensionId: string, error: unknown) => void;
};

type ScheduledTask = {
  extensionId: string;
  intervalMs: number; // effective cadence after clamping
  run: DiscoveredBackgroundTask["run"];
  running: boolean;
  timer: ReturnType<typeof setInterval>;
};

export function createBackgroundTaskScheduler(options: BackgroundTaskSchedulerOptions): BackgroundTaskScheduler {
  const minIntervalMs = options.minIntervalMs ?? MIN_BACKGROUND_INTERVAL_MS;
  const debounceMs = options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS;
  const onError = options.onError ?? defaultOnError;
  const scheduled = new Map<string, ScheduledTask>();

  let watcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const effectiveInterval = (intervalMs: number): number => Math.max(intervalMs, minIntervalMs);

  // The in-flight guard is what keeps a slow task from stacking up: if the previous run
  // has not finished, this tick is skipped rather than running concurrently.
  const tick = async (task: ScheduledTask): Promise<void> => {
    if (task.running) return;
    task.running = true;
    try {
      await task.run(options.context);
      options.onTaskRun?.(task.extensionId);
    } catch (error) {
      onError(task.extensionId, error);
    } finally {
      task.running = false;
    }
  };

  const schedule = (discovered: DiscoveredBackgroundTask): void => {
    const intervalMs = effectiveInterval(discovered.intervalMs);
    const task: ScheduledTask = {
      extensionId: discovered.extensionId,
      intervalMs,
      run: discovered.run,
      running: false,
      timer: setInterval(() => undefined, intervalMs),
    };
    clearInterval(task.timer);
    task.timer = setInterval(() => void tick(task), intervalMs);
    task.timer.unref?.();
    scheduled.set(task.extensionId, task);
    if (discovered.runOnStart) void tick(task);
  };

  const resync = async (): Promise<void> => {
    if (disposed) return;
    const discovered = await options.source.list();
    const byId = new Map(discovered.map((task) => [task.extensionId, task]));

    for (const [extensionId, task] of [...scheduled]) {
      if (byId.has(extensionId)) continue;
      clearInterval(task.timer);
      scheduled.delete(extensionId);
    }

    for (const discoveredTask of discovered) {
      const existing = scheduled.get(discoveredTask.extensionId);
      if (!existing) {
        schedule(discoveredTask);
        continue;
      }
      // Pick up code edits to the run function without resetting the timer.
      existing.run = discoveredTask.run;
      const nextInterval = effectiveInterval(discoveredTask.intervalMs);
      if (nextInterval !== existing.intervalMs) {
        clearInterval(existing.timer);
        existing.intervalMs = nextInterval;
        existing.timer = setInterval(() => void tick(existing), nextInterval);
        existing.timer.unref?.();
      }
    }
  };

  const scheduleDebouncedResync = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void resync();
    }, debounceMs);
    debounceTimer.unref?.();
  };

  return {
    async start() {
      disposed = false;
      await resync();
      if (!options.watchDir) return;
      try {
        watcher = watch(options.watchDir, { recursive: true }, () => scheduleDebouncedResync());
      } catch {
        // A missing or unwatchable directory is not fatal; tasks discovered at start
        // still run, they just will not hot-reload until the next start.
        watcher = null;
      }
    },
    resync,
    stop() {
      disposed = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      watcher?.close();
      watcher = null;
      for (const task of scheduled.values()) clearInterval(task.timer);
      scheduled.clear();
    },
  };
}

function defaultOnError(extensionId: string, error: unknown): void {
  console.error(`[baby-menu] background task "${extensionId}" failed`, error);
}
