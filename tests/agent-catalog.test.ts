import { describe, expect, it } from "vitest";
import {
  BUILT_IN_AGENT_NAMES,
  DEFAULT_AGENTS,
  customAgentToDefinition,
  resolveAgentCatalog,
  toAgentOptions,
  agentRegistryOverrides,
  validateCustomAgentInput,
  withAdapterLaunchCommands,
  loadAgentConfigFile,
  parseAgentDefinitions,
} from "../src/main/agent-catalog";

describe("agent-catalog", () => {
  it("ships claude, codex, and grok as the built-in agents (no pi)", () => {
    expect(DEFAULT_AGENTS.map((agent) => agent.name)).toEqual(["claude", "codex", "grok"]);
    expect(DEFAULT_AGENTS.map((agent) => agent.adapter)).toEqual(["claude", "codex", undefined]);
    expect(DEFAULT_AGENTS.find((agent) => agent.name === "grok")).toMatchObject({
      command: "grok",
      launchCommand: "grok agent stdio",
      label: "Grok Build",
    });
  });

  it("derives Settings availability by probing each agent's wrapped CLI", () => {
    const available = (commands: string[]) => {
      const set = new Set(commands);
      return (command: string) => set.has(command);
    };
    const options = toAgentOptions(DEFAULT_AGENTS, available(["claude"]));
    const byName = Object.fromEntries(options.map((o) => [o.name, o.available]));
    expect(byName).toEqual({ claude: true, codex: false, grok: false });
  });

  it("probes grok availability via commandExists even with an explicit launchCommand", () => {
    const options = toAgentOptions(DEFAULT_AGENTS, (command) => command === "grok");
    const byName = Object.fromEntries(options.map((o) => [o.name, o.available]));
    expect(byName).toEqual({ claude: false, codex: false, grok: true });
  });

  it("merges agents.json definitions over built-ins and appends new ones", () => {
    const catalog = resolveAgentCatalog({
      config: [
        { name: "claude", label: "Custom Claude" },
        { name: "rovo", command: "rovo" },
      ],
    });
    expect(catalog.find((a) => a.name === "claude")?.label).toBe("Custom Claude");
    expect(catalog.find((a) => a.name === "rovo")?.command).toBe("rovo");
  });

  it("parseAgentDefinitions normalizes entries and defaults command to name", () => {
    const defs = parseAgentDefinitions([{ name: "pi", launchCommand: "npx pi-acp" }, { bad: true }]);
    expect(defs).toEqual([{ name: "pi", label: "pi", command: "pi", installHint: undefined, launchCommand: "npx pi-acp" }]);
  });

  it("injects a bundled adapter launchCommand for built-in adapter agents", () => {
    const wired = withAdapterLaunchCommands(
      DEFAULT_AGENTS,
      (adapter) => `/app/out/adapters/${adapter}/index.js`,
      ["/usr/bin/node"],
    );
    expect(wired.find((a) => a.name === "claude")?.launchCommand).toBe(
      "/usr/bin/node /app/out/adapters/claude/index.js",
    );
    expect(wired.find((a) => a.name === "codex")?.launchCommand).toBe(
      "/usr/bin/node /app/out/adapters/codex/index.js",
    );
  });

  it("supports an Electron-as-node launcher and quotes paths with spaces", () => {
    const wired = withAdapterLaunchCommands(
      DEFAULT_AGENTS,
      (adapter) => `/Apps/Baby Menu.app/out/adapters/${adapter}/index.js`,
      ["env", "ELECTRON_RUN_AS_NODE=1", "/Apps/Baby Menu.app/Contents/MacOS/Baby Menu"],
    );
    expect(wired.find((a) => a.name === "claude")?.launchCommand).toBe(
      'env ELECTRON_RUN_AS_NODE=1 "/Apps/Baby Menu.app/Contents/MacOS/Baby Menu" "/Apps/Baby Menu.app/out/adapters/claude/index.js"',
    );
  });

  it("win32 launcher never prefixes env and escapes backslashes for acpx", () => {
    // Mirrors production win32 wiring: [execPath] only; ELECTRON_RUN_AS_NODE is
    // set on process.env (no Unix `env` binary on stock Windows).
    const execPath = String.raw`C:\Users\me\AppData\Local\Programs\Baby Menu\Baby Menu.exe`;
    const adapterRoot = String.raw`C:\Users\me\AppData\Local\Baby Menu\adapters`;
    const wired = withAdapterLaunchCommands(
      DEFAULT_AGENTS,
      (adapter) => `${adapterRoot}\\${adapter}\\index.mjs`,
      [execPath],
    );
    const claude = wired.find((a) => a.name === "claude")?.launchCommand ?? "";
    const codex = wired.find((a) => a.name === "codex")?.launchCommand ?? "";

    expect(claude.startsWith("env ")).toBe(false);
    expect(codex.startsWith("env ")).toBe(false);
    expect(claude).not.toContain("ELECTRON_RUN_AS_NODE");
    // Spaces force quoting; backslashes must be doubled so acpx splitCommandLine
    // restores single separators (same rules as agent-runtime-mode.shellJoinToken).
    expect(claude).toBe(
      [
        `"${String.raw`C:\\Users\\me\\AppData\\Local\\Programs\\Baby Menu\\Baby Menu.exe`}"`,
        `"${String.raw`C:\\Users\\me\\AppData\\Local\\Baby Menu\\adapters\\claude\\index.mjs`}"`,
      ].join(" "),
    );
    expect(codex).toContain(String.raw`adapters\\codex\\index.mjs`);
  });

  it("escapes embedded quotes and backslashes in launch tokens", () => {
    const wired = withAdapterLaunchCommands(
      DEFAULT_AGENTS,
      () => String.raw`C:\path\with "quotes"\adapter.js`,
      [String.raw`C:\tools\node.exe`],
    );
    expect(wired.find((a) => a.name === "claude")?.launchCommand).toBe(
      String.raw`"C:\\tools\\node.exe" "C:\\path\\with \"quotes\"\\adapter.js"`,
    );
  });

  it("does not override an explicit custom launchCommand", () => {
    const custom = [{ name: "claude", label: "Claude", command: "claude", adapter: "claude" as const, launchCommand: "my-claude" }];
    const wired = withAdapterLaunchCommands(custom, () => "/should/not/be/used");
    expect(wired[0]!.launchCommand).toBe("my-claude");
  });

  it("still probes built-in CLIs when agents.json overrides launchCommand", () => {
    // Built-ins always measure availability via commandExists(command), even if the
    // user replaces the bundled adapter launch with a custom ACP command.
    const catalog = resolveAgentCatalog({ config: [{ name: "claude", launchCommand: "my-claude-acp" }] });
    const options = toAgentOptions(catalog, () => false);
    expect(options.find((option) => option.name === "claude")?.available).toBe(false);
    expect(toAgentOptions(catalog, (command) => command === "claude").find((o) => o.name === "claude")?.available).toBe(true);
  });

  it("keeps probing wrapped CLIs for adapter-wired built-ins", () => {
    const wired = withAdapterLaunchCommands(DEFAULT_AGENTS, (a) => `/o/${a}.js`, ["node"]);
    const options = toAgentOptions(wired, (command) => command === "claude");
    const byName = Object.fromEntries(options.map((o) => [o.name, o.available]));
    expect(byName).toEqual({ claude: true, codex: false, grok: false });
  });

  it("does not overwrite grok's explicit launchCommand with an adapter path", () => {
    const wired = withAdapterLaunchCommands(DEFAULT_AGENTS, (a) => `/o/${a}.js`, ["node"]);
    expect(wired.find((a) => a.name === "grok")?.launchCommand).toBe("grok agent stdio");
  });

  it("builds registry overrides from launchCommand (adapter-wired, grok, and custom)", () => {
    const wired = withAdapterLaunchCommands(DEFAULT_AGENTS, (a) => `/o/${a}.js`, ["node"]);
    const overrides = agentRegistryOverrides([...wired, { name: "custom", label: "Custom", command: "c", launchCommand: "node custom.js" }]);
    expect(overrides).toEqual({
      claude: "node /o/claude.js",
      codex: "node /o/codex.js",
      grok: "grok agent stdio",
      custom: "node custom.js",
    });
  });

  it("loadAgentConfigFile returns undefined for a missing or malformed file", async () => {
    expect(await loadAgentConfigFile("/no/such/file.json")).toBeUndefined();
  });

  it("registers the README's documented custom agent example as an available acpx override", () => {
    // Mirrors the agents.json example in README.md. Keep them in sync.
    const config = [{ name: "pi", label: "Pi", launchCommand: "npx pi-acp" }];
    const catalog = withAdapterLaunchCommands(resolveAgentCatalog({ config }), (a) => `/o/${a}.js`, ["node"]);

    expect(agentRegistryOverrides(catalog).pi).toBe("npx pi-acp");
    // No CLI on PATH, yet a launchCommand-only custom agent is still available.
    const pi = toAgentOptions(catalog, () => false).find((option) => option.name === "pi");
    expect(pi).toMatchObject({ name: "pi", label: "Pi", available: true, custom: true, command: "npx pi-acp" });
  });

  it("exposes the built-in agent names", () => {
    expect(BUILT_IN_AGENT_NAMES).toEqual(new Set(["claude", "codex", "grok"]));
  });

  it("toAgentOptions flags custom agents and exposes their launch command", () => {
    const wired = withAdapterLaunchCommands(DEFAULT_AGENTS, (a) => `/o/${a}.js`, ["node"]);
    const catalog = [...wired, { name: "gemini", label: "Gemini", command: "gemini", launchCommand: "gemini acp" }];
    const options = toAgentOptions(catalog, () => false);
    const claude = options.find((o) => o.name === "claude")!;
    const gemini = options.find((o) => o.name === "gemini")!;
    expect(claude.custom).toBe(false);
    expect(claude.command).toBeUndefined();
    expect(gemini.custom).toBe(true);
    expect(gemini.command).toBe("gemini acp");
    expect(gemini.available).toBe(true);
  });

  describe("validateCustomAgentInput", () => {
    it("normalizes a valid input (trims, defaults label to name)", () => {
      expect(validateCustomAgentInput({ name: "  gemini ", command: "  gemini acp " }, [])).toEqual({
        name: "gemini",
        label: "gemini",
        command: "gemini acp",
      });
      expect(validateCustomAgentInput({ name: "g", label: " My G ", command: "g acp" }, []).label).toBe("My G");
    });

    it("rejects an empty name or command", () => {
      expect(() => validateCustomAgentInput({ name: "   ", command: "x" }, [])).toThrow(/name/i);
      expect(() => validateCustomAgentInput({ name: "x", command: "  " }, [])).toThrow(/command/i);
    });

    it("rejects names that collide with a built-in", () => {
      expect(() => validateCustomAgentInput({ name: "claude", command: "x" }, [])).toThrow(/built-in/i);
      expect(() => validateCustomAgentInput({ name: "Codex", command: "x" }, [])).toThrow(/built-in/i);
      expect(() => validateCustomAgentInput({ name: "grok", command: "x" }, [])).toThrow(/built-in/i);
    });

    it("rejects a duplicate custom name (case-insensitive)", () => {
      expect(() => validateCustomAgentInput({ name: "gemini", command: "x" }, ["gemini"])).toThrow(/already/i);
      expect(() => validateCustomAgentInput({ name: "Gemini", command: "x" }, ["gemini"])).toThrow(/already/i);
    });

    it("rejects an invalid id pattern", () => {
      expect(() => validateCustomAgentInput({ name: "has space", command: "x" }, [])).toThrow(/letters|invalid/i);
      expect(() => validateCustomAgentInput({ name: "-bad", command: "x" }, [])).toThrow(/letters|invalid/i);
    });

    it("customAgentToDefinition maps command to launchCommand with no adapter", () => {
      expect(customAgentToDefinition({ name: "gemini", label: "Gemini", command: "gemini acp" })).toEqual({
        name: "gemini",
        label: "Gemini",
        command: "gemini",
        launchCommand: "gemini acp",
      });
    });
  });
});
