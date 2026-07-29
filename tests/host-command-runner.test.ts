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
      `#!/bin/sh\nprintf '%s\\0' "$@" > ${shellQuote(argvLog)}\nprintf '{"data":{"viewer":{"login":"expected-account"}}}\\n'\n`,
    );
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async (command) => (command === "gh" ? { executable: helper, overridden: true } : command),
    });

    const result = await runner.getGitHubContributionGraph();

    expect(JSON.parse(result.stdout).data.viewer.login).toBe("expected-account");
    expect(result.stderr).toBe("");
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

  it("reports a deterministic nonzero-exit error while preserving bounded stderr", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const helper = join(rootDir, "failing-helper");
    await writeFile(helper, "#!/bin/sh\nprintf 'GitHub sign-in required\\n' >&2\nexit 7\n");
    await chmod(helper, 0o700);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: helper, overridden: true }),
    });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "BABY_MENU_COMMAND_FAILED",
      exitCode: 7,
      message: 'Command "gh" exited with status 7.',
      stderr: "GitHub sign-in required\n",
    });
  });

  it("fails a missing configured helper without falling back to the bare command", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-command-"));
    tempDirs.push(rootDir);
    const runner = createHostCommandRunner({
      caller: { extensionId: "github-graph", action: "getGraph" },
      resolveExecutable: async () => ({ executable: join(rootDir, "missing-helper"), overridden: true }),
    });

    await expect(runner.getGitHubContributionGraph()).rejects.toMatchObject({
      code: "ENOENT",
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

    const result = await runner.getGitHubContributionGraph();

    expect(JSON.parse(result.stdout).data.viewer.login).toBe("bare-account");
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
    await writeFile(helper, "#!/bin/sh\nprintf '{}\\n'\n");
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
