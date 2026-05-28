import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENTS,
  agentRegistryOverrides,
  loadAgentConfigFile,
  resolveAgentCatalog,
  toAgentOptions,
} from "../src/main/agent-catalog";

function available(commands: string[]) {
  const commandSet = new Set(commands);
  return (command: string) => commandSet.has(command);
}

describe("agent catalog", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("returns the built-in agents when no config is provided", () => {
    expect(resolveAgentCatalog().map((agent) => agent.name)).toEqual(
      DEFAULT_AGENTS.map((agent) => agent.name),
    );
  });

  it("overrides a built-in agent by name while keeping order", () => {
    const catalog = resolveAgentCatalog({
      config: [{ name: "claude", label: "My Claude", command: "claude-custom" }],
    });

    expect(catalog.map((agent) => agent.name)).toEqual(DEFAULT_AGENTS.map((agent) => agent.name));
    const claude = catalog.find((agent) => agent.name === "claude");
    expect(claude).toMatchObject({ label: "My Claude", command: "claude-custom" });
  });

  it("appends new agents from config after the built-ins", () => {
    const catalog = resolveAgentCatalog({
      config: [{ name: "gemini", label: "Gemini", command: "gemini" }],
    });

    expect(catalog.map((agent) => agent.name)).toEqual([
      ...DEFAULT_AGENTS.map((agent) => agent.name),
      "gemini",
    ]);
  });

  it("ignores malformed config entries", () => {
    const catalog = resolveAgentCatalog({
      config: [{ label: "no name" }, 42, null, { name: "ok", label: "Ok", command: "ok" }],
    });

    expect(catalog.map((agent) => agent.name)).toEqual([
      ...DEFAULT_AGENTS.map((agent) => agent.name),
      "ok",
    ]);
  });

  it("builds registry overrides only for agents with a launch command", () => {
    const catalog = resolveAgentCatalog({
      config: [{ name: "mock", label: "Mock", command: "mock", launchCommand: "node ./mock.js" }],
    });

    expect(agentRegistryOverrides(catalog)).toEqual({ mock: "node ./mock.js" });
  });

  it("marks agents available when their command is on PATH", () => {
    const options = toAgentOptions(resolveAgentCatalog(), available(["claude"]));
    const byName = Object.fromEntries(options.map((option) => [option.name, option.available]));

    expect(byName.claude).toBe(true);
    expect(byName.codex).toBe(false);
  });

  it("treats agents with an explicit launch command as available", () => {
    const catalog = resolveAgentCatalog({
      config: [{ name: "mock", label: "Mock", command: "definitely-missing", launchCommand: "node ./mock.js" }],
    });
    const options = toAgentOptions(catalog, available([]));

    expect(options.find((option) => option.name === "mock")?.available).toBe(true);
  });

  it("exposes the install hint on options", () => {
    const catalog = resolveAgentCatalog({
      config: [{ name: "gemini", label: "Gemini", command: "gemini", installHint: "brew install gemini" }],
    });
    const options = toAgentOptions(catalog, available([]));

    expect(options.find((option) => option.name === "gemini")?.installHint).toBe("brew install gemini");
  });

  it("reads agents.json from disk and returns undefined when missing or invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baby-menu-agents-"));
    tempDirs.push(dir);

    await expect(loadAgentConfigFile(join(dir, "agents.json"))).resolves.toBeUndefined();

    await writeFile(join(dir, "agents.json"), "{ not json");
    await expect(loadAgentConfigFile(join(dir, "agents.json"))).resolves.toBeUndefined();

    await writeFile(join(dir, "agents.json"), JSON.stringify([{ name: "gemini", label: "Gemini", command: "gemini" }]));
    const config = await loadAgentConfigFile(join(dir, "agents.json"));
    expect(resolveAgentCatalog({ config }).some((agent) => agent.name === "gemini")).toBe(true);
  });
});
