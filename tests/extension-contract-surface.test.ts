import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { generateExtensionDts } from "../scripts/generate-extension-dts.mjs";
import type { BabyMenuApi, BabyMenuExtensionApi } from "../src/shared/contracts";
import { EXTENSION_CONTRACT_NAMES } from "../src/shared/extension-contract-names";

// The `@babymenu/contracts` surface is a stability contract, exactly like
// `@babymenu/ui`: the canonical name list, the host's contracts.ts, and the
// declaration file shipped into the extension workspace must all agree, or an
// extension that imports a type will silently get `any` (or fail to resolve).
// The declaration file is generated from contracts.ts, so it cannot drift in
// body - these tests guard the inputs to that codegen and that it was re-run.

const repoRoot = join(__dirname, "..");
const declarationPath = join(repoRoot, "extensions", "babymenu-env.d.ts");
const contractsPath = join(repoRoot, "src", "shared", "contracts.ts");

describe("@babymenu/contracts public surface contract", () => {
  it("keeps extensions/babymenu-env.d.ts in sync with contracts.ts (run `pnpm generate:contracts`)", async () => {
    const contractsSource = await readFile(contractsPath, "utf8");
    const committed = await readFile(declarationPath, "utf8");
    const regenerated = generateExtensionDts(contractsSource, [...EXTENSION_CONTRACT_NAMES]);
    expect(committed).toBe(regenerated);
  });

  it("declares the extension window bridge globally", async () => {
    const declaration = await readFile(declarationPath, "utf8");

    expect(declaration).toContain("interface Window {");
    expect(declaration).toContain("babyMenu?: import(\"@babymenu/contracts\").BabyMenuExtensionApi;");
  });

  it("only names types that actually exist in contracts.ts", async () => {
    const contracts = await readFile(contractsPath, "utf8");
    const exported = new Set([...contracts.matchAll(/^export\s+type\s+([A-Za-z0-9_]+)/gm)].map((m) => m[1]));
    const missing = EXTENSION_CONTRACT_NAMES.filter((name) => !exported.has(name));
    expect(missing).toEqual([]);
  });

  it("keeps the explicit BabyMenuExtensionApi equal to the BabyMenuApi subset", () => {
    // BabyMenuExtensionApi is written out explicitly so the codegen can copy it
    // verbatim; this asserts it still matches the real bridge in BabyMenuApi, so
    // the two definitions cannot silently diverge.
    expectTypeOf<BabyMenuExtensionApi>().toEqualTypeOf<
      Pick<BabyMenuApi, "capabilities" | "db" | "background" | "popover">
    >();
  });

  it("ships a starter widget that imports the stable specifier, not a relative host path", async () => {
    // The agent copies the starter's import style. A relative import back into
    // host source (../../src/shared/contracts) resolves in source mode but points
    // at nothing in a packaged install - exactly the footgun that sent the agent
    // scanning the home directory. The starter must model the workspace-stable form.
    const starter = await readFile(join(repoRoot, "extensions", "hello-world", "widget.tsx"), "utf8");
    expect(starter).toMatch(/from\s+["']@babymenu\/contracts["']/);
    expect(starter).not.toMatch(/from\s+["'][^"']*src\/shared\/contracts["']/);
  });

  it("keeps source extension contract imports within the generated public surface", async () => {
    const extensionRoot = join(repoRoot, "extensions");
    const extensionDirs = await readdir(extensionRoot, { withFileTypes: true });
    const importedNames = new Set<string>();

    for (const entry of extensionDirs) {
      if (!entry.isDirectory()) continue;

      for (const file of await readdir(join(extensionRoot, entry.name), { withFileTypes: true })) {
        if (!file.isFile() || !/\.[cm]?[tj]sx?$/.test(file.name)) continue;

        const source = await readFile(join(extensionRoot, entry.name, file.name), "utf8");
        for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']@babymenu\/contracts["']/g)) {
          for (const specifier of match[1].split(",")) {
            const name = specifier.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+|\s+/)[0];
            if (name) importedNames.add(name);
          }
        }
      }
    }

    const publicNames = new Set<string>(EXTENSION_CONTRACT_NAMES);
    const nonPublicImports = [...importedNames].filter((name) => !publicNames.has(name));
    expect(nonPublicImports).toEqual([]);
  });
});
