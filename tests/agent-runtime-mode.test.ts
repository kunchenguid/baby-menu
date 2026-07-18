import { describe, expect, it, vi } from "vitest";
import {
  applyAgentRuntimeModeEnv,
  applyWslModeToOverrides,
  injectAgentRuntimeEnvIntoLaunch,
  isWslMode,
  resolveAgentProcessCwd,
  resolveWslDistro,
  windowsPathToWslPath,
  wrapCliSpawnForWsl,
  wrapLaunchCommandForWsl,
  wslCommandExists,
} from "../src/main/agent-runtime-mode";
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
  });

  describe("windowsPathToWslPath", () => {
    it("maps drive letters to /mnt/<drive>/...", () => {
      expect(windowsPathToWslPath(String.raw`C:\Users\me\.baby-menu\extensions`)).toBe(
        "/mnt/c/Users/me/.baby-menu/extensions",
      );
      expect(windowsPathToWslPath("D:/work/repo")).toBe("/mnt/d/work/repo");
      expect(windowsPathToWslPath("C:\\")).toBe("/mnt/c");
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

  describe("wrapLaunchCommandForWsl", () => {
    it("wraps an ACP launch with wsl + bash -lc and PATH export", () => {
      const wrapped = wrapLaunchCommandForWsl("grok agent stdio", "Ubuntu");
      expect(wrapped.startsWith("wsl -d Ubuntu -- bash -lc ")).toBe(true);
      expect(wrapped).toContain("grok agent stdio");
      expect(wrapped).toContain("$HOME/.local/bin");
      expect(wrapped).toContain("$HOME/.grok/bin");
    });
  });

  describe("wrapCliSpawnForWsl", () => {
    it("returns wsl argv and embeds the CLI plus optional cwd", () => {
      const wrapped = wrapCliSpawnForWsl("claude", ["-p", "hi"], "Ubuntu", {
        cwd: String.raw`C:\Users\me\ext`,
      });
      expect(wrapped.command).toBe("wsl");
      expect(wrapped.args[0]).toBe("-d");
      expect(wrapped.args[1]).toBe("Ubuntu");
      expect(wrapped.args).toContain("bash");
      expect(wrapped.args).toContain("-lc");
      const script = wrapped.args[wrapped.args.length - 1]!;
      expect(script).toContain("cd '/mnt/c/Users/me/ext'");
      expect(script).toContain("claude");
      expect(script).toContain("'hi'");
    });
  });

  describe("wslCommandExists", () => {
    it("invokes wsl with a mocked spawnSync and never requires a real distro", () => {
      const spawn = vi.fn(() => ({ status: 0 }));
      expect(wslCommandExists("grok", "Ubuntu", spawn)).toBe(true);
      expect(spawn).toHaveBeenCalledWith(
        "wsl",
        ["-d", "Ubuntu", "--", "bash", "-lc", expect.stringContaining("command -v")],
        expect.objectContaining({ stdio: "ignore" }),
      );

      const missing = vi.fn(() => ({ status: 1 }));
      expect(wslCommandExists("missing", "Debian", missing)).toBe(false);
    });

    it("rejects unsafe command tokens without spawning", () => {
      const spawn = vi.fn(() => ({ status: 0 }));
      expect(wslCommandExists("foo; rm -rf /", "Ubuntu", spawn)).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
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
      const next = applyWslModeToOverrides(overrides, catalog, "Ubuntu");
      expect(next.claude).toContain("BABY_MENU_AGENT_RUNTIME=wsl");
      expect(next.claude).toContain("BABY_MENU_WSL_DISTRO=Ubuntu");
      expect(next.claude).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(next.claude.startsWith("env ")).toBe(true);
      expect(next.grok.startsWith("wsl -d Ubuntu")).toBe(true);
      expect(next.grok).toContain("grok agent stdio");
    });
  });

  describe("injectAgentRuntimeEnvIntoLaunch", () => {
    it("prefixes env assignments or extends an existing env prefix", () => {
      expect(injectAgentRuntimeEnvIntoLaunch("node adapter.js", { FOO: "1" })).toBe("env FOO=1 node adapter.js");
      expect(injectAgentRuntimeEnvIntoLaunch("env A=1 node x", { B: "2" })).toBe("env B=2 A=1 node x");
    });
  });

  describe("applyAgentRuntimeModeEnv", () => {
    it("sets and clears host process env mirrors", () => {
      const env: NodeJS.ProcessEnv = {};
      applyAgentRuntimeModeEnv({ agentRuntimeMode: "wsl", wslDistro: "Debian" }, env, "win32");
      expect(env.BABY_MENU_AGENT_RUNTIME).toBe("wsl");
      expect(env.BABY_MENU_WSL_DISTRO).toBe("Debian");

      applyAgentRuntimeModeEnv({ agentRuntimeMode: "host" }, env, "win32");
      expect(env.BABY_MENU_AGENT_RUNTIME).toBe("host");
      expect(env.BABY_MENU_WSL_DISTRO).toBeUndefined();
    });
  });
});
