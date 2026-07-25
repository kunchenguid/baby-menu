import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

describe("packaged acpx runtime dependency boundary", () => {
  it("keeps Baby Menu on the acpx runtime entry, which cannot reach tsx or the CLI chunk", async () => {
    const packagePath = resolve(repoRoot, "node_modules/acpx/package.json");
    const packageRoot = dirname(packagePath);
    const packageJson = await readJson(packagePath);
    const exports = packageJson.exports as Record<string, string>;
    const runtimeEntry = exports["./runtime"];
    const cliEntry = exports["."];

    expect(runtimeEntry).toBe("./dist/runtime.js");
    expect(cliEntry).toBe("./dist/cli.js");

    const [runtimeSource, cliSource, babyMenuRuntimeSource] = await Promise.all([
      readFile(resolve(packageRoot, runtimeEntry), "utf8"),
      readFile(resolve(packageRoot, cliEntry), "utf8"),
      readFile(resolve(repoRoot, "src/main/agent-runtime.ts"), "utf8"),
    ]);
    const cliChunks = [...cliSource.matchAll(/["']\.\/(cli-[^"']+\.js)["']/g)]
      .map((match) => match[1]);

    expect(cliChunks.length).toBeGreaterThan(0);
    expect(babyMenuRuntimeSource).toContain('from "acpx/runtime"');
    expect(babyMenuRuntimeSource).not.toMatch(/from ["']acpx["']/);
    expect(runtimeSource).not.toMatch(/["']tsx(?:\/[^"']*)?["']/);
    for (const cliChunk of cliChunks) {
      expect(runtimeSource).not.toContain(cliChunk);
    }
  });
});
