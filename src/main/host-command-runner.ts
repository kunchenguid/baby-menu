import { execFile } from "node:child_process";
import type { BabyMenuCommandResult, BabyMenuHostCommands } from "../shared/contracts";

export type HostCommandExecOptions = {
  timeoutMs?: number;
  maxBufferBytes?: number;
};
export type HostCommandResult = BabyMenuCommandResult;
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
};

const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES = 256 * 1024;
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
      return runHostCommand({
        command,
        args: GITHUB_CONTRIBUTION_GRAPH_ARGS,
        execOptions: {
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxBufferBytes: MAX_BUFFER_BYTES,
        },
        resolveExecutable,
      });
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
}): Promise<HostCommandResult> {
  const { command, args, execOptions = {}, resolveExecutable } = input;
  assertCommandName(command);
  const normalizedArgs = validateArguments(args);
  const normalizedOptions = validateExecOptions(execOptions);
  const resolution = normalizeExecutableResolution(command, await resolveExecutable(command));
  return new Promise<HostCommandResult>((resolve, reject) => {
    execFile(
      resolution.executable,
      normalizedArgs,
      {
        encoding: "utf8",
        shell: false,
        timeout: normalizedOptions.timeoutMs,
        maxBuffer: normalizedOptions.maxBufferBytes,
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            reject(
              Object.assign(
                commandError(
                  "BABY_MENU_COMMAND_OUTPUT_LIMIT",
                  `Command output exceeded ${normalizedOptions.maxBufferBytes} bytes.`,
                ),
                { stdout, stderr },
              ),
            );
            return;
          }
          if (error.killed || error.signal === "SIGKILL") {
            reject(
              Object.assign(
                commandError(
                  "BABY_MENU_COMMAND_TIMEOUT",
                  `Command timed out after ${normalizedOptions.timeoutMs} milliseconds.`,
                ),
                { stdout, stderr },
              ),
            );
            return;
          }
          if (typeof error.code === "number") {
            reject(
              Object.assign(
                commandError("BABY_MENU_COMMAND_FAILED", `Command "${command}" exited with status ${error.code}.`),
                { exitCode: error.code, stdout, stderr },
              ),
            );
            return;
          }
          Object.assign(error, { stdout, stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
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
