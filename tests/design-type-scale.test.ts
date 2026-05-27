import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// The type scale is declared twice: --fs-* in colors_and_type.css (consumed by
// the app-shell CSS) and --text-* in the @theme (which generates the Tailwind
// utilities the kit and widgets use). They must stay identical or the same
// nominal size renders differently across the two surfaces.
function extractTokens(css: string, prefix: string): Map<string, string> {
  const pattern = new RegExp(`--${prefix}-(\\w+):\\s*([^;]+);`, "g");
  const tokens = new Map<string, string>();
  for (const match of css.matchAll(pattern)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

describe("design system type scale", () => {
  let fsTokens: Map<string, string>;
  let textTokens: Map<string, string>;

  beforeAll(async () => {
    fsTokens = extractTokens(await readFile(resolve(__dirname, "../src/renderer/colors_and_type.css"), "utf8"), "fs");
    textTokens = extractTokens(await readFile(resolve(__dirname, "../src/ui/theme.css"), "utf8"), "text");
  });

  it("defines the same step names in both scales", () => {
    expect([...textTokens.keys()].sort()).toEqual([...fsTokens.keys()].sort());
  });

  it("keeps --fs-* and --text-* values identical for every step", () => {
    for (const [step, value] of fsTokens) {
      expect(`${step}=${textTokens.get(step)}`).toBe(`${step}=${value}`);
    }
  });
});
