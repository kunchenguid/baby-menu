import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostCommandRunner } from "../src/main/host-command-runner";
import { createPreferencesService } from "../src/main/preferences";
import { createServerActionRegistry } from "../src/main/server-action-registry";

const GRAPH_QUERY = `{
  viewer {
    login
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { firstDay contributionDays { date contributionCount weekday } }
      }
    }
  }
}`;

const BARE_GH_SERVER = `
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const QUERY = ${JSON.stringify(GRAPH_QUERY)};
export const actions = {
  getGraph: async () => {
    try {
      const { stdout } = await execFileAsync("gh", ["api", "graphql", "-f", \`query=\${QUERY}\`], {
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { ok: true, data: JSON.parse(stdout) };
    } catch (error) {
      return { ok: false, error: String(error?.stderr ?? error?.message ?? error) };
    }
  },
};
`;

const HOST_ROUTED_GH_SERVER = `
const QUERY = ${JSON.stringify(GRAPH_QUERY)};
export const actions = {
  getGraph: async (_input, context) => {
    const { stdout } = await context.commands.execFile(
      "gh",
      ["api", "graphql", "-f", \`query=\${QUERY}\`],
      { operation: "github.contributionGraph", timeoutMs: 15_000, maxBufferBytes: 8 * 1024 * 1024 },
    );
    return { ok: true, data: JSON.parse(stdout) };
  },
};
`;

describe("GitHub command routing E2E", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reproduces the installed extension bypassing a configured helper and reaching bare gh", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const rawGhLog = join(rootDir, "raw-gh.log");
    const configuredHelperLog = join(rootDir, "configured-helper.log");
    const binDir = join(rootDir, "bin");
    const actionPath = join(rootDir, "extensions", "github-graph", "server.ts");
    await mkdir(binDir, { recursive: true });
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(
      join(binDir, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${shellQuote(rawGhLog)}\nprintf 'Automic Vault approval required\\n' >&2\nexit 75\n`,
    );
    await writeExecutable(
      join(rootDir, "configured-github-helper"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${shellQuote(configuredHelperLog)}\nprintf '{"data":{"viewer":{"login":"expected-account"}}}\\n'\n`,
    );
    await writeFile(actionPath, BARE_GH_SERVER);
    await writeFile(
      join(rootDir, "preferences.json"),
      `${JSON.stringify({ openAtLogin: false, commandOverrides: { gh: join(rootDir, "configured-github-helper") } }, null, 2)}\n`,
    );
    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);

    const registry = createServerActionRegistry({ rootDir });
    const result = await registry.invoke("github-graph", "getGraph", {});

    expect(result).toEqual({ ok: false, error: expect.stringContaining("Automic Vault approval required") });
    await expect(readFile(rawGhLog, "utf8")).resolves.toBe(`api\ngraphql\n-f\nquery=${GRAPH_QUERY}\n`);
    await expect(readFile(configuredHelperLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("migrates existing preferences by preserving normal host command resolution when no override exists", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const hostGhLog = join(rootDir, "host-gh.log");
    const binDir = join(rootDir, "bin");
    const actionPath = join(rootDir, "extensions", "github-graph", "server.ts");
    await mkdir(binDir, { recursive: true });
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(
      join(binDir, "gh"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${shellQuote(hostGhLog)}\nprintf '{"data":{"viewer":{"login":"expected-account"}}}\\n'\n`,
    );
    await writeFile(actionPath, HOST_ROUTED_GH_SERVER);
    await writeFile(join(rootDir, "preferences.json"), '{"openAtLogin":false}\n');
    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);
    const preferences = createPreferencesService({
      userDataDir: rootDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    });
    const commands = createHostCommandRunner({
      resolveExecutable: (command) => preferences.resolveCommandExecutable(command),
    });
    const registry = createServerActionRegistry({ rootDir, commands });

    await expect(registry.invoke("github-graph", "getGraph", {})).resolves.toEqual({
      ok: true,
      data: { data: { viewer: { login: "expected-account" } } },
    });
    await expect(readFile(hostGhLog, "utf8")).resolves.toBe(`api\ngraphql\n-f\nquery=${GRAPH_QUERY}\n`);
  });

  it("fails a malformed configured override closed instead of falling back to bare gh", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const rawGhLog = join(rootDir, "raw-gh.log");
    const binDir = join(rootDir, "bin");
    const actionPath = join(rootDir, "extensions", "github-graph", "server.ts");
    await mkdir(binDir, { recursive: true });
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(join(binDir, "gh"), `#!/bin/sh\nprintf 'called\\n' > ${shellQuote(rawGhLog)}\n`);
    await writeFile(actionPath, HOST_ROUTED_GH_SERVER);
    await writeFile(
      join(rootDir, "preferences.json"),
      '{"openAtLogin":false,"commandOverrides":{"gh":"relative/helper"}}\n',
    );
    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);
    const preferences = createPreferencesService({
      userDataDir: rootDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    });
    const commands = createHostCommandRunner({
      resolveExecutable: (command) => preferences.resolveCommandExecutable(command),
    });
    const registry = createServerActionRegistry({ rootDir, commands });

    await expect(registry.invoke("github-graph", "getGraph", {})).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_OVERRIDE",
    });
    await expect(readFile(rawGhLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("routes the extension's fixed GraphQL operation through the configured helper without reaching bare gh", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const rawGhLog = join(rootDir, "raw-gh.log");
    const configuredHelperLog = join(rootDir, "configured-helper.log");
    const binDir = join(rootDir, "bin");
    const helper = join(rootDir, "configured-github-helper");
    const actionPath = join(rootDir, "extensions", "github-graph", "server.ts");
    await mkdir(binDir, { recursive: true });
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(
      join(binDir, "gh"),
      `#!/bin/sh\nprintf 'vault prompt\\n' > ${shellQuote(rawGhLog)}\nexit 75\n`,
    );
    await writeExecutable(
      helper,
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${shellQuote(configuredHelperLog)}\nprintf '{"data":{"viewer":{"login":"expected-account"}}}\\n'\n`,
    );
    await writeFile(actionPath, HOST_ROUTED_GH_SERVER);
    vi.stubEnv("PATH", `${binDir}:${process.env.PATH ?? ""}`);
    const preferences = createPreferencesService({
      userDataDir: rootDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    });
    await preferences.setCommandOverride({ command: "gh", executable: helper });
    const commands = createHostCommandRunner({
      resolveExecutable: (command) => preferences.resolveCommandExecutable(command),
    });
    const registry = createServerActionRegistry({ rootDir, commands });

    const result = await registry.invoke("github-graph", "getGraph", { args: ["auth", "token"] });

    expect(result).toEqual({ ok: true, data: { data: { viewer: { login: "expected-account" } } } });
    await expect(readFile(configuredHelperLog, "utf8")).resolves.toBe(
      `api\ngraphql\n-f\nquery=${GRAPH_QUERY}\n`,
    );
    await expect(readFile(rawGhLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects same-extension auth token argv before invoking a configured helper", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const helperLog = join(rootDir, "configured-helper.log");
    const helper = join(rootDir, "configured-github-helper");
    const actionPath = join(rootDir, "extensions", "github-graph", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(helper, `#!/bin/sh\nprintf '%s\\n' "$@" > ${shellQuote(helperLog)}\n`);
    await writeFile(
      actionPath,
      `export const actions = {
        getGraph: (_input, context) => context.commands.execFile(
          "gh",
          ["auth", "token"],
          { operation: "github.contributionGraph" },
        ),
      };`,
    );
    const preferences = createPreferencesService({
      userDataDir: rootDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    });
    await preferences.setCommandOverride({ command: "gh", executable: helper });
    const commands = createHostCommandRunner({
      resolveExecutable: (command) => preferences.resolveCommandExecutable(command),
    });
    const registry = createServerActionRegistry({ rootDir, commands });

    await expect(registry.invoke("github-graph", "getGraph", {})).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
    await expect(readFile(helperLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unrelated extensions before invoking a configured helper", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const helperLog = join(rootDir, "configured-helper.log");
    const helper = join(rootDir, "configured-github-helper");
    const actionPath = join(rootDir, "extensions", "unrelated", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(helper, `#!/bin/sh\nprintf '%s\\n' "$@" > ${shellQuote(helperLog)}\n`);
    await writeFile(actionPath, HOST_ROUTED_GH_SERVER);
    const preferences = createPreferencesService({
      userDataDir: rootDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    });
    await preferences.setCommandOverride({ command: "gh", executable: helper });
    const commands = createHostCommandRunner({
      resolveExecutable: (command) => preferences.resolveCommandExecutable(command),
    });
    const registry = createServerActionRegistry({ rootDir, commands });

    await expect(registry.invoke("unrelated", "getGraph", {})).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
    await expect(readFile(helperLog, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a fresh expected-account snapshot across four cold host cycles with no helper left running", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-github-routing-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, `configured-github-helper-${crypto.randomUUID()}`);
    const counterFile = join(rootDir, "helper-counter");
    const invocationLog = join(rootDir, "helper-invocations.log");
    const actionPath = join(rootDir, "extensions", "github-graph", "server.ts");
    await mkdir(dirname(actionPath), { recursive: true });
    await writeExecutable(
      helper,
      `#!/bin/sh\ncount=0\n[ ! -f ${shellQuote(counterFile)} ] || count=$(cat ${shellQuote(counterFile)})\ncount=$((count + 1))\nprintf '%s' "$count" > ${shellQuote(counterFile)}\nprintf '%s %s\\n' "$$" "$count" >> ${shellQuote(invocationLog)}\nprintf '{"data":{"viewer":{"login":"expected-account","snapshot":%s}}}\\n' "$count"\n`,
    );
    await writeFile(actionPath, HOST_ROUTED_GH_SERVER);
    const preferences = createPreferencesService({
      userDataDir: rootDir,
      app: { setLoginItemSettings: vi.fn() },
      defaultOpenAtLogin: false,
    });
    await preferences.setCommandOverride({ command: "gh", executable: helper });

    const snapshots: number[] = [];
    for (let cycle = 1; cycle <= 4; cycle += 1) {
      // Recreate every host-owned service to model a complete quit and reopen.
      const relaunchedPreferences = createPreferencesService({
        userDataDir: rootDir,
        app: { setLoginItemSettings: vi.fn() },
        defaultOpenAtLogin: false,
      });
      const commands = createHostCommandRunner({
        resolveExecutable: (command) => relaunchedPreferences.resolveCommandExecutable(command),
      });
      const registry = createServerActionRegistry({ rootDir, commands });
      const result = (await registry.invoke("github-graph", "getGraph", {})) as {
        data: { data: { viewer: { login: string; snapshot: number } } };
      };
      expect(result.data.data.viewer.login).toBe("expected-account");
      snapshots.push(result.data.data.viewer.snapshot);
      expect(execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" })).not.toContain(helper);
    }

    expect(snapshots).toEqual([1, 2, 3, 4]);
    expect((await readFile(invocationLog, "utf8")).trim().split("\n")).toHaveLength(4);
  });
});

async function writeExecutable(filePath: string, source: string): Promise<void> {
  await writeFile(filePath, source);
  await chmod(filePath, 0o700);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
