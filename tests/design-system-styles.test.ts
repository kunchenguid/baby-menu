import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rootDir = resolve(import.meta.dirname, "..");

describe("design system styles", () => {
  it("keeps the gitignored dev extension workspace out of the production stylesheet", async () => {
    const styles = await readFile(resolve(rootDir, "src/ui/styles.css"), "utf8");

    expect(styles).not.toContain("extensions-dev");
  });
});
