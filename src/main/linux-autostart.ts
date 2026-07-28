import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

export const LINUX_AUTOSTART_FILE_NAME = "baby-menu.desktop";

export type LinuxAutostartEnv = {
  APPIMAGE?: string;
  XDG_CONFIG_HOME?: string;
};

// The session manager reads $XDG_CONFIG_HOME/autostart; ~/.config is only the
// spec's fallback default. A relative value is invalid per the spec and ignored.
export function linuxAutostartFilePath(homeDir: string, env: LinuxAutostartEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim();
  const configDir = configHome && isAbsolute(configHome) ? configHome : join(homeDir, ".config");
  return join(configDir, "autostart", LINUX_AUTOSTART_FILE_NAME);
}

// An AppImage runs from a temporary mount, so app.getPath("exe") there points at
// a path that no longer exists on the next boot. $APPIMAGE is the stable launcher.
export function linuxAutostartExecPath(env: LinuxAutostartEnv, exePath: string): string {
  return env.APPIMAGE?.trim() || exePath;
}

// The session manager splits Exec on whitespace into argv, and the deb, rpm and
// pacman targets install to /opt/Baby Menu/baby-menu. Quote exactly the way
// app-builder-lib's LinuxTargetHelper does for the desktop entry it generates.
export function linuxAutostartExecValue(execPath: string): string {
  return /^[/0-9A-Za-z._-]+$/.test(execPath) ? execPath : `"${execPath}"`;
}

export function linuxAutostartEntry(execPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Baby Menu",
    `Exec=${linuxAutostartExecValue(execPath)}`,
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
  env?: LinuxAutostartEnv;
};

// Serializes the writes the synchronous facade below fires and forgets, so two
// overlapping toggles cannot race the write path against the remove path and
// leave the losing state on disk.
let pendingAutostartWrite: Promise<void> = Promise.resolve();

// Matches the LoginItemApp facade createPreferencesService already accepts, so
// the preferences service stays platform-agnostic. app.setLoginItemSettings is
// macOS and Windows only, so on Linux the autostart desktop entry stands in for it.
export function createLinuxLoginItem(options: CreateLinuxLoginItemOptions): {
  setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
} {
  const env = options.env ?? process.env;
  const filePath = linuxAutostartFilePath(options.homeDir, env);
  const execPath = linuxAutostartExecPath(env, options.exePath);
  return {
    setLoginItemSettings({ openAtLogin }) {
      // Fire and forget to match the synchronous Electron API this stands in for.
      // A failure here must never break the Settings toggle or app startup.
      pendingAutostartWrite = pendingAutostartWrite
        .then(() => applyLinuxAutostart(filePath, execPath, openAtLogin))
        .catch((error) => {
          console.error("[baby-menu] failed to update the Linux autostart entry", error);
        });
    },
  };
}
