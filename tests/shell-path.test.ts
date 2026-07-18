import { describe, expect, it, vi } from "vitest";
import {
  expandProcessPathForGuiLaunch,
  expandWindowsEnvVars,
  mergeShellPath,
  parseRegQueryPathValue,
  readLoginShellPath,
  readWindowsRegistryPathSegments,
  windowsCommonCliDirs,
} from "../src/main/shell-path";

describe("shell-path Windows merge (G05)", () => {
  const winHome = "C:\\Users\\me";
  const winEnv: NodeJS.ProcessEnv = {
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    ProgramFiles: "C:\\Program Files",
    "ProgramFiles(x86)": "C:\\Program Files (x86)",
    USERPROFILE: "C:\\Users\\me",
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

    expect(merged).toBe(
      [
        "C:\\Windows\\system32",
        "C:\\Windows",
        "C:\\Users\\me\\AppData\\Local\\Programs\\claude",
        "C:\\Tools",
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
        "C:\\Users\\me\\AppData\\Roaming\\npm",
        "C:\\Users\\me\\.local\\bin",
        "C:\\Program Files\\nodejs",
        "C:\\Program Files\\Git\\cmd",
      ].join(";"),
    );
  });

  it("expands REG_EXPAND_SZ %VAR% tokens from registry Path against env", () => {
    const merged = mergeShellPath({
      platform: "win32",
      homeDir: winHome,
      env: { ...winEnv, USERPROFILE: "C:\\Users\\me" },
      currentPath: "C:\\Windows\\system32",
      registryPathSegments: ["%USERPROFILE%\\go\\bin;%userprofile%\\bin;C:\\Literal"],
      pathExists: () => false,
    });

    expect(merged.split(";")).toEqual([
      "C:\\Windows\\system32",
      "C:\\Users\\me\\go\\bin",
      "C:\\Users\\me\\bin",
      "C:\\Literal",
    ]);
  });

  it("leaves unknown %VAR% tokens unchanged", () => {
    expect(expandWindowsEnvVars("%MISSING%\\tools;C:\\ok", { USERPROFILE: "C:\\Users\\me" })).toBe(
      "%MISSING%\\tools;C:\\ok",
    );
  });

  it("dedupes win32 path segments case-insensitively while keeping first-seen casing", () => {
    const merged = mergeShellPath({
      platform: "win32",
      homeDir: winHome,
      env: winEnv,
      currentPath: "C:\\Windows\\System32;C:\\Windows",
      registryPathSegments: ["c:\\windows\\system32;C:\\Tools"],
      pathExists: () => false,
    });

    expect(merged.split(";")).toEqual(["C:\\Windows\\System32", "C:\\Windows", "C:\\Tools"]);
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

  it("derives common CLI dirs from homeDir when env is empty", () => {
    expect(windowsCommonCliDirs({}, "C:\\Users\\me")).toEqual([
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
    expect(merged).toBe(
      [
        "C:\\Windows\\system32",
        "D:\\UserTools",
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
        "C:\\Program Files\\nodejs",
      ].join(";"),
    );
    expect(env.PATH).toBe(merged);
    expect(env.Path).toBe(merged);
  });

  it("expandProcessPathForGuiLaunch still merges common dirs when registry returns empty", () => {
    const env: NodeJS.ProcessEnv = {
      Path: "C:\\Windows\\system32",
      LOCALAPPDATA: winEnv.LOCALAPPDATA,
      ProgramFiles: winEnv.ProgramFiles,
    };

    const merged = expandProcessPathForGuiLaunch({
      platform: "win32",
      env,
      homeDir: winHome,
      pathExists: (dir) => dir.endsWith("WindowsApps") || dir.endsWith("nodejs"),
      readRegistryPathSegments: () => [],
    });

    expect(merged).toBe(
      [
        "C:\\Windows\\system32",
        "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps",
        "C:\\Program Files\\nodejs",
      ].join(";"),
    );
  });

  it("resolves current path from Path then PATH; empty Path wins over PATH via ??", () => {
    expect(
      mergeShellPath({
        platform: "win32",
        env: { Path: "C:\\FromPath", PATH: "C:\\FromPATH" },
        pathExists: () => false,
      }),
    ).toBe("C:\\FromPath");

    expect(
      mergeShellPath({
        platform: "win32",
        env: { PATH: "C:\\FromPATHOnly" },
        pathExists: () => false,
      }),
    ).toBe("C:\\FromPATHOnly");

    // Empty string is not nullish, so ?? does not fall through to PATH.
    expect(
      mergeShellPath({
        platform: "win32",
        env: { Path: "", PATH: "C:\\WouldBeIgnored" },
        pathExists: () => false,
      }),
    ).toBe("");
  });

  it("readWindowsRegistryPathSegments is a no-op off win32", () => {
    const spawn = vi.fn();
    expect(readWindowsRegistryPathSegments({ platform: "linux", spawn: spawn as never })).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("readWindowsRegistryPathSegments is fail-soft across spawn shapes and still tries both keys", () => {
    const throwSpawn = vi.fn(() => {
      throw new Error("reg missing");
    });
    expect(readWindowsRegistryPathSegments({ platform: "win32", spawn: throwSpawn as never })).toEqual(
      [],
    );
    expect(throwSpawn).toHaveBeenCalledTimes(2);

    const softFailures = vi.fn((...args: unknown[]) => {
      const key = String((args[1] as string[])[1] ?? "");
      if (key.includes("HKCU")) {
        return { status: 1, stdout: "", stderr: "ERROR", error: undefined };
      }
      return {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      };
    });
    expect(
      readWindowsRegistryPathSegments({ platform: "win32", spawn: softFailures as never }),
    ).toEqual([]);
    expect(softFailures).toHaveBeenCalledTimes(2);

    const partial = vi.fn((...args: unknown[]) => {
      const key = String((args[1] as string[])[1] ?? "");
      if (key.includes("HKCU")) {
        return { status: 0, stdout: "    Path    REG_SZ    C:\\UserOnly\r\n", stderr: "", error: undefined };
      }
      return { status: 1, stdout: "", stderr: "denied", error: undefined };
    });
    expect(readWindowsRegistryPathSegments({ platform: "win32", spawn: partial as never })).toEqual([
      "C:\\UserOnly",
    ]);
    expect(partial).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: "REG_EXPAND_SZ with CRLF",
      stdout: [
        "",
        "HKEY_CURRENT_USER\\Environment",
        "    Path    REG_EXPAND_SZ    C:\\Users\\me\\bin;%USERPROFILE%\\go\\bin",
        "",
      ].join("\r\n"),
      expected: "C:\\Users\\me\\bin;%USERPROFILE%\\go\\bin",
    },
    {
      name: "REG_SZ with LF",
      stdout: "HKEY_LOCAL_MACHINE\\...\n    Path    REG_SZ    C:\\SystemBin\n",
      expected: "C:\\SystemBin",
    },
    {
      name: "case-insensitive Path/REG type",
      stdout: "    path    reg_expand_sz    D:\\MixedCase\n",
      expected: "D:\\MixedCase",
    },
    {
      name: "empty value",
      stdout: "    Path    REG_SZ    \n",
      expected: undefined,
    },
    {
      name: "no path line",
      stdout: "no path here",
      expected: undefined,
    },
  ])("parseRegQueryPathValue: $name", ({ stdout, expected }) => {
    expect(parseRegQueryPathValue(stdout)).toBe(expected);
  });

  it("readWindowsRegistryPathSegments parses successful reg query and locks spawn args", () => {
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

    expect(spawn).toHaveBeenNthCalledWith(
      1,
      "reg",
      ["query", "HKCU\\Environment", "/v", "Path"],
      expect.objectContaining({ encoding: "utf8", timeout: 1500, windowsHide: true }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      "reg",
      [
        "query",
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
        "/v",
        "Path",
      ],
      expect.objectContaining({ encoding: "utf8", timeout: 1500, windowsHide: true }),
    );
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

  it("expandProcessPathForGuiLaunch on darwin uses readShellPath and only sets PATH", () => {
    const readShellPath = vi.fn(() => "/opt/custom/bin:/usr/bin");
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

    const merged = expandProcessPathForGuiLaunch({
      platform: "darwin",
      env,
      homeDir: "/Users/me",
      readShellPath,
    });

    expect(readShellPath).toHaveBeenCalledOnce();
    expect(merged.split(":")).toEqual(
      expect.arrayContaining(["/usr/bin", "/bin", "/opt/homebrew/bin", "/Users/me/.local/bin", "/opt/custom/bin"]),
    );
    expect(env.PATH).toBe(merged);
    expect(env.Path).toBeUndefined();
    expect(merged.includes(";")).toBe(false);
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

  it("readLoginShellPath returns undefined when zsh exits non-zero", () => {
    const spawn = vi.fn(() => ({
      status: 1,
      stdout: "/should/not/use\n",
      stderr: "nope",
      error: undefined,
    }));
    expect(readLoginShellPath({ platform: "darwin", spawn: spawn as never })).toBeUndefined();
  });

  it("readLoginShellPath returns undefined when zsh stdout is empty", () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: "   \n",
      stderr: "",
      error: undefined,
    }));
    expect(readLoginShellPath({ platform: "darwin", spawn: spawn as never })).toBeUndefined();
  });
});
