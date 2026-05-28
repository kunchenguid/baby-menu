import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackgroundTaskSource, createServerActionRegistry, rewriteLocalServerActionImports } from "../src/main/server-action-registry";

describe("server action registry", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("loads extension-owned server actions and invokes them through an extension/action id", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "demo", "server.mjs");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(
      actionPath,
      `export const actions = {
        ping: async (input, context) => ({ input, rootDir: context.rootDir })
      };`,
    );
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.list()).resolves.toContainEqual({
      id: "demo.ping",
      extensionId: "demo",
      action: "ping",
    });
    await expect(registry.invoke("demo", "ping", { ok: true })).resolves.toEqual({
      input: { ok: true },
      rootDir,
    });
  });

  it("reloads changed server action modules without recreating the registry", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "demo", "server.mjs");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(actionPath, `export const actions = { ping: () => "first" };`);
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.invoke("demo", "ping")).resolves.toBe("first");

    await writeFile(actionPath, `export const actions = { ping: () => "second" };`);

    await expect(registry.invoke("demo", "ping")).resolves.toBe("second");
  });

  it("loads TypeScript extension server action files that agents are expected to create", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "typed", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(
      actionPath,
      `export const actions = {
        greet: (input: { name: string }) => ({ message: \`hello \${input.name}\` })
      };`,
    );
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.invoke("typed", "greet", { name: "Ada" })).resolves.toEqual({
      message: "hello Ada",
    });
  });

  it("loads server actions with extensionless local TypeScript imports", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "codex-quota", "server.ts");
    const helperPath = join(rootDir, "extensions", "codex-quota", "codex-quota.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(helperPath, `export function readQuota() { return { remaining: 72 }; }`);
    await writeFile(
      actionPath,
      `import { readQuota } from "./codex-quota";
      export const actions = { getQuota: () => readQuota() };`,
    );
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.invoke("codex-quota", "getQuota")).resolves.toEqual({ remaining: 72 });
  });

  it("rejects unsupported external imports from generated server actions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "external", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(actionPath, `import slugify from "slugify"; export const actions = { slugify };`);
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.list()).rejects.toThrow('Unsupported server import "slugify" in external/server.ts');
  });

  it("rewrites extensionless local imports so Node ESM can load server actions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const sourcePath = join(rootDir, "extensions", "codex-quota", "server.ts");
    const helperPath = join(rootDir, "extensions", "codex-quota", "codex-quota.ts");
    await mkdir(dirname(sourcePath), { recursive: true });
    await writeFile(helperPath, `export const value = 1;`);

    const rewritten = await rewriteLocalServerActionImports(
      `import { value } from "./codex-quota";
      export { value } from "./codex-quota";
      import untouched from "react";`,
      sourcePath,
    );

    expect(rewritten).toContain(`from "./codex-quota.mjs"`);
    expect(rewritten).toContain(`from "react"`);
  });

  it("discovers background tasks exported from extension server modules", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-bg-"));
    tempDirs.push(rootDir);
    const withTask = join(rootDir, "extensions", "pulse", "server.ts");
    const withoutTask = join(rootDir, "extensions", "plain", "server.ts");
    await mkdir(dirname(withTask), { recursive: true });
    await mkdir(dirname(withoutTask), { recursive: true });
    await writeFile(
      withTask,
      `export const background = { intervalMs: 90000, runOnStart: false, run: async () => undefined };`,
    );
    await writeFile(withoutTask, `export const actions = { ping: () => "ok" };`);

    const source = createBackgroundTaskSource({ rootDir });
    const tasks = await source.list();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ extensionId: "pulse", intervalMs: 90000, runOnStart: false });
    expect(tasks[0]?.run).toBeTypeOf("function");
  });

  it("keeps discovering valid background tasks when one server module fails to load", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-bg-"));
    tempDirs.push(rootDir);
    const validTask = join(rootDir, "extensions", "pulse", "server.ts");
    const brokenTask = join(rootDir, "extensions", "broken", "server.ts");
    await mkdir(dirname(validTask), { recursive: true });
    await mkdir(dirname(brokenTask), { recursive: true });
    await writeFile(validTask, `export const background = { intervalMs: 90000, run: async () => undefined };`);
    await writeFile(brokenTask, `import slugify from "slugify"; export const background = { intervalMs: 90000, run: slugify };`);

    const onError = vi.fn();
    const source = createBackgroundTaskSource({ rootDir, onError });

    await expect(source.list()).resolves.toMatchObject([{ extensionId: "pulse", intervalMs: 90000 }]);
    expect(onError).toHaveBeenCalledWith("broken", expect.any(Error));
  });

  it("ignores background exports with a missing or invalid interval", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-bg-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "broken", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(actionPath, `export const background = { run: async () => undefined };`);

    const source = createBackgroundTaskSource({ rootDir });

    await expect(source.list()).resolves.toEqual([]);
  });

  it("runs a discovered background task that persists to the shared database", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-bg-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "counter", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(
      actionPath,
      `export const background = {
        intervalMs: 90000,
        run: (ctx) => {
          ctx.db.exec("CREATE TABLE IF NOT EXISTS counter_ticks (id INTEGER PRIMARY KEY)");
          ctx.db.run("INSERT INTO counter_ticks DEFAULT VALUES");
        },
      };`,
    );

    const { createExtensionDatabase } = await import("../src/main/extension-database");
    const { createBackgroundTaskScheduler } = await import("../src/main/background-task-scheduler");
    const db = createExtensionDatabase(":memory:");
    const scheduler = createBackgroundTaskScheduler({
      source: createBackgroundTaskSource({ rootDir }),
      context: { rootDir, db, notify: () => undefined },
      minIntervalMs: 10,
    });

    await scheduler.start(); // runOnStart defaults true
    await vi.waitFor(() => expect(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM counter_ticks")?.c).toBe(1));
    scheduler.stop();
    db.close();
  });

  it("passes a notify capability to background tasks", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-bg-"));
    tempDirs.push(rootDir);
    const actionPath = join(rootDir, "extensions", "alert", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeFile(
      actionPath,
      `export const background = { intervalMs: 90000, run: (ctx) => ctx.notify({ title: "hi", body: "there" }) };`,
    );

    const { createExtensionDatabase } = await import("../src/main/extension-database");
    const { createBackgroundTaskScheduler } = await import("../src/main/background-task-scheduler");
    const notify = vi.fn();
    const scheduler = createBackgroundTaskScheduler({
      source: createBackgroundTaskSource({ rootDir }),
      context: { rootDir, db: createExtensionDatabase(":memory:"), notify },
      minIntervalMs: 10,
    });

    await scheduler.start();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith({ title: "hi", body: "there" }));
    scheduler.stop();
  });

  it("throws a clear error for unknown server actions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.invoke("missing", "action")).rejects.toThrow("Unknown server action: missing.action");
  });
});
