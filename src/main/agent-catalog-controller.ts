import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BabyMenuCustomAgentInput } from "../shared/contracts";
import {
  type AgentDefinition,
  type AgentOption,
  agentRegistryOverrides,
  customAgentToDefinition,
  loadAgentConfigFile,
  parseAgentDefinitions,
  resolveAgentCatalog,
  toAgentOptions,
  validateCustomAgentInput,
  withAdapterLaunchCommands,
} from "./agent-catalog";

export type AgentCatalogControllerOptions = {
  /** Path to the user-owned agents.json (repo root in dev, ~/.baby-menu packaged). */
  agentsJsonPath: string;
  resolveAdapterPath: (adapter: "claude" | "codex") => string;
  adapterLauncher: string[];
  commandExists: (command: string) => boolean;
  /** The currently selected agent name; removal of the active agent is refused. */
  getActiveAgentName: () => string;
  /** Called whenever the registry overrides change so the runtime can pick them up live. */
  onOverridesChange?: (overrides: Record<string, string>) => void | Promise<void>;
};

export type AgentCatalogController = {
  /** Reads agents.json and builds the initial catalog. Returns the controller. */
  load: () => Promise<AgentCatalogController>;
  readonly catalog: readonly AgentDefinition[];
  readonly overrides: Record<string, string>;
  options: () => AgentOption[];
  addAgent: (input: BabyMenuCustomAgentInput) => Promise<void>;
  updateAgent: (name: string, input: { label?: string; command: string }) => Promise<void>;
  removeAgent: (name: string) => Promise<void>;
};

/**
 * Owns the live agent catalog: the code-defined built-ins plus the user's custom
 * ACP agents persisted in agents.json. Mutations validate, rewrite agents.json,
 * rebuild the catalog and acpx registry overrides, and notify via onOverridesChange
 * so a newly added/edited agent applies immediately (no app restart).
 */
export function createAgentCatalogController(options: AgentCatalogControllerOptions): AgentCatalogController {
  let customs: AgentDefinition[] = [];
  let catalog: AgentDefinition[] = [];
  let overrides: Record<string, string> = {};

  function rebuild(): void {
    catalog = withAdapterLaunchCommands(
      resolveAgentCatalog({ config: customs }),
      options.resolveAdapterPath,
      options.adapterLauncher,
    );
    overrides = agentRegistryOverrides(catalog);
  }

  async function persist(): Promise<void> {
    await mkdir(dirname(options.agentsJsonPath), { recursive: true });
    await writeFile(options.agentsJsonPath, `${JSON.stringify(customs.map(serializeDefinition), null, 2)}\n`);
  }

  async function commit(next: AgentDefinition[]): Promise<void> {
    customs = next;
    await persist();
    rebuild();
    await options.onOverridesChange?.(overrides);
  }

  const controller: AgentCatalogController = {
    async load() {
      customs = parseAgentDefinitions(await loadAgentConfigFile(options.agentsJsonPath));
      rebuild();
      return controller;
    },
    get catalog() {
      return catalog;
    },
    get overrides() {
      return overrides;
    },
    options() {
      return toAgentOptions(catalog, options.commandExists);
    },
    async addAgent(input) {
      const validated = validateCustomAgentInput(input, customs.map((agent) => agent.name));
      await commit([...customs, customAgentToDefinition(validated)]);
    },
    async updateAgent(name, input) {
      if (!customs.some((agent) => agent.name === name)) {
        throw new Error(`No custom agent named "${name}".`);
      }
      // Validate against the other customs so the unchanged id is allowed.
      const others = customs.filter((agent) => agent.name !== name).map((agent) => agent.name);
      const validated = validateCustomAgentInput({ name, label: input.label, command: input.command }, others);
      await commit(customs.map((agent) => (agent.name === name ? customAgentToDefinition(validated) : agent)));
    },
    async removeAgent(name) {
      if (options.getActiveAgentName() === name) {
        throw new Error("This agent is active. Switch to another agent before removing it.");
      }
      await commit(customs.filter((agent) => agent.name !== name));
    },
  };

  return controller;
}

/** Serializes a custom AgentDefinition back to agents.json, dropping empty fields. */
function serializeDefinition(agent: AgentDefinition): Record<string, string> {
  const entry: Record<string, string> = { name: agent.name, label: agent.label, command: agent.command };
  if (agent.launchCommand) entry.launchCommand = agent.launchCommand;
  if (agent.installHint) entry.installHint = agent.installHint;
  return entry;
}
