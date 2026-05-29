import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentCatalogController } from "../src/main/agent-catalog-controller";

describe("agent-catalog-controller", () => {
  let dir: string;
  let agentsJsonPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "baby-menu-agents-"));
    agentsJsonPath = join(dir, "agents.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function create(overrides: { active?: string; onChange?: (o: Record<string, string>) => void } = {}) {
    return createAgentCatalogController({
      agentsJsonPath,
      resolveAdapterPath: (adapter) => `/o/${adapter}.js`,
      adapterLauncher: ["node"],
      commandExists: () => true,
      getActiveAgentName: () => overrides.active ?? "claude",
      onOverridesChange: overrides.onChange,
    });
  }

  async function readJson() {
    return JSON.parse(await readFile(agentsJsonPath, "utf8")) as Array<Record<string, unknown>>;
  }

  it("starts with only the built-ins and their adapter overrides", async () => {
    const controller = await create().load();
    expect(controller.options().map((o) => o.name)).toEqual(["claude", "codex"]);
    expect(controller.overrides).toEqual({ claude: "node /o/claude.js", codex: "node /o/codex.js" });
  });

  it("adds a custom agent, persists it, rebuilds overrides, and notifies", async () => {
    const onChange = vi.fn();
    const controller = await create({ onChange }).load();

    const options = controller.options();
    void options;
    await controller.addAgent({ name: "gemini", label: "Gemini", command: "gemini acp" });

    expect(controller.options().find((o) => o.name === "gemini")).toMatchObject({
      name: "gemini",
      label: "Gemini",
      available: true,
      custom: true,
      command: "gemini acp",
    });
    expect(controller.overrides).toEqual({
      claude: "node /o/claude.js",
      codex: "node /o/codex.js",
      gemini: "gemini acp",
    });
    expect(onChange).toHaveBeenLastCalledWith(controller.overrides);
    expect(await readJson()).toEqual([{ name: "gemini", label: "Gemini", command: "gemini", launchCommand: "gemini acp" }]);
  });

  it("loads previously persisted custom agents", async () => {
    const first = await create().load();
    await first.addAgent({ name: "gemini", command: "gemini acp" });

    const second = await create().load();
    expect(second.options().map((o) => o.name)).toEqual(["claude", "codex", "gemini"]);
  });

  it("rejects adding a name that collides with a built-in", async () => {
    const controller = await create().load();
    await expect(controller.addAgent({ name: "claude", command: "x" })).rejects.toThrow(/built-in/i);
  });

  it("updates an existing custom agent's command", async () => {
    const controller = await create().load();
    await controller.addAgent({ name: "gemini", command: "gemini acp" });
    await controller.updateAgent("gemini", { command: "gemini acp --beta", label: "Gemini Beta" });

    expect(controller.overrides.gemini).toBe("gemini acp --beta");
    expect(controller.options().find((o) => o.name === "gemini")?.label).toBe("Gemini Beta");
  });

  it("removes a custom agent and persists the removal", async () => {
    const controller = await create({ active: "claude" }).load();
    await controller.addAgent({ name: "gemini", command: "gemini acp" });
    await controller.removeAgent("gemini");

    expect(controller.options().map((o) => o.name)).toEqual(["claude", "codex"]);
    expect(controller.overrides.gemini).toBeUndefined();
    expect(await readJson()).toEqual([]);
  });

  it("refuses to remove the currently active agent", async () => {
    const controller = await create({ active: "gemini" }).load();
    await controller.addAgent({ name: "gemini", command: "gemini acp" });
    await expect(controller.removeAgent("gemini")).rejects.toThrow(/active|switch/i);
    expect(controller.options().find((o) => o.name === "gemini")).toBeTruthy();
  });
});
