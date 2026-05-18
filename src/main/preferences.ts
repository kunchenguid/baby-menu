import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type BabyMenuPreferences = {
  openAtLogin: boolean;
};

type LoginItemApp = {
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
  getLoginItemSettings: () => { openAtLogin?: boolean };
};

export type PreferencesService = {
  get: () => Promise<BabyMenuPreferences>;
  setOpenAtLogin: (openAtLogin: boolean) => Promise<BabyMenuPreferences>;
  apply: () => Promise<BabyMenuPreferences>;
};

export function createPreferencesService({ userDataDir, app }: { userDataDir: string; app: LoginItemApp }): PreferencesService {
  const filePath = join(userDataDir, "preferences.json");

  async function readPreferences(): Promise<BabyMenuPreferences> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<BabyMenuPreferences>;
      return { openAtLogin: parsed.openAtLogin ?? app.getLoginItemSettings().openAtLogin ?? false };
    } catch {
      return { openAtLogin: app.getLoginItemSettings().openAtLogin ?? false };
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
      const preferences = await writePreferences({ openAtLogin });
      app.setLoginItemSettings({ openAtLogin });
      return preferences;
    },
    async apply() {
      const preferences = await readPreferences();
      app.setLoginItemSettings({ openAtLogin: preferences.openAtLogin });
      return preferences;
    },
  };
}
