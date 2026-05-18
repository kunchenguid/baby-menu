import { describe, expect, it } from "vitest";
import { getAgentRuntimeCwd, resolveDefaultAgentName, selectAgentChangeSessionKind } from "../src/main/agent-runtime";
import { mergeShellPath } from "../src/main/shell-path";

describe("agent runtime distribution behavior", () => {
  it("uses git sessions only for source-mode tracked extensions", () => {
    expect(
      selectAgentChangeSessionKind({ isPackaged: false, rootDir: "/repo", extensionsDir: "/repo/extensions" }),
    ).toBe("git");
    expect(
      selectAgentChangeSessionKind({ isPackaged: false, rootDir: "/repo", extensionsDir: "/repo/extensions-dev" }),
    ).toBe("snapshot");
    expect(
      selectAgentChangeSessionKind({
        isPackaged: true,
        rootDir: "/repo",
        extensionsDir: "/Users/me/Library/Application Support/baby-menu/extensions",
      }),
    ).toBe("snapshot");
  });

  it("launches packaged agents from the user-data extension workspace", () => {
    expect(
      getAgentRuntimeCwd("/repo", {}, { extensionsDir: "/Users/me/.baby-menu/extensions" }),
    ).toBe("/Users/me/.baby-menu/extensions");
  });

  it("merges Homebrew, local-bin, and login-shell PATH entries for GUI launches", () => {
    const merged = mergeShellPath({
      currentPath: "/usr/bin:/bin",
      homeDir: "/Users/me",
      shellPath: "/opt/custom/bin:/usr/bin",
    }).split(":");

    expect(merged).toContain("/opt/homebrew/bin");
    expect(merged).toContain("/usr/local/bin");
    expect(merged).toContain("/Users/me/.local/bin");
    expect(merged).toContain("/opt/custom/bin");
    expect(merged.filter((entry) => entry === "/usr/bin")).toHaveLength(1);
  });

  it("can report that no supported agent CLI is available", () => {
    expect(
      resolveDefaultAgentName({ env: {}, commandExists: () => false, allowFallbackWhenMissing: false }),
    ).toBeNull();
  });
});
