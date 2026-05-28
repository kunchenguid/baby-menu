import { app } from "electron";
import { isAbsolute, join } from "node:path";
import { EXTENSIONS_DIR_ENV } from "../shared/paths";

export type BabyMenuRuntimePaths = {
  appDataRoot: string;
  sourceRoot: string;
  extensionsDir: string;
  recipesDir: string;
  cacheDir: string;
  widgetCacheDir: string;
  serverActionCacheDir: string;
  agentStateDir: string;
  devExtensionSnapshotDir: string;
  bundledExtensionTemplateDir: string | null;
  trayIconPath: string;
  databasePath: string;
  isPackaged: boolean;
};

type CreateBabyMenuRuntimePathsOptions = {
  isPackaged: boolean;
  sourceRoot: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, typeof EXTENSIONS_DIR_ENV>>;
  homeDir?: string;
  resourcesPath?: string;
};

export function createBabyMenuRuntimePaths(options: CreateBabyMenuRuntimePathsOptions): BabyMenuRuntimePaths {
  if (!options.isPackaged) {
    const cacheDir = join(options.sourceRoot, ".cache", "baby-menu");
    const extensionsDir = resolveSourceExtensionsDir(options.sourceRoot, options.env);
    return {
      appDataRoot: options.sourceRoot,
      sourceRoot: options.sourceRoot,
      extensionsDir,
      recipesDir: join(extensionsDir, "recipes"),
      cacheDir,
      widgetCacheDir: join(cacheDir, "widgets"),
      serverActionCacheDir: join(cacheDir, "server-actions"),
      agentStateDir: join(cacheDir, "acp-sessions"),
      devExtensionSnapshotDir: join(cacheDir, "dev-extension-snapshots"),
      bundledExtensionTemplateDir: null,
      trayIconPath: join(options.sourceRoot, "assets", "tray", "baby_menuTemplate.png"),
      databasePath: join(cacheDir, "baby-menu.db"),
      isPackaged: false,
    };
  }

  if (!options.homeDir) throw new Error("homeDir is required for packaged Baby Menu paths");
  if (!options.resourcesPath) throw new Error("resourcesPath is required for packaged Baby Menu paths");

  const appDataRoot = join(options.homeDir, ".baby-menu");
  const cacheDir = join(appDataRoot, "cache");
  const extensionsDir = join(appDataRoot, "extensions");
  return {
    appDataRoot,
    sourceRoot: options.sourceRoot,
    extensionsDir,
    recipesDir: join(extensionsDir, "recipes"),
    cacheDir,
    widgetCacheDir: join(cacheDir, "widgets"),
    serverActionCacheDir: join(cacheDir, "server-actions"),
    agentStateDir: join(cacheDir, "acp-sessions"),
    devExtensionSnapshotDir: join(cacheDir, "snapshots"),
    bundledExtensionTemplateDir: join(options.resourcesPath, "extensions-template"),
    trayIconPath: join(options.resourcesPath, "tray", "baby_menuTemplate.png"),
    databasePath: join(appDataRoot, "baby-menu.db"),
    isPackaged: true,
  };
}

export function resolveBabyMenuRuntimePaths(sourceRoot: string): BabyMenuRuntimePaths {
  return createBabyMenuRuntimePaths({
    isPackaged: app.isPackaged,
    sourceRoot,
    env: process.env,
    homeDir: app.isPackaged ? app.getPath("home") : undefined,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  });
}

function resolveSourceExtensionsDir(
  sourceRoot: string,
  env: Partial<Pick<NodeJS.ProcessEnv, typeof EXTENSIONS_DIR_ENV>> = process.env,
): string {
  const configured = env[EXTENSIONS_DIR_ENV];
  if (!configured) return join(sourceRoot, "extensions");
  return isAbsolute(configured) ? configured : join(sourceRoot, configured);
}
