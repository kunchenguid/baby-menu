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
    installHint: "Install the Claude Code CLI, then restart Baby Menu.",
  },
  {
    name: "pi",
    label: "Pi",
    command: "npx",
    installHint: "Install Node.js (provides npx), then restart Baby Menu.",
  },
  {
    name: "codex",
    label: "Codex",
    command: "codex",
    installHint: "Install the Codex CLI, then restart Baby Menu.",
  },
];

type ResolveAgentCatalogOptions = {
  /** Parsed contents of agents.json (an array of agent definitions). */
  config?: unknown;
  /** Built-in defaults; overridable for tests. */
  defaults?: readonly AgentDefinition[];
};

function parseAgentDefinitions(config: unknown): AgentDefinition[] {
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
    byName.set(definition.name, existing ? { ...existing, ...definition } : definition);
  }

  return order.map((name) => byName.get(name)!);
}

export function toAgentOptions(
  catalog: readonly AgentDefinition[],
  commandExists: (command: string) => boolean,
): AgentOption[] {
  return catalog.map((agent) => ({
    name: agent.name,
    label: agent.label,
    available: agent.launchCommand ? true : commandExists(agent.command),
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
