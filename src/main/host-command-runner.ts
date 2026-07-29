import { execFile } from "node:child_process";
import type {
  BabyMenuCommandExecOptions,
  BabyMenuCommandResult,
  BabyMenuHostCommands,
} from "../shared/contracts";

export type HostCommandExecOptions = BabyMenuCommandExecOptions;
export type HostCommandResult = BabyMenuCommandResult;
export type HostCommandRunner = BabyMenuHostCommands;

type CreateHostCommandRunnerOptions = {
  resolveExecutable?: (command: string) => string | Promise<string>;
};

const COMMAND_NAME_PATTERN = /^[A-Za-z0-9._+-]+$/;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;
const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES = 256 * 1024;

export function createHostCommandRunner(options: CreateHostCommandRunnerOptions = {}): HostCommandRunner {
  const resolveExecutable = options.resolveExecutable ?? ((command: string) => command);

  return {
    async execFile(command, args, execOptions = {}) {
      assertCommandName(command);
      const normalizedArgs = validateArguments(args);
      const normalizedOptions = validateExecOptions(execOptions);
      const executable = await resolveExecutable(command);
      return new Promise<HostCommandResult>((resolve, reject) => {
        execFile(
          executable,
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
                    commandError(
                      "BABY_MENU_COMMAND_FAILED",
                      `Command "${command}" exited with status ${error.code}.`,
                    ),
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
    },
  };
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
