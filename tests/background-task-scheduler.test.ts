import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BabyMenuServerContext } from "../src/shared/contracts";
import {
  createBackgroundTaskScheduler,
  type BackgroundTaskSchedulerOptions,
} from "../src/main/background-task-scheduler";
import type { BackgroundTaskSource, DiscoveredBackgroundTask } from "../src/main/server-action-registry";

const context: BabyMenuServerContext = { rootDir: "/repo", db: {} as BabyMenuServerContext["db"], notify: vi.fn() };

function sourceOf(tasks: DiscoveredBackgroundTask[]): BackgroundTaskSource & { tasks: DiscoveredBackgroundTask[] } {
  const state = { tasks };
  return {
    tasks: state.tasks,
    list: vi.fn(async () => state.tasks),
  } as unknown as BackgroundTaskSource & { tasks: DiscoveredBackgroundTask[] };
}

function task(overrides: Partial<DiscoveredBackgroundTask>): DiscoveredBackgroundTask {
  return {
    extensionId: "demo",
    sourceFile: "/repo/extensions/demo/server.ts",
    intervalMs: 10,
    runOnStart: true,
    run: vi.fn(),
    ...overrides,
  };
}

function makeScheduler(options: Partial<BackgroundTaskSchedulerOptions> & { source: BackgroundTaskSource }) {
  return createBackgroundTaskScheduler({ context, minIntervalMs: 10, ...options });
}

describe("background task scheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs a task on start and then on its interval", async () => {
    const run = vi.fn();
    const scheduler = makeScheduler({ source: sourceOf([task({ run, intervalMs: 10, runOnStart: true })]) });

    await scheduler.start();
    expect(run).toHaveBeenCalledTimes(1); // runOnStart

    await vi.advanceTimersByTimeAsync(25);
    expect(run).toHaveBeenCalledTimes(3); // ticks at 10 and 20

    scheduler.stop();
  });

  it("clamps intervals below the 60s floor by default", async () => {
    const run = vi.fn();
    const scheduler = createBackgroundTaskScheduler({
      context,
      source: sourceOf([task({ run, intervalMs: 1000, runOnStart: false })]),
    });

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(0); // 1s requested, but floor is 60s

    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("skips overlapping runs while one is still in flight", async () => {
    let release: (() => void) | undefined;
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const scheduler = makeScheduler({ source: sourceOf([task({ run, intervalMs: 10, runOnStart: true })]) });

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(35); // several ticks, but the first run never resolved
    expect(run).toHaveBeenCalledTimes(1);

    release?.();
    scheduler.stop();
  });

  it("keeps running after a task throws", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = makeScheduler({ source: sourceOf([task({ run, intervalMs: 10, runOnStart: true })]), onError });

    await scheduler.start();
    expect(onError).toHaveBeenCalledWith("demo", expect.any(Error));

    await vi.advanceTimersByTimeAsync(15);
    expect(run).toHaveBeenCalledTimes(2); // recovered on the next tick

    scheduler.stop();
  });

  it("emits onTaskRun after each successful run", async () => {
    const onTaskRun = vi.fn();
    const scheduler = makeScheduler({
      source: sourceOf([task({ extensionId: "cpu", run: vi.fn(), intervalMs: 10, runOnStart: true })]),
      onTaskRun,
    });

    await scheduler.start();
    expect(onTaskRun).toHaveBeenCalledWith("cpu");

    scheduler.stop();
  });

  it("starts new tasks, stops removed tasks, and updates run on resync", async () => {
    const runA = vi.fn();
    const source = sourceOf([task({ extensionId: "a", run: runA, intervalMs: 10, runOnStart: false })]);
    const scheduler = makeScheduler({ source });

    await scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(runA).toHaveBeenCalledTimes(1);

    // Replace task "a" with "b" (a removed, b added).
    const runB = vi.fn();
    source.tasks.splice(0, source.tasks.length, task({ extensionId: "b", run: runB, intervalMs: 10, runOnStart: true }));
    await scheduler.resync();
    expect(runB).toHaveBeenCalledTimes(1); // runOnStart on the newly added task

    await vi.advanceTimersByTimeAsync(20);
    expect(runA).toHaveBeenCalledTimes(1); // "a" stopped, no more ticks

    scheduler.stop();
  });

  it("picks up an edited run function without resetting the timer", async () => {
    const runV1 = vi.fn();
    const source = sourceOf([task({ extensionId: "a", run: runV1, intervalMs: 10, runOnStart: false })]);
    const scheduler = makeScheduler({ source });

    await scheduler.start();
    const runV2 = vi.fn();
    source.tasks.splice(0, source.tasks.length, task({ extensionId: "a", run: runV2, intervalMs: 10, runOnStart: false }));
    await scheduler.resync();

    await vi.advanceTimersByTimeAsync(10);
    expect(runV1).toHaveBeenCalledTimes(0);
    expect(runV2).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });
});
