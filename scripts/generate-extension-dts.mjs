// Generates extensions/babymenu-env.d.ts from src/shared/contracts.ts.
//
// Extensions cannot see the host source (it lives inside the app bundle, not in
// the extension workspace), so the host ships the extension-facing contract
// types into the workspace as the `@babymenu/contracts` virtual module. This
// script copies the declarations named in src/shared/extension-contract-names.ts
// verbatim out of contracts.ts and wraps them in a `declare module` block, so the
// shipped types can never drift from the host's real types.
//
// Run `pnpm generate:contracts` after changing the extension-facing contract.
// tests/extension-contract-surface.test.ts fails if the committed file is stale.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const PREAMBLE = `// AUTO-GENERATED - DO NOT EDIT BY HAND.
// Generated from src/shared/contracts.ts by scripts/generate-extension-dts.mjs.
// Run \`pnpm generate:contracts\` after changing the extension-facing contract.
//
// This file makes \`@babymenu/contracts\` resolve inside the extension workspace,
// where the host source (src/shared/contracts.ts) is not present. Import the
// types you need from the stable specifier - never reach back into host paths
// like ../../src/shared/contracts, which do not exist in a packaged install:
//
//   import type { RefreshableBabyMenuWidget, BabyMenuServerContext } from "@babymenu/contracts";
//
// These are type-only imports: the host compiler erases them, so they add no
// runtime dependency and are always allowed. Importing a *value* from this
// specifier will be rejected - there is nothing to import at runtime.
`;

/**
 * Build the babymenu-env.d.ts contents from the contracts.ts source text and the
 * list of extension-facing type names. Pure: same inputs -> identical output.
 */
export function generateExtensionDts(contractsSource, contractNames) {
  const sourceFile = ts.createSourceFile("contracts.ts", contractsSource, ts.ScriptTarget.Latest, true);
  const wanted = new Set(contractNames);
  const byName = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && wanted.has(statement.name.text)) {
      byName.set(statement.name.text, declarationText(statement, sourceFile));
    }
  }
  const missing = contractNames.filter((name) => !byName.has(name));
  if (missing.length > 0) {
    throw new Error(`Names in EXTENSION_CONTRACT_NAMES missing from contracts.ts: ${missing.join(", ")}`);
  }
  // Emit in contracts.ts source order (Map preserves insertion order).
  const body = [...byName.values()].map(indentBlock).join("\n\n");
  return `${PREAMBLE}\ndeclare module "@babymenu/contracts" {\n  import type { ReactNode } from "react";\n\n${body}\n}\n\ninterface Window {\n  babyMenu?: import("@babymenu/contracts").BabyMenuExtensionApi;\n}\n`;
}

// The verbatim source text of a declaration including its leading JSDoc comment,
// with the blank lines before the comment trimmed off.
function declarationText(node, sourceFile) {
  return node
    .getFullText(sourceFile)
    .replace(/^[\r\n]+/, "")
    .trimEnd();
}

function indentBlock(text) {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : `  ${line}`))
    .join("\n");
}

// Pull the quoted names out of `EXTENSION_CONTRACT_NAMES = [ ... ] as const`.
// Interspersed `//` comments contain no quotes, so a quote scan is safe here.
function parseContractNames(namesSource) {
  const arrayMatch = namesSource.match(/EXTENSION_CONTRACT_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!arrayMatch) throw new Error("Could not find EXTENSION_CONTRACT_NAMES array in extension-contract-names.ts");
  return [...arrayMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const contractsPath = join(repoRoot, "src", "shared", "contracts.ts");
const namesPath = join(repoRoot, "src", "shared", "extension-contract-names.ts");
const outputPath = join(repoRoot, "extensions", "babymenu-env.d.ts");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const contractsSource = readFileSync(contractsPath, "utf8");
  const contractNames = parseContractNames(readFileSync(namesPath, "utf8"));
  writeFileSync(outputPath, generateExtensionDts(contractsSource, contractNames));
  console.log(`Wrote ${outputPath}`);
}
