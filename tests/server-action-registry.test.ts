import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServerActionRegistry, rewriteLocalServerActionImports } from "../src/main/server-action-registry";

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

  it("throws a clear error for unknown server actions", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-actions-"));
    tempDirs.push(rootDir);
    const registry = createServerActionRegistry({ rootDir });

    await expect(registry.invoke("missing", "action")).rejects.toThrow("Unknown server action: missing.action");
  });
});
