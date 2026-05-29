import { readFile } from "node:fs/promises";

export type AgentDefinition = {
  /** acpx agent name and registry key. */
  name: string;
  /** Display name shown in settings. */
  label: string;
  /** CLI command probed with commandExists to decide availability. */
  command: string;
  /** Shown in settings when the agent is unavailable. */
  installHint?: string;
  /** When set, registered as an acpx registry override so a custom command launches this agent. */
  launchCommand?: string;
  /**
   * Built-in clean-room adapter that wraps this agent's CLI. When set, the host
   * injects a `launchCommand` pointing at the bundled adapter at runtime (the
   * path differs dev vs packaged), while availability still probes `command`
   * (the underlying CLI the adapter drives).
   */
  adapter?: "claude" | "codex";
};

export type AgentOption = {
  name: string;
  label: string;
  available: boolean;
  installHint?: string;
};

export const DEFAULT_AGENTS: readonly AgentDefinition[] = [
  {
    name: "claude",
    label: "Claude Code",
    command: "claude",
    adapter: "claude",
    installHint: "Install the Claude Code CLI, then restart Baby Menu.",
  },
  {
    name: "codex",
    label: "Codex",
    command: "codex",
    adapter: "codex",
    installHint: "Install the Codex CLI, then restart Baby Menu.",
  },
];

type ResolveAgentCatalogOptions = {
  /** Parsed contents of agents.json (an array of agent definitions). */
  config?: unknown;
  /** Built-in defaults; overridable for tests. */
  defaults?: readonly AgentDefinition[];
};

export function parseAgentDefinitions(config: unknown): AgentDefinition[] {
  if (!Array.isArray(config)) return [];
  const definitions: AgentDefinition[] = [];
  for (const entry of config) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name) continue;
    const command = typeof candidate.command === "string" ? candidate.command.trim() : "";
    const launchCommand = typeof candidate.launchCommand === "string" ? candidate.launchCommand.trim() : "";
    definitions.push({
      name,
      label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : name,
      command: command || name,
      installHint: typeof candidate.installHint === "string" ? candidate.installHint : undefined,
      launchCommand: launchCommand || undefined,
    });
  }
  return definitions;
}

export function resolveAgentCatalog(options: ResolveAgentCatalogOptions = {}): AgentDefinition[] {
  const defaults = options.defaults ?? DEFAULT_AGENTS;
  const order = defaults.map((agent) => agent.name);
  const byName = new Map<string, AgentDefinition>(defaults.map((agent) => [agent.name, { ...agent }]));

  for (const definition of parseAgentDefinitions(options.config)) {
    const existing = byName.get(definition.name);
    if (!existing) order.push(definition.name);
    byName.set(definition.name, existing ? { ...existing, ...definition, adapter: definition.launchCommand ? undefined : existing.adapter } : definition);
  }

  return order.map((name) => byName.get(name)!);
}

/**
 * Injects the bundled adapter launchCommand for every built-in adapter agent.
 * `resolveAdapterPath("claude")` returns the absolute path to the adapter's
 * bundled entry; the host resolves it differently in dev vs packaged mode.
 * `launcher` is the command + leading args that run the adapter as a Node
 * program (e.g. `["node"]`, or `["env", "ELECTRON_RUN_AS_NODE=1", electronPath]`
 * to run the bundled Electron as Node without depending on a separate install).
 * Agents that already carry an explicit `launchCommand` (custom agents) are left
 * untouched.
 */
export function withAdapterLaunchCommands(
  catalog: readonly AgentDefinition[],
  resolveAdapterPath: (adapter: "claude" | "codex") => string,
  launcher: string[] = ["node"],
): AgentDefinition[] {
  return catalog.map((agent) => {
    if (!agent.adapter || agent.launchCommand) return { ...agent };
    const adapterPath = resolveAdapterPath(agent.adapter);
    return { ...agent, launchCommand: shellJoin([...launcher, adapterPath]) };
  });
}

/** Joins command tokens into a single string, quoting tokens with whitespace. */
function shellJoin(tokens: string[]): string {
  return tokens.map((token) => (/\s/.test(token) ? `"${token}"` : token)).join(" ");
}

export function toAgentOptions(
  catalog: readonly AgentDefinition[],
  commandExists: (command: string) => boolean,
): AgentOption[] {
  return catalog.map((agent) => ({
    name: agent.name,
    label: agent.label,
    available: agent.launchCommand && !agent.adapter ? true : commandExists(agent.command),
    installHint: agent.installHint,
  }));
}

export function agentRegistryOverrides(catalog: readonly AgentDefinition[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const agent of catalog) {
    if (agent.launchCommand) overrides[agent.name] = agent.launchCommand;
  }
  return overrides;
}

export async function loadAgentConfigFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}
