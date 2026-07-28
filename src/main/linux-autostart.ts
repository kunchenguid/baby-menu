import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const LINUX_AUTOSTART_FILE_NAME = "baby-menu.desktop";

export function linuxAutostartFilePath(homeDir: string): string {
  return join(homeDir, ".config", "autostart", LINUX_AUTOSTART_FILE_NAME);
}

// An AppImage runs from a temporary mount, so app.getPath("exe") there points at
// a path that no longer exists on the next boot. $APPIMAGE is the stable launcher.
export function linuxAutostartExecPath(env: { APPIMAGE?: string }, exePath: string): string {
  return env.APPIMAGE?.trim() || exePath;
}

export function linuxAutostartEntry(execPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Baby Menu",
    `Exec=${execPath}`,
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export async function applyLinuxAutostart(filePath: string, execPath: string, openAtLogin: boolean): Promise<void> {
  if (!openAtLogin) {
    await rm(filePath, { force: true });
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, linuxAutostartEntry(execPath));
}

export type CreateLinuxLoginItemOptions = {
  exePath: string;
  homeDir: string;
  env?: { APPIMAGE?: string };
};

// Matches the LoginItemApp facade createPreferencesService already accepts, so
// the preferences service stays platform-agnostic. app.setLoginItemSettings is
// macOS and Windows only, so on Linux the autostart desktop entry stands in for it.
export function createLinuxLoginItem(options: CreateLinuxLoginItemOptions): {
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
} {
  const filePath = linuxAutostartFilePath(options.homeDir);
  const execPath = linuxAutostartExecPath(options.env ?? process.env, options.exePath);
  return {
    setLoginItemSettings({ openAtLogin }) {
      // Fire and forget to match the synchronous Electron API this stands in for.
      // A failure here must never break the Settings toggle or app startup.
      void applyLinuxAutostart(filePath, execPath, openAtLogin).catch((error) => {
        console.error("[baby-menu] failed to update the Linux autostart entry", error);
      });
    },
  };
}
