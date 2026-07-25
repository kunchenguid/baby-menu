import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeShellPath, readLoginShellPath, resolveProbeShell } from "../src/main/shell-path";

type ProbeCall = { command: string; args: string[]; timeout: number };

function recordingSpawn(result: { status: number | null; stdout: string | null; error?: Error }) {
  const calls: ProbeCall[] = [];
  const spawn = (command: string, args: string[], options: { timeout: number }) => {
    calls.push({ command, args, timeout: options.timeout });
    return result;
  };
  return { calls, spawn };
}

function probeStdout(pathValue: string): string {
  return `__BABY_MENU_PATH_PROBE__${pathValue}__BABY_MENU_PATH_PROBE__\n`;
}

describe("mergeShellPath", () => {
  it("dedupes segments and preserves first-seen order", () => {
    expect(
      mergeShellPath({
        currentPath: "/usr/bin:/bin",
        homeDir: "/Users/me",
        shellPath: "/Users/me/.asdf/shims:/opt/homebrew/bin:/usr/bin",
      }),
    ).toBe(
      [
        "/usr/bin",
        "/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/sbin",
        "/sbin",
        "/Users/me/.local/bin",
        "/Users/me/.asdf/shims",
      ].join(":"),
    );
  });

  it("still yields the common GUI paths when nothing is passed in", () => {
    expect(mergeShellPath({ homeDir: "/Users/me" }).split(":")).toContain("/opt/homebrew/bin");
  });
});

describe("resolveProbeShell", () => {
  it("prefers the user's own shell when it is a recognized POSIX shell", () => {
    expect(resolveProbeShell("/bin/bash")).toBe("/bin/bash");
    expect(resolveProbeShell("/opt/homebrew/bin/zsh")).toBe("/opt/homebrew/bin/zsh");
  });

  it("falls back to /bin/zsh for unset, relative, or unsupported shells", () => {
    expect(resolveProbeShell(undefined)).toBe("/bin/zsh");
    expect(resolveProbeShell("zsh")).toBe("/bin/zsh");
    expect(resolveProbeShell("/opt/homebrew/bin/fish")).toBe("/bin/zsh");
  });
});

describe("readLoginShellPath", () => {
  it("probes an interactive login shell so rc files (and version manager shims) are sourced", () => {
    const { calls, spawn } = recordingSpawn({
      status: 0,
      stdout: probeStdout("/Users/me/.asdf/shims:/usr/bin:/bin"),
    });

    const result = readLoginShellPath({ platform: "darwin", env: { SHELL: "/bin/zsh" }, spawn });

    expect(result).toBe("/Users/me/.asdf/shims:/usr/bin:/bin");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/bin/zsh");
    expect(calls[0].args.slice(0, 3)).toEqual(["-i", "-l", "-c"]);
    expect(calls[0].timeout).toBeGreaterThan(2000);
  });

  it("extracts the delimited PATH even when interactive rc files pollute stdout", () => {
    const { spawn } = recordingSpawn({
      status: 0,
      stdout: [
        "mise: activating",
        "welcome back!",
        probeStdout("/Users/me/.local/share/mise/shims:/usr/bin").trimEnd(),
        "some trailing rc chatter",
      ].join("\n"),
    });

    expect(readLoginShellPath({ platform: "darwin", env: {}, spawn })).toBe(
      "/Users/me/.local/share/mise/shims:/usr/bin",
    );
  });

  it("returns undefined on a non-zero exit", () => {
    const { spawn } = recordingSpawn({ status: 1, stdout: probeStdout("/usr/bin") });
    expect(readLoginShellPath({ platform: "darwin", env: {}, spawn })).toBeUndefined();
  });

  it("returns undefined when the probe times out", () => {
    const { spawn } = recordingSpawn({ status: null, stdout: "", error: new Error("ETIMEDOUT") });
    expect(readLoginShellPath({ platform: "darwin", env: {}, spawn })).toBeUndefined();
  });

  it("rejects junk output instead of merging it", () => {
    for (const stdout of [null, "", "no shell here", probeStdout("not-a-path"), "__BABY_MENU_PATH_PROBE__/usr/bin"]) {
      const { spawn } = recordingSpawn({ status: 0, stdout });
      expect(readLoginShellPath({ platform: "darwin", env: {}, spawn })).toBeUndefined();
    }
  });

  it("never throws when spawning the probe fails outright", () => {
    const spawn = () => {
      throw new Error("EACCES");
    };
    expect(readLoginShellPath({ platform: "darwin", env: {}, spawn })).toBeUndefined();
  });

  it("returns undefined on win32 without spawning anything", () => {
    const { calls, spawn } = recordingSpawn({ status: 0, stdout: probeStdout("/usr/bin") });
    expect(readLoginShellPath({ platform: "win32", env: {}, spawn })).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  // Guards the probe command itself: a bare `$PATH` before the marker would
  // parse as one unset variable name and return an empty value.
  it.skipIf(process.platform === "win32" || !existsSync("/bin/zsh"))(
    "reads a plausible PATH out of a real interactive login zsh",
    () => {
      const result = readLoginShellPath({ env: { ...process.env, SHELL: "/bin/zsh" } });
      expect(result).toBeDefined();
      expect(result).not.toContain("\n");
      expect(result).toContain("/usr/bin");
    },
  );
});
