import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BabyMenuHostCommands, GitHubContributionGraph } from "../shared/contracts";

export type HostCommandExecOptions = {
  timeoutMs?: number;
  maxBufferBytes?: number;
};
export type HostCommandResult = GitHubContributionGraph;
export type HostCommandRunner = BabyMenuHostCommands;
export type ScopableHostCommandRunner = HostCommandRunner & {
  forCaller: (caller: HostCommandCaller) => HostCommandRunner;
};

export type HostCommandExecutableResolution = {
  executable: string;
  overridden: boolean;
};

export type HostCommandCaller = {
  extensionId: string;
  action: string;
};

export type HostCommandOperationPolicy = {
  extensionId: string;
  action: string;
  command: string;
};

type CreateHostCommandRunnerOptions = {
  resolveExecutable?: (command: string) => string | HostCommandExecutableResolution | Promise<string | HostCommandExecutableResolution>;
  caller?: HostCommandCaller;
  operationPolicies?: readonly HostCommandOperationPolicy[];
  commandExecOptions?: HostCommandExecOptions;
};

const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES = 256 * 1024;
const MAX_GITHUB_WEEKS = 60;
const MAX_GITHUB_DAYS = 400;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const GITHUB_CONTRIBUTION_GRAPH_QUERY = `{
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
export const GITHUB_CONTRIBUTION_GRAPH_ARGS = ["api", "graphql", "-f", `query=${GITHUB_CONTRIBUTION_GRAPH_QUERY}`] as const;
const DEFAULT_OPERATION_POLICIES: readonly HostCommandOperationPolicy[] = [
  {
    extensionId: "github-graph",
    action: "getGraph",
    command: "gh",
  },
];

export function createHostCommandRunner(options: CreateHostCommandRunnerOptions = {}): ScopableHostCommandRunner {
  const resolveExecutable = options.resolveExecutable ?? ((command: string) => command);
  const operationPolicies = options.operationPolicies ?? DEFAULT_OPERATION_POLICIES;

  const runner: ScopableHostCommandRunner = {
    async getGitHubContributionGraph() {
      const command = "gh";
      authorizeGitHubContributionGraph({
        caller: options.caller,
        policies: operationPolicies,
      });
      const result = await runHostCommand({
        command,
        args: GITHUB_CONTRIBUTION_GRAPH_ARGS,
        execOptions: {
          timeoutMs: options.commandExecOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBufferBytes: options.commandExecOptions?.maxBufferBytes ?? MAX_BUFFER_BYTES,
        },
        resolveExecutable,
      });
      return parseGitHubContributionGraph(result.stdout);
    },
    forCaller(caller) {
      return createHostCommandRunner({ ...options, caller, operationPolicies });
    },
  };
  return runner;
}

async function runHostCommand(input: {
  command: string;
  args: readonly string[];
  execOptions?: HostCommandExecOptions;
  resolveExecutable: (command: string) => string | HostCommandExecutableResolution | Promise<string | HostCommandExecutableResolution>;
}): Promise<{ stdout: string }> {
  const { command, args, execOptions = {}, resolveExecutable } = input;
  assertCommandName(command);
  const normalizedArgs = validateArguments(args);
  const normalizedOptions = validateExecOptions(execOptions);
  const resolution = normalizeExecutableResolution(command, await resolveExecutable(command));
  return new Promise<{ stdout: string }>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(resolution.executable, normalizedArgs, {
        detached: process.platform !== "win32",
        shell: false,
        windowsHide: true,
      });
    } catch {
      reject(commandError("BABY_MENU_COMMAND_LAUNCH_FAILED", "Command helper could not be launched."));
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let pendingFailure: (Error & { code: string }) | null = null;
    let termination: Promise<void> | null = null;
    let settled = false;
    const failAndTerminate = (failure: Error & { code: string }) => {
      pendingFailure = failure;
      termination ??= terminateProcessTree(child);
    };
    const timeout = setTimeout(() => {
      failAndTerminate(commandError("BABY_MENU_COMMAND_TIMEOUT", `Command timed out after ${normalizedOptions.timeoutMs} milliseconds.`));
    }, normalizedOptions.timeoutMs);
    timeout.unref?.();

    child.stdout.on("data", (chunk: Buffer | string) => {
      if (pendingFailure) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > normalizedOptions.maxBufferBytes) {
        failAndTerminate(
          commandError("BABY_MENU_COMMAND_OUTPUT_LIMIT", `Command output exceeded ${normalizedOptions.maxBufferBytes} bytes.`),
        );
        stdoutChunks.length = 0;
        return;
      }
      stdoutChunks.push(buffer);
    });
    child.stderr.resume();
    child.on("error", () => {
      if (!pendingFailure) pendingFailure = commandError("BABY_MENU_COMMAND_LAUNCH_FAILED", "Command helper could not be launched.");
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void (async () => {
        if (termination) await termination;
        if (pendingFailure) {
          reject(pendingFailure);
          return;
        }
        if (code === 0) {
          resolve({ stdout: Buffer.concat(stdoutChunks).toString("utf8") });
          return;
        }
        if (signal === "SIGKILL") {
          reject(commandError("BABY_MENU_COMMAND_TIMEOUT", `Command timed out after ${normalizedOptions.timeoutMs} milliseconds.`));
          return;
        }
        reject(
          Object.assign(commandError("BABY_MENU_COMMAND_FAILED", `Command "${command}" exited with status ${code ?? "unknown"}.`), {
            exitCode: code,
          }),
        );
      })();
    });
  });
}

function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (!child.pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, () => resolve());
    });
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  return Promise.resolve();
}

function parseGitHubContributionGraph(stdout: string): GitHubContributionGraph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_JSON", "GitHub contribution graph response was not valid JSON.");
  }
  const root = asRecord(parsed);
  if (Array.isArray(root.errors) && root.errors.length > 0) {
    throw commandError("BABY_MENU_GITHUB_GRAPH_GRAPHQL_ERROR", "GitHub contribution graph query returned an error.");
  }
  const viewer = asRecord(asRecord(root.data).viewer);
  const login = readGitHubLogin(viewer.login);
  const calendar = asRecord(asRecord(asRecord(viewer.contributionsCollection).contributionCalendar));
  const totalContributions = readNonNegativeInteger(calendar.totalContributions);
  const weeksInput = calendar.weeks;
  if (!Array.isArray(weeksInput) || weeksInput.length > MAX_GITHUB_WEEKS) {
    throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
  }

  let totalDays = 0;
  const weeks = weeksInput.map((weekInput) => {
    const week = asRecord(weekInput);
    const contributionDaysInput = week.contributionDays;
    if (!Array.isArray(contributionDaysInput) || contributionDaysInput.length > 7) {
      throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
    }
    totalDays += contributionDaysInput.length;
    if (totalDays > MAX_GITHUB_DAYS) {
      throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
    }
    return {
      firstDay: readIsoDate(week.firstDay),
      contributionDays: contributionDaysInput.map((dayInput) => {
        const day = asRecord(dayInput);
        const weekday = readNonNegativeInteger(day.weekday);
        if (weekday > 6) {
          throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
        }
        return {
          date: readIsoDate(day.date),
          contributionCount: readNonNegativeInteger(day.contributionCount),
          weekday,
        };
      }),
    };
  });

  return { login, totalContributions, weeks };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
}

function readGitHubLogin(value: unknown): string {
  if (typeof value === "string" && GITHUB_LOGIN_PATTERN.test(value)) return value;
  throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
}

function readIsoDate(value: unknown): string {
  if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) return value;
  throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
}

function readNonNegativeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw commandError("BABY_MENU_GITHUB_GRAPH_INVALID_SCHEMA", "GitHub contribution graph response had an unexpected schema.");
}

function validateArguments(args: readonly string[]): string[] {
  if (!Array.isArray(args) || args.length > MAX_ARGUMENTS) {
    throw commandError("BABY_MENU_COMMAND_INVALID_ARGUMENTS", `Commands accept at most ${MAX_ARGUMENTS} arguments.`);
  }
  let totalBytes = 0;
  const normalized = args.map((argument) => {
    if (typeof argument !== "string" || argument.includes("\0")) {
      throw commandError("BABY_MENU_COMMAND_INVALID_ARGUMENTS", "Command arguments must be strings without null bytes.");
    }
    const bytes = Buffer.byteLength(argument);
    if (bytes > MAX_ARGUMENT_BYTES) {
      throw commandError("BABY_MENU_COMMAND_INVALID_ARGUMENTS", "A command argument is too large.");
    }
    totalBytes += bytes;
    return argument;
  });
  if (totalBytes > MAX_TOTAL_ARGUMENT_BYTES) {
    throw commandError("BABY_MENU_COMMAND_INVALID_ARGUMENTS", "The command arguments are too large.");
  }
  return normalized;
}

function validateExecOptions(options: HostCommandExecOptions): Required<HostCommandExecOptions> {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw commandError("BABY_MENU_COMMAND_INVALID_OPTIONS", "Command options must be an object.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw commandError(
      "BABY_MENU_COMMAND_INVALID_OPTIONS",
      `Command timeouts must be between 1 and ${MAX_TIMEOUT_MS} milliseconds.`,
    );
  }
  if (!Number.isInteger(maxBufferBytes) || maxBufferBytes <= 0 || maxBufferBytes > MAX_BUFFER_BYTES) {
    throw commandError(
      "BABY_MENU_COMMAND_INVALID_OPTIONS",
      `Command output limits must be between 1 and ${MAX_BUFFER_BYTES} bytes.`,
    );
  }
  return { timeoutMs, maxBufferBytes };
}

function assertCommandName(command: string): void {
  if (typeof command === "string" && COMMAND_NAME_PATTERN.test(command)) return;
  throw commandError(
    "BABY_MENU_COMMAND_INVALID_NAME",
    "Command names must contain only letters, numbers, dot, dash, underscore, or plus.",
  );
}

function commandError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function normalizeExecutableResolution(command: string, resolution: string | HostCommandExecutableResolution): HostCommandExecutableResolution {
  if (typeof resolution === "string") return { executable: resolution, overridden: resolution !== command };
  if (
    resolution &&
    typeof resolution === "object" &&
    typeof resolution.executable === "string" &&
    typeof resolution.overridden === "boolean"
  ) {
    return resolution;
  }
  throw commandError("BABY_MENU_COMMAND_INVALID_RESOLUTION", "Command executable resolution was invalid.");
}

function authorizeGitHubContributionGraph(input: {
  caller?: HostCommandCaller;
  policies: readonly HostCommandOperationPolicy[];
}): void {
  const policy = input.policies.find(
    (candidate) =>
      candidate.extensionId === input.caller?.extensionId &&
      candidate.action === input.caller.action &&
      candidate.command === "gh",
  );
  if (!policy) {
    throw commandError(
      "BABY_MENU_COMMAND_UNAUTHORIZED_OPERATION",
      "The configured command helper is not authorized for this extension operation.",
    );
  }
}
