import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GITHUB_CONTRIBUTION_GRAPH_ARGS, createHostCommandRunner } from "../src/main/host-command-runner";

describe("host command runner", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("runs a configured executable wrapper directly with host-owned GitHub graph argv", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "github-helper");
    const argvLog = join(rootDir, "argv.log");
    await writeFile(
      helper,
      `#!/bin/sh\nprintf '%s\\0' "$@" > ${shellQuote(argvLog)}\nprintf '%s\\n' ${shellQuote(validGraphJson("expected-account"))}\nprintf 'diagnostic token ghp_secret\\n' >&2\n`,
    );
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async (command) => (command === "gh" ? { executable: helper, overridden: true } : command),
    });

    const result = await runner.getGitHubContributionGraph();

    expect(result).toEqual(validGraph("expected-account"));
    expect((await readFile(argvLog)).toString().split("\0").filter(Boolean)).toEqual(GITHUB_CONTRIBUTION_GRAPH_ARGS);
  });

  it("reports a deterministic error when command output exceeds the host-owned bound", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "large-output-helper");
    await writeFile(helper, "#!/bin/sh\nhead -c 9437184 /dev/zero\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_OUTPUT_LIMIT",
      message: "Command output exceeded 8388608 bytes.",
    });
  });

  it("terminates helper descendants before resolving an output-limit error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, `flood-helper-${crypto.randomUUID()}`);
    const descendantToken = `baby-menu-descendant-${crypto.randomUUID()}`;
    await writeFile(
      helper,
      `#!/bin/sh\nnode -e 'setInterval(() => {}, 1000)' ${shellQuote(descendantToken)} &\nnode -e 'process.stdout.write(Buffer.alloc(9437184))'\nsleep 60\n`,
    );
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      commandExecOptions: { maxBufferBytes: 1024 },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_OUTPUT_LIMIT",
    });

    await expectNoProcessContaining(descendantToken);
    await expectNoProcessContaining(helper);
  });

  it("terminates helper descendants before resolving a timeout error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, `timeout-helper-${crypto.randomUUID()}`);
    const descendantToken = `baby-menu-descendant-${crypto.randomUUID()}`;
    await writeFile(helper, `#!/bin/sh\nnode -e 'setInterval(() => {}, 1000)' ${shellQuote(descendantToken)} &\nsleep 60\n`);
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      commandExecOptions: { timeoutMs: 250 },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_TIMEOUT",
      message: "Command timed out after 250 milliseconds.",
    });

    await expectNoProcessContaining(descendantToken);
    await expectNoProcessContaining(helper);
  });

  it("reports a deterministic nonzero-exit error without exposing stderr", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "failing-helper");
    await writeFile(helper, "#!/bin/sh\nprintf 'GitHub sign-in required\\n' >&2\nexit 7\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    const failure = await runner.getGitHubContributionGraph().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "BABY_MENU_COMMAND_FAILED",
      exitCode: 7,
      message: 'Command "gh" exited with status 7.',
    });
    expect(failure).not.toHaveProperty("stdout");
    expect(failure).not.toHaveProperty("stderr");
  });

  it("fails a missing configured helper without falling back to the bare command", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: join(rootDir, "missing-helper"), overridden: true }),
    });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_LAUNCH_FAILED",
    });
  });

  it("allows bare gh migration only for the exact GitHub contribution graph policy", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "bare-gh");
    await writeFile(helper, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(validGraphJson("bare-account"))}\n`);
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: false }),
    });

    const result = await runner.getGitHubContributionGraph();

    expect(result).toEqual(validGraph("bare-account"));
  });

  it("returns only normalized calendar data and drops extra helper fields", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "extra-fields-helper");
    await writeFile(
      helper,
      `#!/bin/sh\nprintf '%s\\n' ${shellQuote(
        JSON.stringify({
          data: {
            viewer: {
              login: "expected-account",
              token: "ghp_secret_from_stdout",
              contributionsCollection: {
                contributionCalendar: {
                  totalContributions: 3,
                  weeks: [
                    {
                      firstDay: "2026-07-26",
                      leaked: "gho_secret",
                      contributionDays: [
                        { date: "2026-07-29", contributionCount: 3, weekday: 3, secret: "github_pat_secret" },
                      ],
                    },
                  ],
                },
              },
            },
          },
          private: "ghs_secret",
        }),
      )}\n`,
    );
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    const result = await runner.getGitHubContributionGraph();

    expect(result).toEqual(validGraph("expected-account"));
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects malformed JSON without exposing raw stdout", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "malformed-json-helper");
    await writeFile(helper, "#!/bin/sh\nprintf 'ghp_secret_not_json\\n'\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    const failure = await runner.getGitHubContributionGraph().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "BABY_MENU_GITHUB_GRAPH_INVALID_JSON",
      message: "GitHub contribution graph response was not valid JSON.",
    });
    expect(failure).not.toHaveProperty("stdout");
    expect(JSON.stringify(failure)).not.toContain("ghp_secret_not_json");
  });

  it("rejects GraphQL errors without exposing error payload text", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "graphql-error-helper");
    await writeFile(helper, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(JSON.stringify({ errors: [{ message: "ghp_secret_denied" }] }))}\n`);
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    const failure = await runner.getGitHubContributionGraph().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "BABY_MENU_GITHUB_GRAPH_GRAPHQL_ERROR",
      message: "GitHub contribution graph query returned an error.",
    });
    expect(JSON.stringify(failure)).not.toContain("ghp_secret_denied");
  });

  it("rejects token-like values in expected fields", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "token-login-helper");
    await writeFile(helper, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(validGraphJson("ghp_secret_token"))}\n`);
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    const failure = await runner.getGitHubContributionGraph().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA",
      message: "GitHub contribution graph response had an unexpected schema.",
    });
    expect(JSON.stringify(failure)).not.toContain("ghp_secret_token");
  });

  it("rejects unrelated extensions and actions before resolving any helper", async () => {
    const resolveExecutable = vi.fn(async () => ({ executable: "/never/launched", overridden: true }));
    const unrelatedExtension = createHostCommandRunner({
      caller: { extensionId: "other-extension", action: "getGraph" },
      resolveExecutable,
    });
    const unrelatedAction = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "refresh" },
      resolveExecutable,
    });

    await expect(unrelatedExtension.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
    await expect(unrelatedAction.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
    expect(resolveExecutable).not.toHaveBeenCalled();
  });

  it("rejects calls without a server-action caller, including background tasks", async () => {
    const resolveExecutable = vi.fn(async () => ({ executable: "/never/launched", overridden: true }));
    const runner = createHostCommandRunner({ resolveExecutable });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
    expect(resolveExecutable).not.toHaveBeenCalled();
  });

  it("does not expose a public arbitrary argv command runner", () => {
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
    });

    expect("execFile" in runner).toBe(false);
  });

  it("does not leave a completed helper process running", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, `github-helper-${crypto.randomUUID()}`);
    await writeFile(helper, `#!/bin/sh\nprintf '%s\\n' ${shellQuote(validGraphJson("expected-account"))}\n`);
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    await runner.getGitHubContributionGraph();

    const processCommands = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
    expect(processCommands).not.toContain(helper);
  });
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function validGraph(login: string) {
  return {
    login,
    totalContributions: 3,
    weeks: [
      {
        firstDay: "2026-07-26",
        contributionDays: [{ date: "2026-07-29", contributionCount: 3, weekday: 3 }],
      },
    ],
  };
}

function validGraphJson(login: string): string {
  return JSON.stringify({
    data: {
      viewer: {
        login,
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: 3,
            weeks: [
              {
                firstDay: "2026-07-26",
                contributionDays: [{ date: "2026-07-29", contributionCount: 3, weekday: 3 }],
              },
            ],
          },
        },
      },
    },
  });
}

async function expectNoProcessContaining(pattern: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const processCommands = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
    if (!processCommands.includes(pattern)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const processCommands = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
  expect(processCommands).not.toContain(pattern);
}
