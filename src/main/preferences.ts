import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { BabyMenuCommandOverride } from "../shared/contracts";

export type BabyMenuPreferences = {
  openAtLogin: boolean;
  /** Persisted embedded-agent choice; absent until the user picks one. */
  agentName?: string;
  /** Absolute executable overrides keyed by the bare command an extension requests. */
  commandOverrides?: Record<string, string>;
};

export type CommandOverrideInput = BabyMenuCommandOverride;

type LoginItemApp = {
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
};

export type PreferencesService = {
  get: () => Promise<BabyMenuPreferences>;
  setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuPreferences>;
  setAgent: (agentName: string) => Promise<BabyMenuPreferences>;
  setCommandOverride: (input: CommandOverrideInput) => Promise<BabyMenuPreferences>;
  removeCommandOverride: (command: string) => Promise<BabyMenuPreferences>;
  resolveCommandExecutable: (command: string) => Promise<string>;
  apply: () => Promise<BabyMenuPreferences>;
};

type CreatePreferencesServiceOptions = {
  userDataDir: string;
  app: LoginItemApp;
  defaultOpenAtLogin?: boolean;
  allowOpenAtLogin?: boolean;
};

export function createPreferencesService({
  userDataDir,
  app,
  defaultOpenAtLogin = true,
  allowOpenAtLogin = true,
}: CreatePreferencesServiceOptions): PreferencesService {
  const filePath = join(userDataDir, "preferences.json");

  function normalizePreferences(preferences: BabyMenuPreferences): BabyMenuPreferences {
    const agentName = preferences.agentName?.trim();
    const commandOverrides = normalizeCommandOverrides(preferences.commandOverrides);
    return {
      openAtLogin: allowOpenAtLogin && preferences.openAtLogin,
      ...(agentName ? { agentName } : {}),
      ...(commandOverrides ? { commandOverrides } : {}),
    };
  }

  function applyLoginItemSettings(preferences: BabyMenuPreferences): void {
    if (!allowOpenAtLogin) return;
    app.setLoginItemSettings({ openAtLogin: preferences.openAtLogin });
  }

  async function readPreferences(): Promise<BabyMenuPreferences> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<BabyMenuPreferences>;
      return normalizePreferences({
        openAtLogin: parsed.openAtLogin ?? defaultOpenAtLogin,
        agentName: parsed.agentName,
        commandOverrides: parsed.commandOverrides,
      });
    } catch {
      return normalizePreferences({ openAtLogin: defaultOpenAtLogin });
    }
  }

  async function writePreferences(preferences: BabyMenuPreferences): Promise<BabyMenuPreferences> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(preferences, null, 2)}\n`);
    return preferences;
  }

  return {
    get: readPreferences,
    async setOpenAtLogin(openAtLogin) {
      const current = await readPreferences();
      const preferences = await writePreferences(normalizePreferences({ ...current, openAtLogin }));
      applyLoginItemSettings(preferences);
      return preferences;
    },
    async setAgent(agentName) {
      const current = await readPreferences();
      return writePreferences(normalizePreferences({ ...current, agentName }));
    },
    async setCommandOverride(input) {
      const { command, executable } = await validateCommandOverrideInput(input);
      const current = await readPreferences();
      return writePreferences(
        normalizePreferences({
          ...current,
          commandOverrides: { ...current.commandOverrides, [command]: executable },
        }),
      );
    },
    async removeCommandOverride(command) {
      const current = await readPreferences();
      const commandOverrides = { ...current.commandOverrides };
      delete commandOverrides[command];
      return writePreferences(
        normalizePreferences({
          ...current,
          commandOverrides,
        }),
      );
    },
    async resolveCommandExecutable(command) {
      assertCommandName(command);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        if (isMissingPathError(error)) return command;
        throw commandPreferenceError(
          `The command helper settings could not be read. Open Settings and save the helper again.`,
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw commandPreferenceError(`The command helper settings are malformed. Open Settings and save the helper again.`);
      }
      const overrides = (parsed as { commandOverrides?: unknown }).commandOverrides;
      if (overrides === undefined) return command;
      if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
        throw commandPreferenceError(`The command helper settings are malformed. Open Settings and save the helper again.`);
      }
      if (!Object.prototype.hasOwnProperty.call(overrides, command)) return command;
      const executable = (overrides as Record<string, unknown>)[command];
      if (typeof executable !== "string" || !isAbsolute(executable) || executable.includes("\0")) {
        throw commandPreferenceError(
          `The configured executable for "${command}" must be an absolute path. Update or remove it in Settings.`,
        );
      }
      return executable;
    },
    async apply() {
      const preferences = await readPreferences();
      applyLoginItemSettings(preferences);
      return preferences;
    },
  };
}

async function validateCommandOverrideInput(input: CommandOverrideInput): Promise<CommandOverrideInput> {
  if (!input || typeof input.command !== "string" || typeof input.executable !== "string") {
    throw new Error("Enter a command name and an executable path.");
  }
  const command = input.command.trim();
  const executable = input.executable.trim();
  assertCommandName(command);
  if (!isAbsolute(executable) || executable.includes("\0")) {
    throw new Error("Choose an absolute executable path.");
  }

  let details;
  try {
    details = await stat(executable);
  } catch (error) {
    if (isMissingPathError(error)) throw new Error("The executable does not exist.");
    throw error;
  }
  if (!details.isFile()) throw new Error("The selected path is not a regular file.");
  try {
    await access(executable, constants.X_OK);
  } catch {
    throw new Error("The selected file is not executable.");
  }
  return { command, executable };
}

function assertCommandName(command: string): void {
  if (/^[A-Za-z0-9._+-]+$/.test(command)) return;
  throw new Error("Command names must contain only letters, numbers, dot, dash, underscore, or plus.");
}

function commandPreferenceError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: "BABY_MENU_COMMAND_INVALID_OVERRIDE" });
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function normalizeCommandOverrides(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => Boolean(entry[0].trim()) && typeof entry[1] === "string" && Boolean(entry[1].trim()),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
