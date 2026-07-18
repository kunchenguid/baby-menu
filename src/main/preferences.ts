import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AgentRuntimeMode = "host" | "wsl";

export type BabyMenuPreferences = {
  openAtLogin: boolean;
  /** Persisted embedded-agent choice; absent until the user picks one. */
  agentName?: string;
  /**
   * Where agent CLIs are discovered and launched. `"wsl"` is only effective on
   * win32; other platforms always behave as `"host"`.
   */
  agentRuntimeMode?: AgentRuntimeMode;
  /** WSL distro name when agentRuntimeMode is `"wsl"`. Defaults to Ubuntu. */
  wslDistro?: string;
};

type LoginItemApp = {
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
};

export type PreferencesService = {
  get: () => Promise<BabyMenuPreferences>;
  setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuPreferences>;
  setAgent: (agentName: string) => Promise<BabyMenuPreferences>;
  setAgentRuntimeMode: (mode: AgentRuntimeMode) => Promise<BabyMenuPreferences>;
  setWslDistro: (distro: string) => Promise<BabyMenuPreferences>;
  setAgentRuntime: (input: { agentRuntimeMode?: AgentRuntimeMode; wslDistro?: string }) => Promise<BabyMenuPreferences>;
  apply: () => Promise<BabyMenuPreferences>;
};

type CreatePreferencesServiceOptions = {
  userDataDir: string;
  app: LoginItemApp;
  defaultOpenAtLogin?: boolean;
  allowOpenAtLogin?: boolean;
};

const DEFAULT_WSL_DISTRO = "Ubuntu";

function normalizeRuntimeMode(value: unknown): AgentRuntimeMode | undefined {
  if (value === "wsl" || value === "host") return value;
  return undefined;
}

export function createPreferencesService({
  userDataDir,
  app,
  defaultOpenAtLogin = true,
  allowOpenAtLogin = true,
}: CreatePreferencesServiceOptions): PreferencesService {
  const filePath = join(userDataDir, "preferences.json");

  function normalizePreferences(preferences: BabyMenuPreferences): BabyMenuPreferences {
    const agentName = preferences.agentName?.trim();
    const agentRuntimeMode = normalizeRuntimeMode(preferences.agentRuntimeMode);
    const wslDistro = preferences.wslDistro?.trim();
    return {
      openAtLogin: allowOpenAtLogin && preferences.openAtLogin,
      ...(agentName ? { agentName } : {}),
      ...(agentRuntimeMode ? { agentRuntimeMode } : {}),
      ...(wslDistro ? { wslDistro } : {}),
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
        agentRuntimeMode: normalizeRuntimeMode(parsed.agentRuntimeMode),
        wslDistro: typeof parsed.wslDistro === "string" ? parsed.wslDistro : undefined,
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
    async setAgentRuntimeMode(mode) {
      const current = await readPreferences();
      const next: BabyMenuPreferences = {
        ...current,
        agentRuntimeMode: mode,
        // When enabling WSL, ensure a distro is recorded so Settings and probes stay stable.
        ...(mode === "wsl" && !current.wslDistro?.trim() ? { wslDistro: DEFAULT_WSL_DISTRO } : {}),
      };
      return writePreferences(normalizePreferences(next));
    },
    async setWslDistro(distro) {
      const current = await readPreferences();
      const trimmed = distro.trim() || DEFAULT_WSL_DISTRO;
      return writePreferences(normalizePreferences({ ...current, wslDistro: trimmed }));
    },
    async setAgentRuntime(input) {
      const current = await readPreferences();
      const mode = input.agentRuntimeMode !== undefined ? normalizeRuntimeMode(input.agentRuntimeMode) : current.agentRuntimeMode;
      const distro =
        input.wslDistro !== undefined
          ? input.wslDistro.trim() || DEFAULT_WSL_DISTRO
          : current.wslDistro;
      const next: BabyMenuPreferences = {
        ...current,
        ...(mode ? { agentRuntimeMode: mode } : {}),
        ...(distro ? { wslDistro: distro } : {}),
      };
      if (mode === "wsl" && !next.wslDistro?.trim()) {
        next.wslDistro = DEFAULT_WSL_DISTRO;
      }
      return writePreferences(normalizePreferences(next));
    },
    async apply() {
      const preferences = await readPreferences();
      applyLoginItemSettings(preferences);
      return preferences;
    },
  };
}
