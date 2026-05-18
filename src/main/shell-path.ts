import { spawnSync } from "node:child_process";
import { homedir } from "node:os";

type MergeShellPathOptions = {
  currentPath?: string;
  homeDir?: string;
  shellPath?: string;
};

const COMMON_GUI_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

export function mergeShellPath(options: MergeShellPathOptions = {}): string {
  const homeDir = options.homeDir ?? homedir();
  const segments = [
    ...(options.currentPath ?? "").split(":"),
    ...COMMON_GUI_PATHS,
    `${homeDir}/.local/bin`,
    ...(options.shellPath ?? "").split(":"),
  ];

  return [...new Set(segments.map((segment) => segment.trim()).filter(Boolean))].join(":");
}

export function readLoginShellPath(): string | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("/bin/zsh", ["-lc", "print -r -- $PATH"], {
    encoding: "utf8",
    timeout: 2000,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export function expandProcessPathForGuiLaunch(): string {
  process.env.PATH = mergeShellPath({ currentPath: process.env.PATH, shellPath: readLoginShellPath() });
  return process.env.PATH;
}
