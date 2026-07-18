import { describe, expect, it, vi } from "vitest";
import {
  expandProcessPathForGuiLaunch,
  mergeShellPath,
  parseRegQueryPathValue,
  readLoginShellPath,
  readWindowsRegistryPathSegments,
  windowsCommonCliDirs,
} from "../src/main/shell-path";

describe("shell-path Windows merge (G05)", () => {
  const winHome = "C:\\Users\\me";
  const winEnv = {
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    Path: "C:\\Windows\\system32;C:\\Windows",
    PATH: "C:\\Windows\\system32;C:\\Windows",
  };

  it("uses path.delimiter `;` and merges current, registry, and present common CLI dirs on win32", () => {
    const present = new Set([
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
      "C:\\Users\\me\\AppData\\Roaming\\npm",
      "C:\\Users\\me\\.local\\bin",
      "C:\\Program Files\\nodejs",
      "C:\\Program Files\\Git\\cmd",
    ]);

    const merged = mergeShellPath({
      platform: "win32",
      homeDir: winHome,
      env: winEnv,
      currentPath: "C:\\Windows\\system32;C:\\Windows",
      registryPathSegments: [
        "C:\\Users\\me\\AppData\\Local\\Programs\\claude;C:\\Tools",
        "C:\\Windows\\system32",
      ],
      pathExists: (dir) => present.has(dir),
    });

    const segments = merged.split(";");
    // Windows PATH uses `;` as the list delimiter (drive letters still contain `:`).
    expect(segments.join(";")).toBe(merged);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments).toContain("C:\\Windows\\system32");
    expect(segments).toContain("C:\\Windows");
    expect(segments).toContain("C:\\Users\\me\\AppData\\Local\\Programs\\claude");
    expect(segments).toContain("C:\\Tools");
    expect(segments).toContain("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps");
    expect(segments).toContain("C:\\Users\\me\\AppData\\Roaming\\npm");
    expect(segments).toContain("C:\\Users\\me\\.local\\bin");
    expect(segments).toContain("C:\\Program Files\\nodejs");
    expect(segments).toContain("C:\\Program Files\\Git\\cmd");
    // Absent Git bin / x86 paths must not appear
    expect(segments).not.toContain("C:\\Program Files\\Git\\bin");
    expect(segments).not.toContain("C:\\Program Files (x86)\\Git\\cmd");
    // Unix homebrew paths must never appear on win32 merge
    expect(segments).not.toContain("/opt/homebrew/bin");
    // Deduped system32 from current + registry
    expect(segments.filter((s) => s === "C:\\Windows\\system32")).toHaveLength(1);
  });

  it("lists the expected Windows common CLI directory candidates", () => {
    const dirs = windowsCommonCliDirs(winEnv, winHome);
    expect(dirs).toEqual([
      "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
      "C:\\Users\\me\\AppData\\Roaming\\npm",
      "C:\\Users\\me\\.local\\bin",
      "C:\\Program Files\\nodejs",
      "C:\\Program Files\\Git\\cmd",
      "C:\\Program Files\\Git\\bin",
      "C:\\Program Files (x86)\\Git\\cmd",
      "C:\\Program Files (x86)\\Git\\bin",
    ]);
  });

  it("does not invoke zsh when reading login shell PATH on win32", () => {
    const spawn = vi.fn();
    expect(readLoginShellPath({ platform: "win32", spawn: spawn as never })).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("expandProcessPathForGuiLaunch on win32 never uses login-shell PATH and sets Path/PATH", () => {
    const readShellPath = vi.fn(() => "/should/not/be/used");
    const env: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\system32",
      PATH: "C:\\Windows\\system32",
      LOCALAPPDATA: winEnv.LOCALAPPDATA,
      APPDATA: winEnv.APPDATA,
      ProgramFiles: winEnv.ProgramFiles,
    };

    const merged = expandProcessPathForGuiLaunch({
      platform: "win32",
      env,
      homeDir: winHome,
      pathExists: (dir) => dir.endsWith("WindowsApps") || dir.endsWith("nodejs"),
      readRegistryPathSegments: () => ["D:\\UserTools"],
      readShellPath,
    });

    expect(readShellPath).not.toHaveBeenCalled();
    expect(merged.split(";")).toEqual(
      expect.arrayContaining([
        "C:\\Windows\\system32",
        "D:\\UserTools",
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
        "C:\\Program Files\\nodejs",
      ]),
    );
    expect(env.PATH).toBe(merged);
    expect(env.Path).toBe(merged);
    expect(merged.split(";").join(";")).toBe(merged);
    expect(merged.split(";")).not.toContain("/opt/homebrew/bin");
  });

  it("readWindowsRegistryPathSegments is a no-op off win32 and fail-soft on spawn errors", () => {
    const spawn = vi.fn(() => {
      throw new Error("reg missing");
    });
    expect(readWindowsRegistryPathSegments({ platform: "linux", spawn: spawn as never })).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();

    expect(readWindowsRegistryPathSegments({ platform: "win32", spawn: spawn as never })).toEqual([]);
    expect(spawn).toHaveBeenCalled();
  });

  it("parses reg query Path output", () => {
    const stdout = [
      "",
      "HKEY_CURRENT_USER\\Environment",
      "    Path    REG_EXPAND_SZ    C:\\Users\\me\\bin;%USERPROFILE%\\go\\bin",
      "",
    ].join("\r\n");
    expect(parseRegQueryPathValue(stdout)).toBe("C:\\Users\\me\\bin;%USERPROFILE%\\go\\bin");
    expect(parseRegQueryPathValue("no path here")).toBeUndefined();
  });

  it("readWindowsRegistryPathSegments parses successful reg query stdout", () => {
    const spawn = vi.fn((_cmd: string, args: string[]) => {
      const key = args[1] ?? "";
      if (key.includes("HKCU")) {
        return {
          status: 0,
          stdout: "    Path    REG_SZ    C:\\UserBin\r\n",
          stderr: "",
          error: undefined,
        };
      }
      return {
        status: 0,
        stdout: "    Path    REG_EXPAND_SZ    C:\\SystemBin\r\n",
        stderr: "",
        error: undefined,
      };
    });

    expect(
      readWindowsRegistryPathSegments({ platform: "win32", spawn: spawn as never }),
    ).toEqual(["C:\\UserBin", "C:\\SystemBin"]);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});

describe("shell-path darwin/unix merge (unchanged)", () => {
  it("merges Homebrew, local-bin, and login-shell PATH entries with colon delimiter", () => {
    const merged = mergeShellPath({
      platform: "darwin",
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

  it("default merge (no platform override) still uses colon-style unix merge on non-win32 hosts", () => {
    if (process.platform === "win32") return;

    const merged = mergeShellPath({
      currentPath: "/usr/bin:/bin",
      homeDir: "/Users/me",
      shellPath: "/opt/custom/bin:/usr/bin",
    });
    expect(merged.includes(";")).toBe(false);
    expect(merged.split(":")).toContain("/opt/homebrew/bin");
  });

  it("readLoginShellPath still spawns zsh on non-win32 when spawn is provided", () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: "/opt/homebrew/bin:/usr/bin\n",
      stderr: "",
      error: undefined,
    }));
    expect(readLoginShellPath({ platform: "darwin", spawn: spawn as never })).toBe(
      "/opt/homebrew/bin:/usr/bin",
    );
    expect(spawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-lc", "print -r -- $PATH"],
      expect.objectContaining({ encoding: "utf8", timeout: 2000 }),
    );
  });
});
