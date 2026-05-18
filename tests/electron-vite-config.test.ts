import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function asExternalList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

describe("electron-vite config", () => {
  it("keeps Electron external in main and preload bundles", async () => {
    vi.stubGlobal("__dirname", rootDir);

    const { default: config } = await import("../electron.vite.config");

    expect(asExternalList(config.main?.build?.rollupOptions?.external)).toContain("electron");
    expect(asExternalList(config.preload?.build?.rollupOptions?.external)).toContain("electron");
  });

  it("builds the preload bridge as a CommonJS file for Electron", async () => {
    vi.stubGlobal("__dirname", rootDir);

    const { default: config } = await import("../electron.vite.config");
    const output = config.preload?.build?.rollupOptions?.output;

    expect(output).toMatchObject({
      format: "cjs",
      entryFileNames: "[name].cjs",
    });
  });

  it("allows renderer imports from the repo-level extensions directory", async () => {
    vi.stubGlobal("__dirname", rootDir);

    const { default: config } = await import("../electron.vite.config");

    expect(config.renderer?.server?.fs?.allow).toContain(rootDir);
  });

  it("writes the production renderer bundle inside the repo-level out directory", async () => {
    vi.stubGlobal("__dirname", rootDir);

    const { default: config } = await import("../electron.vite.config");

    expect(resolve(rootDir, "src/renderer", config.renderer?.build?.outDir ?? "")).toBe(
      resolve(rootDir, "out/renderer"),
    );
  });
});
