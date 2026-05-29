import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileExtensionModule } from "../src/main/extension-module-compiler";

describe("extension module compiler", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("compiles TSX widgets with local helpers and host React shims", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "meter");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(join(extensionDir, "helper.ts"), `export const label: string = "CPU";\n`);
    await writeFile(
      join(extensionDir, "widget.tsx"),
      `import { useState } from "react";
      import { label } from "./helper";
      export const widget = { id: "meter", title: label, render: () => <span>{useState(1)[0]}</span> };`,
    );

    const compiled = await compileExtensionModule({
      kind: "widget",
      extensionId: "meter",
      extensionDir,
      entryFile: join(extensionDir, "widget.tsx"),
      cacheRoot: join(rootDir, "cache", "widgets"),
    });

    expect(compiled.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(compiled.outputPath).toBe(join(rootDir, "cache", "widgets", "meter", compiled.hash, "widget.mjs"));
    const output = await readFile(compiled.outputPath, "utf8");
    expect(output).toContain(`from "baby-menu-host://react/index.mjs"`);
    expect(output).toContain(`from "baby-menu-host://react-jsx-runtime/index.mjs"`);
    expect(output).toContain(`from "./helper.mjs"`);
    await expect(readFile(join(rootDir, "cache", "widgets", "meter", compiled.hash, "helper.mjs"), "utf8")).resolves.toContain(
      "CPU",
    );
  });

  it("ignores type-only imports when collecting widget dependencies", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "starter");
    const entryFile = join(extensionDir, "widget.tsx");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(
      entryFile,
      `import type { RefreshableBabyMenuWidget } from "@babymenu/contracts";
      export const widget: RefreshableBabyMenuWidget = { id: "starter", title: "Starter", render: () => "ok", refreshView: async () => undefined };`,
    );

    const compiled = await compileExtensionModule({
      kind: "widget",
      extensionId: "starter",
      extensionDir,
      entryFile,
      cacheRoot: join(rootDir, "cache", "widgets"),
    });

    // The stable contract specifier is type-only, so it is erased at compile time
    // and never reaches the runtime import allowlist.
    await expect(readFile(compiled.outputPath, "utf8")).resolves.not.toContain("@babymenu/contracts");
  });

  it("ignores inline type-only contract imports when collecting widget dependencies", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "inline-contract");
    const entryFile = join(extensionDir, "widget.tsx");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(
      entryFile,
      `import { type RefreshableBabyMenuWidget } from "@babymenu/contracts";
      export const widget: RefreshableBabyMenuWidget = { id: "inline-contract", title: "Inline", render: () => "ok", refreshView: async () => undefined };`,
    );

    const compiled = await compileExtensionModule({
      kind: "widget",
      extensionId: "inline-contract",
      extensionDir,
      entryFile,
      cacheRoot: join(rootDir, "cache", "widgets"),
    });

    await expect(readFile(compiled.outputPath, "utf8")).resolves.not.toContain("@babymenu/contracts");
  });

  it("reuses cached output for unchanged extension modules", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "cached");
    const entryFile = join(extensionDir, "widget.tsx");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(entryFile, `export const widget = { id: "cached", title: "Cached", render: () => null };\n`);

    const options = {
      kind: "widget" as const,
      extensionId: "cached",
      extensionDir,
      entryFile,
      cacheRoot: join(rootDir, "cache", "widgets"),
    };
    const first = await compileExtensionModule(options);
    const firstStat = await stat(first.outputPath);
    const second = await compileExtensionModule(options);
    const secondStat = await stat(second.outputPath);

    expect(second).toEqual(first);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("compiles TypeScript server actions with local imports into importable ESM", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "quota");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(join(extensionDir, "quota.ts"), `export function readQuota(): number { return 72; }\n`);
    await writeFile(
      join(extensionDir, "server.ts"),
      `import { readQuota } from "./quota";
      export const actions = { getQuota: () => ({ remaining: readQuota() }) };`,
    );

    const compiled = await compileExtensionModule({
      kind: "server",
      extensionId: "quota",
      extensionDir,
      entryFile: join(extensionDir, "server.ts"),
      cacheRoot: join(rootDir, "cache", "server-actions"),
    });
    const module = (await import(`${compiled.moduleUrl}?test=${Date.now()}`)) as { actions: { getQuota: () => unknown } };

    expect(module.actions.getQuota()).toEqual({ remaining: 72 });
    await expect(readFile(compiled.outputPath, "utf8")).resolves.toContain(`from "./quota.mjs"`);
  });

  it("rejects unsupported external imports with a clear error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "bad-widget");
    const entryFile = join(extensionDir, "widget.tsx");
    await mkdir(dirname(entryFile), { recursive: true });
    await writeFile(entryFile, `import thing from "lodash"; export const widget = thing;\n`);

    await expect(
      compileExtensionModule({
        kind: "widget",
        extensionId: "bad-widget",
        extensionDir,
        entryFile,
        cacheRoot: join(rootDir, "cache", "widgets"),
      }),
    ).rejects.toThrow("Unsupported widget import \"lodash\" in bad-widget/widget.tsx");
  });

  it("rejects local imports that escape the extension workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-compiler-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "unsafe");
    const entryFile = join(extensionDir, "server.ts");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(join(rootDir, "extensions", "shared.ts"), `export const secret = true;\n`);
    await writeFile(entryFile, `import { secret } from "../shared"; export const actions = { secret: () => secret };\n`);

    await expect(
      compileExtensionModule({
        kind: "server",
        extensionId: "unsafe",
        extensionDir,
        entryFile,
        cacheRoot: join(rootDir, "cache", "server-actions"),
      }),
    ).rejects.toThrow("Local import escapes extension workspace");
  });
});
