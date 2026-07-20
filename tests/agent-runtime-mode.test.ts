import { describe, expect, it, vi } from "vitest";
import {
  applyAgentRuntimeModeEnv,
  applyWslModeToOverrides,
  injectAgentRuntimeEnvIntoLaunch,
  isWslMode,
  resolveAgentProcessCwd,
  resolveWslDistro,
  resolveWslExecutable,
  windowsPathToWslPath,
  wrapCliSpawnForWsl,
  wrapLaunchCommandForWsl,
  wslCommandExists,
} from "../src/main/agent-runtime-mode";
import { normalizeWslDistroName, splitLaunchCommand } from "../src/shared/wsl-agent";
import type { AgentDefinition } from "../src/main/agent-catalog";

describe("agent-runtime-mode", () => {
  describe("isWslMode", () => {
    it("is never effective outside win32", () => {
      expect(isWslMode({ agentRuntimeMode: "wsl" }, {}, "linux")).toBe(false);
      expect(isWslMode({ agentRuntimeMode: "wsl" }, { BABY_MENU_AGENT_RUNTIME: "wsl" }, "darwin")).toBe(false);
    });

    it("honors prefs and env on win32", () => {
      expect(isWslMode({ agentRuntimeMode: "wsl" }, {}, "win32")).toBe(true);
      expect(isWslMode({ agentRuntimeMode: "host" }, {}, "win32")).toBe(false);
      expect(isWslMode({}, { BABY_MENU_AGENT_RUNTIME: "wsl" }, "win32")).toBe(true);
      expect(isWslMode({ agentRuntimeMode: "wsl" }, { BABY_MENU_AGENT_RUNTIME: "host" }, "win32")).toBe(false);
    });
  });

  describe("resolveWslDistro", () => {
    it("defaults to Ubuntu and prefers env over prefs", () => {
      expect(resolveWslDistro()).toBe("Ubuntu");
      expect(resolveWslDistro({ wslDistro: "Debian" })).toBe("Debian");
      expect(resolveWslDistro({ wslDistro: "Debian" }, { BABY_MENU_WSL_DISTRO: "Fedora" })).toBe("Fedora");
    });

    it("ignores empty prefs distro and falls back to Ubuntu", () => {
      expect(resolveWslDistro({ wslDistro: "   " })).toBe("Ubuntu");
    });
  });

  describe("windowsPathToWslPath", () => {
    it("maps drive letters to /mnt/<drive>/...", () => {
      expect(windowsPathToWslPath(String.raw`C:\Users\me\.baby-menu\extensions`)).toBe(
        "/mnt/c/Users/me/.baby-menu/extensions",
      );
      expect(windowsPathToWslPath("D:/work/repo")).toBe("/mnt/d/work/repo");
      expect(windowsPathToWslPath("C:\\")).toBe("/mnt/c");
      expect(windowsPathToWslPath("C:")).toBe("/mnt/c");
    });

    it("normalizes already-unix paths", () => {
      expect(windowsPathToWslPath("/home/me")).toBe("/home/me");
    });
  });

  describe("resolveAgentProcessCwd", () => {
    it("returns the host path when WSL mode is off", () => {
      expect(resolveAgentProcessCwd(String.raw`C:\Users\me\ext`, { agentRuntimeMode: "host" }, {}, "win32")).toBe(
        String.raw`C:\Users\me\ext`,
      );
      expect(resolveAgentProcessCwd("/repo/extensions", { agentRuntimeMode: "wsl" }, {}, "linux")).toBe(
        "/repo/extensions",
      );
    });

    it("translates Windows paths under WSL mode on win32", () => {
      expect(
        resolveAgentProcessCwd(String.raw`C:\Users\me\.baby-menu\extensions`, { agentRuntimeMode: "wsl" }, {}, "win32"),
      ).toBe("/mnt/c/Users/me/.baby-menu/extensions");
    });
  });

  describe("splitLaunchCommand / wrapLaunchCommandForWsl", () => {
    it("tokenizes quoted launch commands", () => {
      expect(splitLaunchCommand('env FOO=1 "my agent" stdio')).toEqual(["env", "FOO=1", "my agent", "stdio"]);
    });

    it("wraps an ACP launch with wsl + bash -lc, quoted tokens, and PATH export", () => {
      const wrapped = wrapLaunchCommandForWsl("grok agent stdio", "Ubuntu");
      expect(wrapped.startsWith('wsl -d "Ubuntu" -- bash -lc ')).toBe(true);
      // acpx-safe: -lc payload is double-quoted (not bash nested single quotes)
      expect(wrapped).toMatch(/bash -lc "/);
      expect(wrapped).not.toContain("'\\''");
      expect(wrapped).toContain("'grok'");
      expect(wrapped).toContain("'agent'");
      expect(wrapped).toContain("'stdio'");
      expect(wrapped).toContain("$HOME/.local/bin");
      expect(wrapped).toContain("$HOME/.grok/bin");
      // Metacharacters in a token stay inside single quotes (not shell-expanded).
      const withMeta = wrapLaunchCommandForWsl("tool ; rm -rf /", "Ubuntu");
      expect(withMeta).toContain("';'");
      expect(withMeta).not.toMatch(/exec tool ; rm/);
    });

    it("embeds optional host cwd as cd into /mnt form", () => {
      const wrapped = wrapLaunchCommandForWsl("grok agent stdio", "Ubuntu", {
        cwd: String.raw`C:\Users\me\ext`,
      });
      expect(wrapped).toContain("/mnt/c/Users/me/ext");
      expect(wrapped).toMatch(/cd /);
    });

    it("produces an acpx-splitable line (one -lc script arg)", () => {
      // Mirrors acpx splitCommandLine (prompt-turn-CVPMWdj1.js)
      function splitCommandLine(value: string): { command: string; args: string[] } {
        const parts: string[] = [];
        let current = "";
        let quote: string | null = null;
        let escaping = false;
        for (const ch of value) {
          if (escaping) {
            current += ch;
            escaping = false;
            continue;
          }
          if (ch === "\\" && quote !== "'") {
            escaping = true;
            continue;
          }
          if (quote) {
            if (ch === quote) quote = null;
            else current += ch;
            continue;
          }
          if (ch === "'" || ch === '"') {
            quote = ch;
            continue;
          }
          if (/\s/.test(ch)) {
            if (current.length > 0) {
              parts.push(current);
              current = "";
            }
            continue;
          }
          current += ch;
        }
        if (current.length > 0) parts.push(current);
        return { command: parts[0]!, args: parts.slice(1) };
      }

      const wrapped = wrapLaunchCommandForWsl("grok agent stdio", "Ubuntu", {
        cwd: String.raw`C:\Users\frand\.baby-menu\extensions`,
      });
      const { command, args } = splitCommandLine(wrapped);
      expect(command).toBe("wsl");
      expect(args).toEqual([
        "-d",
        "Ubuntu",
        "--",
        "bash",
        "-lc",
        expect.stringContaining("exec 'grok' 'agent' 'stdio'"),
      ]);
      expect(args[args.length - 1]).toContain("/mnt/c/Users/frand/.baby-menu/extensions");
      expect(args).toHaveLength(6);
    });

    it("rejects an empty launch command", () => {
      expect(() => wrapLaunchCommandForWsl("   ", "Ubuntu")).toThrow(/empty/i);
    });
  });

  describe("resolveWslExecutable", () => {
    it("prefers System32\\wsl.exe on win32 using SystemRoot then WINDIR", () => {
      expect(resolveWslExecutable({ SystemRoot: "D:\\Windows" }, "win32")).toBe(
        String.raw`D:\Windows\System32\wsl.exe`,
      );
      expect(resolveWslExecutable({ WINDIR: "E:\\Win" }, "win32")).toBe(String.raw`E:\Win\System32\wsl.exe`);
      expect(resolveWslExecutable({}, "win32")).toBe(String.raw`C:\Windows\System32\wsl.exe`);
    });

    it("falls back to bare wsl outside win32", () => {
      expect(resolveWslExecutable({}, "linux")).toBe("wsl");
      expect(resolveWslExecutable({ SystemRoot: "C:\\Windows" }, "darwin")).toBe("wsl");
    });
  });

  describe("wrapCliSpawnForWsl", () => {
    it("returns wsl argv and embeds the CLI plus optional cwd", () => {
      const wrapped = wrapCliSpawnForWsl("claude", ["-p", "hi"], "Ubuntu", {
        cwd: String.raw`C:\Users\me\ext`,
      });
      expect(wrapped.command).toBe(resolveWslExecutable());
      expect(wrapped.args[0]).toBe("-d");
      expect(wrapped.args[1]).toBe("Ubuntu");
      expect(wrapped.args).toContain("bash");
      expect(wrapped.args).toContain("-lc");
      const script = wrapped.args[wrapped.args.length - 1]!;
      expect(script).toContain("cd '/mnt/c/Users/me/ext'");
      expect(script).toContain("claude");
      expect(script).toContain("'hi'");
    });

    it("omits cd when cwd is not provided", () => {
      const wrapped = wrapCliSpawnForWsl("codex", ["exec"], "Debian");
      const script = wrapped.args[wrapped.args.length - 1]!;
      expect(script).not.toContain("cd ");
      expect(script).toContain("codex");
    });

    it("rejects invalid distro names before building argv", () => {
      expect(() => wrapCliSpawnForWsl("claude", [], 'Ubuntu";rm')).toThrow(/distro/i);
      expect(() => wrapCliSpawnForWsl("claude", [], "My Distro")).toThrow(/distro/i);
    });
  });

  describe("wslCommandExists", () => {
    it("invokes wsl with a mocked spawnSync and never requires a real distro", () => {
      const spawn = vi.fn(() => ({ status: 0 }));
      expect(wslCommandExists("grok", "Ubuntu", spawn)).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        resolveWslExecutable(),
        ["-d", "Ubuntu", "--", "bash", "-lc", expect.stringContaining("command -v")],
        expect.objectContaining({ stdio: "ignore", timeout: 5_000 }),
      );

      const missing = vi.fn(() => ({ status: 1 }));
      expect(wslCommandExists("missing", "Debian", missing)).toBe(false);
    });

    it("rejects unsafe command tokens and bad distros without spawning", () => {
      const spawn = vi.fn(() => ({ status: 0 }));
      expect(wslCommandExists("foo; rm -rf /", "Ubuntu", spawn)).toBe(false);
      expect(wslCommandExists("grok", 'Ubuntu"; evil', spawn)).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    it("treats spawn error / null status as unavailable", () => {
      expect(wslCommandExists("grok", "Ubuntu", () => ({ status: null, error: new Error("timeout") }))).toBe(false);
      expect(wslCommandExists("grok", "Ubuntu", () => ({ status: null }))).toBe(false);
    });
  });

  describe("normalizeWslDistroName", () => {
    it("accepts safe names and rejects spaces/quotes", () => {
      expect(normalizeWslDistroName("Ubuntu-22.04")).toBe("Ubuntu-22.04");
      expect(normalizeWslDistroName("  ")).toBe("Ubuntu");
      expect(() => normalizeWslDistroName('Ubuntu";rm')).toThrow(/distro/i);
      expect(() => normalizeWslDistroName("My Distro")).toThrow(/distro/i);
    });
  });

  describe("applyWslModeToOverrides", () => {
    const catalog: AgentDefinition[] = [
      {
        name: "claude",
        label: "Claude Code",
        command: "claude",
        adapter: "claude",
        launchCommand: "env ELECTRON_RUN_AS_NODE=1 /app/electron /o/claude.js",
      },
      {
        name: "grok",
        label: "Grok Build",
        command: "grok",
        launchCommand: "grok agent stdio",
      },
    ];

    it("injects runtime env into adapter launches and wraps pure ACP launches", () => {
      const overrides = {
        claude: catalog[0]!.launchCommand!,
        grok: catalog[1]!.launchCommand!,
      };
      const next = applyWslModeToOverrides(overrides, catalog, "Ubuntu", {
        hostCwd: String.raw`C:\Users\me\.baby-menu\extensions`,
      });
      expect(next.claude).toContain("BABY_MENU_AGENT_RUNTIME=wsl");
      expect(next.claude).toContain("BABY_MENU_WSL_DISTRO=Ubuntu");
      expect(next.claude).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(next.claude.startsWith("env ")).toBe(true);
      // Without proxy path: legacy wsl wrap fallback
      expect(next.grok.startsWith('wsl -d "Ubuntu"')).toBe(true);
      expect(next.grok).toContain("/mnt/c/Users/me/.baby-menu/extensions");
      expect(next.grok).toContain("'grok'");
    });

    it("uses electron.exe + wsl-acp-proxy.mjs for pure ACP (no .cmd / shell:true)", () => {
      const overrides = { grok: "grok agent stdio" };
      const next = applyWslModeToOverrides(overrides, catalog, "Ubuntu", {
        hostCwd: String.raw`C:\Users\frand\.baby-menu\extensions`,
        pureAcpProxyLaunch: [
          String.raw`C:\Users\frand\AppData\Local\Temp\abc\Baby Menu Dev.exe`,
          String.raw`C:\Users\frand\AppData\Local\Temp\abc\resources\app.asar.unpacked\out\adapters\wsl-acp-proxy.mjs`,
        ],
      });
      // First token must be .exe (acpx shell:false) — never .cmd (shell:true breaks spaces)
      expect(next.grok).not.toContain("wsl-acp-launch.cmd");
      expect(next.grok).not.toMatch(/\.cmd"/);
      expect(next.grok).toContain("Baby Menu Dev.exe");
      expect(next.grok).toContain("wsl-acp-proxy.mjs");
      expect(next.grok).toContain("--distro");
      expect(next.grok).toContain("Ubuntu");
      expect(next.grok).toMatch(/--\s+grok\s+agent\s+stdio/);
      // host cwd is env-only, not argv (avoids another spaced-path surface)
      expect(next.grok).not.toMatch(/baby-menu\\+extensions/);
      expect(next.grok).not.toMatch(/^env /);
      expect(next.grok).not.toContain("cmd.exe");
      // round-trip through acpx-style split keeps the spaced exe as one argv token
      const parts = splitLaunchCommand(next.grok!);
      expect(parts[0]).toMatch(/Baby Menu Dev\.exe$/);
      expect(parts).toContain("--distro");
      expect(parts).toContain("Ubuntu");
      expect(parts).toContain("--");
      expect(parts).toContain("grok");
    });
  });

  describe("injectAgentRuntimeEnvIntoLaunch", () => {
    it("prefixes env assignments or extends an existing env prefix", () => {
      expect(injectAgentRuntimeEnvIntoLaunch("node adapter.js", { FOO: "1" })).toBe("env FOO=1 node adapter.js");
      expect(injectAgentRuntimeEnvIntoLaunch("env A=1 node x", { B: "2" })).toBe("env B=2 A=1 node x");
    });
  });

  describe("applyAgentRuntimeModeEnv", () => {
    it("sets and clears host process env mirrors on win32", () => {
      const env: NodeJS.ProcessEnv = {};
      applyAgentRuntimeModeEnv(
        { agentRuntimeMode: "wsl", wslDistro: "Debian" },
        env,
        "win32",
        { hostCwd: String.raw`C:\Users\me\.baby-menu\extensions` },
      );
      expect(env.BABY_MENU_AGENT_RUNTIME).toBe("wsl");
      expect(env.BABY_MENU_WSL_DISTRO).toBe("Debian");
      expect(env.ELECTRON_RUN_AS_NODE).toBe("1");
      expect(env.BABY_MENU_WSL_PROXY_CWD).toBe(String.raw`C:\Users\me\.baby-menu\extensions`);

      applyAgentRuntimeModeEnv({ agentRuntimeMode: "host" }, env, "win32");
      expect(env.BABY_MENU_AGENT_RUNTIME).toBe("host");
      expect(env.BABY_MENU_WSL_DISTRO).toBeUndefined();
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(env.BABY_MENU_WSL_PROXY_CWD).toBeUndefined();
    });

    it("forces host on non-win32 even when prefs say wsl", () => {
      const env: NodeJS.ProcessEnv = { BABY_MENU_AGENT_RUNTIME: "wsl", BABY_MENU_WSL_DISTRO: "Ubuntu" };
      applyAgentRuntimeModeEnv({ agentRuntimeMode: "wsl" }, env, "linux");
      expect(env.BABY_MENU_AGENT_RUNTIME).toBe("host");
      expect(env.BABY_MENU_WSL_DISTRO).toBeUndefined();
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });

    it("prefs overwrite a stale launch-time env", () => {
      const env: NodeJS.ProcessEnv = {
        BABY_MENU_AGENT_RUNTIME: "wsl",
        BABY_MENU_WSL_DISTRO: "Old",
        ELECTRON_RUN_AS_NODE: "1",
      };
      applyAgentRuntimeModeEnv({ agentRuntimeMode: "host" }, env, "win32");
      expect(env.BABY_MENU_AGENT_RUNTIME).toBe("host");
      expect(env.BABY_MENU_WSL_DISTRO).toBeUndefined();
      expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    });
  });
});
