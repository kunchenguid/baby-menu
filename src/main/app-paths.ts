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

type BabyMenuPathEnv = Partial<Pick<NodeJS.ProcessEnv, typeof EXTENSIONS_DIR_ENV | "BABY_MENU_PACKAGED_TEST_HOME">>;

type CreateBabyMenuRuntimePathsOptions = {
  isPackaged: boolean;
  sourceRoot: string;
  env?: BabyMenuPathEnv;
  homeDir?: string;
  resourcesPath?: string;
  platform?: NodeJS.Platform;
};

export function createBabyMenuRuntimePaths(options: CreateBabyMenuRuntimePathsOptions): BabyMenuRuntimePaths {
  const platform = options.platform ?? process.platform;
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
      trayIconPath: join(options.sourceRoot, "assets", "tray", trayIconFileName(platform)),
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
    trayIconPath: join(options.resourcesPath, "tray", trayIconFileName(platform)),
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
    homeDir: app.isPackaged ? resolvePackagedHomeDir(app.getPath("home"), process.env) : undefined,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  });
}

export function resolvePackagedHomeDir(defaultHomeDir: string, env: BabyMenuPathEnv = process.env): string {
  return env.BABY_MENU_PACKAGED_TEST_HOME?.trim() || defaultHomeDir;
}

function resolveSourceExtensionsDir(
  sourceRoot: string,
  env: BabyMenuPathEnv = process.env,
): string {
  const configured = env[EXTENSIONS_DIR_ENV];
  if (!configured) return join(sourceRoot, "extensions");
  return isAbsolute(configured) ? configured : join(sourceRoot, configured);
}

// setTemplateImage macOS-only concept, so black template PNG is
// invisible on dark Linux panel, StatusNotifierItem cannot recolor
// pixmap. Linux therefore ships colored icon reads on either panel.
function trayIconFileName(platform: NodeJS.Platform): string {
  return platform === "linux" ? "baby_menu-linux.png" : "baby_menuTemplate.png";
}
