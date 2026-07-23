import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extensionsDir = resolve(import.meta.dirname, "../extensions");

// This is the product's deliberately small, provider-neutral default inventory.
// User-installed extensions remain unrestricted and are discovered at runtime.
const NEUTRAL_BUNDLED_EXTENSION_IDS = ["hello-world"] as const;
const EXPECTED_EXTENSION_RESOURCE = `  - from: extensions
    to: extensions-template
    filter:
      - AGENTS.md
      - babymenu-env.d.ts
      - recipes/**
      - hello-world/**
`;

async function sourceExtensionIds(): Promise<string[]> {
  const entries = await readdir(extensionsDir, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "recipes") continue;
    const files = await readdir(resolve(extensionsDir, entry.name));
    if (files.some((file) => file === "widget.tsx" || file === "server.ts")) ids.push(entry.name);
  }
  return ids.sort();
}

describe("default extension inventory", () => {
  it("contains only the reviewed provider-neutral bundled extensions", async () => {
    expect(await sourceExtensionIds()).toEqual([...NEUTRAL_BUNDLED_EXTENSION_IDS]);
  });

  it("packages exactly the reviewed provider-neutral extension inventory", async () => {
    const config = await readFile(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8");
    const extensionResources = [
      ...config.matchAll(/^  - from: extensions\n(?:(?!^  - from: )[\s\S])*/gm),
    ].map((match) => match[0]);

    expect(extensionResources).toEqual([EXPECTED_EXTENSION_RESOURCE]);
  });
});
