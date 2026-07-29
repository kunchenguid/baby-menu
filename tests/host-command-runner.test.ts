import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GITHUB_CONTRIBUTION_GRAPH_ARGS,
  GITHUB_CONTRIBUTION_GRAPH_OPERATION,
  createHostCommandRunner,
} from "../src/main/host-command-runner";

const GRAPH_QUERY = "query { viewer { login contributionsCollection { contributionCalendar { totalContributions } } } }";

describe("host command runner", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("runs a configured executable wrapper directly with fixed argv and bounded output", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "github-helper");
    const argvLog = join(rootDir, "argv.log");
    await writeFile(
      helper,
      `#!/bin/sh\nprintf '%s\\0' "$@" > ${shellQuote(argvLog)}\nprintf '{"data":{"viewer":{"login":"expected-account"}}}\\n'\n`,
    );
    await chmod(helper, 0o700);
    const args = ["api", "graphql", "-f", `query=${GRAPH_QUERY}`];
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      operationPolicies: [
        {
          extensionId: "github-graph",
          action: "getGraph",
          operation: "github.contributionGraph",
          command: "gh",
          args,
        },
      ],
      resolveExecutable: async (command) => (command === "gh" ? { executable: helper, overridden: true } : command),
    });

    const result = await runner.execFile("gh", args, {
      operation: "github.contributionGraph",
      timeoutMs: 15_000,
      maxBufferBytes: 8 * 1024 * 1024,
    });

    expect(JSON.parse(result.stdout).data.viewer.login).toBe("expected-account");
    expect(result.stderr).toBe("");
    expect((await readFile(argvLog)).toString().split("\0").filter(Boolean)).toEqual(args);
  });

  it("passes shell metacharacters as one literal argument without evaluating them", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "literal-argv-helper");
    const argvLog = join(rootDir, "literal-argv.log");
    const injectedFile = join(rootDir, "must-not-exist");
    await writeFile(helper, `#!/bin/sh\nprintf '%s\\0' "$@" > ${shellQuote(argvLog)}\n`);
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({ resolveExecutable: async () => ({ executable: helper, overridden: false }) });
    const argument = `; touch ${injectedFile}`;

    await runner.execFile("literal-helper", [argument]);

    expect((await readFile(argvLog)).toString().split("\0").filter(Boolean)).toEqual([argument]);
    await expect(readFile(injectedFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("terminates a timed-out helper and reports a deterministic error", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, `slow-helper-${crypto.randomUUID()}`);
    // Use only shell built-ins so the unique helper path identifies the complete
    // invocation and no child process can mask an orphaned helper.
    await writeFile(helper, "#!/bin/sh\nwhile :; do :; done\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({ resolveExecutable: async () => ({ executable: helper, overridden: false }) });

    await expect(runner.execFile("slow-helper", [], { timeoutMs: 500 })).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_TIMEOUT",
      message: "Command timed out after 500 milliseconds.",
    });
    const processCommands = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
    expect(processCommands).not.toContain(helper);
  });

  it("reports a deterministic error when command output exceeds the requested bound", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "large-output-helper");
    await writeFile(helper, "#!/bin/sh\nhead -c 1024 /dev/zero\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({ resolveExecutable: async () => ({ executable: helper, overridden: false }) });

    await expect(runner.execFile("large-output-helper", [], { maxBufferBytes: 64 })).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_OUTPUT_LIMIT",
      message: "Command output exceeded 64 bytes.",
    });
  });

  it("rejects unbounded output, timeout, and malformed argv requests before resolution", async () => {
    const resolveExecutable = vi.fn(async (command: string) => command);
    const runner = createHostCommandRunner({ resolveExecutable });

    await expect(runner.execFile("gh", [], { timeoutMs: 30_001 })).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_OPTIONS",
    });
    await expect(runner.execFile("gh", [], { maxBufferBytes: 8 * 1024 * 1024 + 1 })).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_OPTIONS",
    });
    await expect(runner.execFile("gh", ["contains\0nul"])).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_ARGUMENTS",
    });
    await expect(runner.execFile(null as never, [])).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_NAME",
    });
    await expect(runner.execFile("gh", [], null as never)).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_OPTIONS",
    });
    expect(resolveExecutable).not.toHaveBeenCalled();
  });

  it("reports a deterministic nonzero-exit error while preserving bounded stderr", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "failing-helper");
    await writeFile(helper, "#!/bin/sh\nprintf 'GitHub sign-in required\\n' >&2\nexit 7\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({ resolveExecutable: async () => ({ executable: helper, overridden: false }) });

    await expect(runner.execFile("failing-helper", [])).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_FAILED",
      exitCode: 7,
      message: 'Command "failing-helper" exited with status 7.',
      stderr: "GitHub sign-in required\n",
    });
  });

  it("fails a missing configured helper without falling back to the bare command", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const args: string[] = [];
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      operationPolicies: [
        {
          extensionId: "github-graph",
          action: "getGraph",
          operation: "github.contributionGraph",
          command: "gh",
          args,
        },
      ],
      resolveExecutable: async () => ({ executable: join(rootDir, "missing-helper"), overridden: true }),
    });

    await expect(runner.execFile("gh", args, { operation: "github.contributionGraph" })).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects credential-oriented argv before launching a configured helper", async () => {
    const resolveExecutable = vi.fn(async () => ({ executable: "/never/launched", overridden: true }));
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable,
    });

    await expect(
      runner.execFile("gh", ["auth", "token"], { operation: GITHUB_CONTRIBUTION_GRAPH_OPERATION }),
    ).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
      message: "The configured command helper is not authorized for this extension operation.",
    });
  });

  it("allows bare gh migration only for the exact GitHub contribution graph policy", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "bare-gh");
    await writeFile(helper, "#!/bin/sh\nprintf '{\"data\":{\"viewer\":{\"login\":\"bare-account\"}}}\\n'\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: false }),
    });

    const result = await runner.execFile("gh", GITHUB_CONTRIBUTION_GRAPH_ARGS, {
      operation: GITHUB_CONTRIBUTION_GRAPH_OPERATION,
    });

    expect(JSON.parse(result.stdout).data.viewer.login).toBe("bare-account");
  });

  it("rejects same-extension alternate argv for the GitHub contribution graph helper", async () => {
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: "/never/launched", overridden: true }),
    });

    await expect(
      runner.execFile("gh", ["api", "user"], { operation: GITHUB_CONTRIBUTION_GRAPH_OPERATION }),
    ).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
  });

  it("rejects unrelated extensions and actions for the configured GitHub helper", async () => {
    const resolveExecutable = async () => ({ executable: "/never/launched", overridden: true });
    const unrelatedExtension = createHostCommandRunner({
      caller: { extensionId: "other-extension", action: "getGraph" },
      resolveExecutable,
    });
    const unrelatedAction = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "refresh" },
      resolveExecutable,
    });

    await expect(
      unrelatedExtension.execFile("gh", GITHUB_CONTRIBUTION_GRAPH_ARGS, {
        operation: GITHUB_CONTRIBUTION_GRAPH_OPERATION,
      }),
    ).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
    await expect(
      unrelatedAction.execFile("gh", GITHUB_CONTRIBUTION_GRAPH_ARGS, {
        operation: GITHUB_CONTRIBUTION_GRAPH_OPERATION,
      }),
    ).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
  });

  it("rejects configured helpers without a server-action caller, including background tasks", async () => {
    const runner = createHostCommandRunner({
      resolveExecutable: async () => ({ executable: "/never/launched", overridden: true }),
    });

    await expect(
      runner.execFile("gh", GITHUB_CONTRIBUTION_GRAPH_ARGS, { operation: GITHUB_CONTRIBUTION_GRAPH_OPERATION }),
    ).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
    });
  });

  it("rejects path and shell syntax in logical command names before resolution", async () => {
    const resolveExecutable = vi.fn(async (command: string) => command);
    const runner = createHostCommandRunner({ resolveExecutable });

    await expect(runner.execFile("gh; touch /tmp/injected", [])).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_INVALID_NAME",
      message: "Command names must contain only letters, numbers, dot, dash, underscore, or plus.",
    });
    expect(resolveExecutable).not.toHaveBeenCalled();
  });
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
