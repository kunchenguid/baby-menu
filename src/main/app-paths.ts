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
  /** Directory holding the bundled clean-room ACP adapters (out/adapters/<name>/index.js). */
  adaptersDir: string;
  isPackaged: boolean;
};

type CreateBabyMenuRuntimePathsOptions = {
  isPackaged: boolean;
  sourceRoot: string;
  env?: Partial<Pick<NodeJS.ProcessEnv, typeof EXTENSIONS_DIR_ENV>>;
  homeDir?: string;
  resourcesPath?: string;
  /** Override platform so darwin/win32 tray icon selection can be unit-tested on Linux. */
  platform?: NodeJS.Platform;
};

/**
 * Tray asset basename by platform (G06).
 * macOS keeps Template images; Windows uses a non-template monochrome PNG.
 * Other platforms keep the Template basename for source-mode parity with mac tests.
 */
export function trayIconFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "baby_menu.png" : "baby_menuTemplate.png";
}

export function createBabyMenuRuntimePaths(options: CreateBabyMenuRuntimePathsOptions): BabyMenuRuntimePaths {
  const platform = options.platform ?? process.platform;
  const trayFile = trayIconFileName(platform);

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
      trayIconPath: join(options.sourceRoot, "assets", "tray", trayFile),
      databasePath: join(cacheDir, "baby-menu.db"),
      // Dev/source: adapters are esbuild-bundled into the checkout's out/.
      adaptersDir: join(options.sourceRoot, "out", "adapters"),
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
    trayIconPath: join(options.resourcesPath, "tray", trayFile),
    databasePath: join(appDataRoot, "baby-menu.db"),
    // Packaged: adapters are asar-unpacked (a standalone Node process cannot read
    // inside app.asar), so they live alongside the asar in app.asar.unpacked.
    adaptersDir: join(options.resourcesPath, "app.asar.unpacked", "out", "adapters"),
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
    platform: process.platform,
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
