import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCodexModel, readCodexModel, codexHome } from "../src/adapters/codex/config";

describe("parseCodexModel", () => {
  it("reads a top-level double-quoted model", () => {
    expect(parseCodexModel('model = "gpt-5.5"\n')).toBe("gpt-5.5");
  });

  it("reads a top-level single-quoted model", () => {
    expect(parseCodexModel("model = 'gpt-5.5'\n")).toBe("gpt-5.5");
  });

  it("ignores commented-out model lines", () => {
    expect(parseCodexModel('# model = "gpt-5.3-codex"\nmodel = "gpt-5.5"\n')).toBe("gpt-5.5");
  });

  it("ignores model keys nested inside a table (profiles, etc.)", () => {
    // Only the top-level model applies; a model under [profiles.foo] is a
    // different setting and must not be mistaken for the active default.
    const toml = ['[profiles.fast]', 'model = "gpt-5.3-codex"', ""].join("\n");
    expect(parseCodexModel(toml)).toBeNull();
  });

  it("returns null when no model key is present", () => {
    expect(parseCodexModel('approval_policy = "never"\n')).toBeNull();
  });
});

describe("readCodexModel", () => {
  it("reads model from <home>/config.toml", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-home-"));
    await writeFile(join(home, "config.toml"), 'model = "gpt-5.5"\n');
    expect(readCodexModel(home)).toBe("gpt-5.5");
  });

  it("returns null when config.toml is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-home-"));
    expect(readCodexModel(home)).toBeNull();
  });
});

describe("codexHome", () => {
  it("honors CODEX_HOME when set", () => {
    expect(codexHome({ CODEX_HOME: "/custom/codex" } as NodeJS.ProcessEnv)).toBe("/custom/codex");
  });

  it("falls back to ~/.codex when CODEX_HOME is unset", () => {
    expect(codexHome({} as NodeJS.ProcessEnv).endsWith("/.codex")).toBe(true);
  });
});
