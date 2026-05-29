import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENTS,
  resolveAgentCatalog,
  toAgentOptions,
  agentRegistryOverrides,
  withAdapterLaunchCommands,
  loadAgentConfigFile,
  parseAgentDefinitions,
} from "../src/main/agent-catalog";

describe("agent-catalog", () => {
  it("ships claude and codex as the built-in agents (no pi)", () => {
    expect(DEFAULT_AGENTS.map((agent) => agent.name)).toEqual(["claude", "codex"]);
    expect(DEFAULT_AGENTS.map((agent) => agent.adapter)).toEqual(["claude", "codex"]);
  });

  it("derives Settings availability by probing each agent's wrapped CLI", () => {
    const available = (commands: string[]) => {
      const set = new Set(commands);
      return (command: string) => set.has(command);
    };
    const options = toAgentOptions(DEFAULT_AGENTS, available(["claude"]));
    const byName = Object.fromEntries(options.map((o) => [o.name, o.available]));
    expect(byName).toEqual({ claude: true, codex: false });
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

  it("does not override an explicit custom launchCommand", () => {
    const custom = [{ name: "claude", label: "Claude", command: "claude", adapter: "claude" as const, launchCommand: "my-claude" }];
    const wired = withAdapterLaunchCommands(custom, () => "/should/not/be/used");
    expect(wired[0]!.launchCommand).toBe("my-claude");
  });

  it("treats a custom launchCommand override for a built-in name as available", () => {
    const catalog = resolveAgentCatalog({ config: [{ name: "claude", launchCommand: "my-claude-acp" }] });
    const options = toAgentOptions(catalog, () => false);
    expect(options.find((option) => option.name === "claude")?.available).toBe(true);
  });

  it("keeps probing wrapped CLIs for adapter-wired built-ins", () => {
    const wired = withAdapterLaunchCommands(DEFAULT_AGENTS, (a) => `/o/${a}.js`, ["node"]);
    const options = toAgentOptions(wired, (command) => command === "claude");
    const byName = Object.fromEntries(options.map((o) => [o.name, o.available]));
    expect(byName).toEqual({ claude: true, codex: false });
  });

  it("builds registry overrides from launchCommand (adapter-wired and custom)", () => {
    const wired = withAdapterLaunchCommands(DEFAULT_AGENTS, (a) => `/o/${a}.js`, ["node"]);
    const overrides = agentRegistryOverrides([...wired, { name: "custom", label: "Custom", command: "c", launchCommand: "node custom.js" }]);
    expect(overrides).toEqual({
      claude: "node /o/claude.js",
      codex: "node /o/codex.js",
      custom: "node custom.js",
    });
  });

  it("loadAgentConfigFile returns undefined for a missing or malformed file", async () => {
    expect(await loadAgentConfigFile("/no/such/file.json")).toBeUndefined();
  });
});
