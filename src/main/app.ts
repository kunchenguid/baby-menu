import { app, BrowserWindow, screen, type Rectangle } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BabyMenuSettings } from "../shared/contracts";
import { getRepoRoot } from "../shared/paths";
import {
  agentRegistryOverrides,
  loadAgentConfigFile,
  resolveAgentCatalog,
  toAgentOptions,
} from "./agent-catalog";
import { BabyMenuAgentRuntime, commandExists } from "./agent-runtime";
import { resolveBabyMenuRuntimePaths } from "./app-paths";
import { seedExtensionWorkspace } from "./extension-seeder";
import { registerIpcHandlers } from "./ipc";
import {
  DEFAULT_POPOVER_SIZE,
  calculatePopoverBounds,
  createPopoverOptions,
  loadPopoverRenderer,
  responsivePopoverSize,
  type Size,
} from "./popover";
import { createBackgroundTaskScheduler } from "./background-task-scheduler";
import { createExtensionDatabase } from "./extension-database";
import { createNotifier } from "./notifier";
import { createPreferencesService } from "./preferences";
import { createBackgroundTaskSource, createServerActionRegistry } from "./server-action-registry";
import { expandProcessPathForGuiLaunch } from "./shell-path";
import { createBabyMenuTray, type BabyMenuTray } from "./tray";
import { createWidgetModuleRegistry } from "./widget-module-registry";
import { registerBabyMenuProtocolHandlers, registerBabyMenuProtocolSchemes } from "./widget-protocol";

if (process.platform === "darwin") {
  app.commandLine.appendSwitch("use-mock-keychain");
}

registerBabyMenuProtocolSchemes();

let popoverWindow: BrowserWindow | null = null;
let activeTray: BabyMenuTray | null = null;
let latestTrayBounds: Rectangle | null = null;
let latestPopoverSize: Size = DEFAULT_POPOVER_SIZE;

export function getActiveBabyMenuTray(): BabyMenuTray | null {
  return activeTray;
}

function currentDirname(): string {
  return typeof __dirname === "string" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
}

async function createPopoverWindow(): Promise<BrowserWindow> {
  if (popoverWindow && !popoverWindow.isDestroyed()) return popoverWindow;

  const dirname = currentDirname();
  popoverWindow = new BrowserWindow(createPopoverOptions(join(dirname, "../preload/index.cjs")));
  popoverWindow.on("blur", () => {
    if (process.env.BABY_MENU_KEEP_POPOVER_OPEN === "1") return;
    popoverWindow?.hide();
  });
  // Tell the renderer when the popover is shown or hidden so view refresh can pause
  // while nobody is looking. Main owns the authoritative signal: the Page Visibility
  // API is unreliable here (the popover is created show:false, and the gating would
  // silently break if backgroundThrottling were ever disabled).
  popoverWindow.on("show", () => sendPopoverVisibility(true));
  // Once the popover is hidden, drop back to accessory mode so the dock icon disappears again.
  // See setPopoverKeyWindowActive for why the popover becomes a regular-policy app while visible.
  popoverWindow.on("hide", () => {
    setPopoverKeyWindowActive(false);
    sendPopoverVisibility(false);
  });

  await loadPopoverRenderer(
    popoverWindow,
    process.env.ELECTRON_RENDERER_URL,
    join(dirname, "../renderer/index.html"),
    { isPackaged: app.isPackaged },
  );

  return popoverWindow;
}

async function togglePopover(trayBounds: Rectangle): Promise<void> {
  const window = await createPopoverWindow();
  latestTrayBounds = trayBounds;
  if (window.isVisible()) {
    window.hide();
    return;
  }

  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  window.setBounds(calculatePopoverBounds(trayBounds, display.workArea, latestPopoverSize));
  setPopoverKeyWindowActive(true);
  window.show();
  window.focus();
}

// baby-menu runs as a macOS accessory app (dock hidden) so it has no permanent dock icon. But an
// accessory app's windows never become the macOS "key window", and macOS only does CSS cursor-rect
// tracking for the key window - so as an accessory app the popover's cursor never updates correctly
// (it stays the default arrow, or updates unstably and flickers). Switching to the "regular"
// activation policy while the popover is visible lets it become the key window so the cursor tracks
// correctly; switching back to "accessory" on hide keeps the dock icon from lingering. Net effect:
// the dock icon is only present for the brief moment the popover is open.
function setPopoverKeyWindowActive(active: boolean): void {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy(active ? "regular" : "accessory");
  if (active) app.focus({ steal: true });
}

function sendToPopover(channel: string, payload: unknown): void {
  if (!popoverWindow || popoverWindow.isDestroyed()) return;
  popoverWindow.webContents.send(channel, payload);
}

function sendPopoverVisibility(visible: boolean): void {
  sendToPopover("baby-menu:popover:visibility", { visible });
}

function setPopoverContentHeight(height: number) {
  latestPopoverSize = responsivePopoverSize(height);
  if (!latestTrayBounds || !popoverWindow || popoverWindow.isDestroyed()) return;

  const display = screen.getDisplayNearestPoint({ x: latestTrayBounds.x, y: latestTrayBounds.y });
  popoverWindow.setBounds(calculatePopoverBounds(latestTrayBounds, display.workArea, latestPopoverSize));
}

export async function startBabyMenuApp(): Promise<void> {
  expandProcessPathForGuiLaunch();
  await app.whenReady();
  const sourceRoot = getRepoRoot();
  const paths = resolveBabyMenuRuntimePaths(sourceRoot);
  await seedExtensionWorkspace({ extensionsDir: paths.extensionsDir, templateDir: paths.bundledExtensionTemplateDir });
  registerBabyMenuProtocolHandlers({ widgetCacheDir: paths.widgetCacheDir });

  if (process.platform === "darwin") {
    app.dock?.hide();
  }

  const preferences = createPreferencesService({
    userDataDir: paths.appDataRoot,
    app,
    defaultOpenAtLogin: paths.isPackaged,
    allowOpenAtLogin: paths.isPackaged,
  });
  const persistedPreferences = await preferences.apply();

  const agentConfig = await loadAgentConfigFile(join(paths.appDataRoot, "agents.json"));
  const agentCatalog = resolveAgentCatalog({ config: agentConfig });
  const registryOverrides = agentRegistryOverrides(agentCatalog);

  const agentRuntime = new BabyMenuAgentRuntime(paths.appDataRoot, {
    agentName: persistedPreferences.agentName,
    registryOverrides: Object.keys(registryOverrides).length > 0 ? registryOverrides : undefined,
    paths: {
      extensionsDir: paths.extensionsDir,
      agentStateDir: paths.agentStateDir,
      snapshotDir: paths.devExtensionSnapshotDir,
      isPackaged: paths.isPackaged,
    },
  });
  const database = createExtensionDatabase(paths.databasePath);
  const notify = createNotifier();

  async function buildSettings(): Promise<BabyMenuSettings> {
    const current = await preferences.get();
    return {
      openAtLogin: current.openAtLogin,
      agentName: agentRuntime.currentAgent,
      agentSwitchDisabledReason: agentRuntime.agentSwitchDisabledReason,
      agents: toAgentOptions(agentCatalog, commandExists),
    };
  }

  const settingsController = {
    get: buildSettings,
    async setOpenAtLogin(openAtLogin: boolean) {
      await preferences.setOpenAtLogin(openAtLogin);
      return buildSettings();
    },
    async setAgent(agentName: string) {
      await agentRuntime.setAgent(agentName);
      await preferences.setAgent(agentName);
      return buildSettings();
    },
  };

  const serverActions = createServerActionRegistry({
    rootDir: paths.appDataRoot,
    actionRoots: [paths.extensionsDir],
    cacheDir: paths.serverActionCacheDir,
    db: database,
    notify,
  });
  const widgetModules = createWidgetModuleRegistry({
    rootDir: paths.appDataRoot,
    extensionsDir: paths.extensionsDir,
    mode: paths.isPackaged ? "compiled" : "vite",
    widgetCacheDir: paths.widgetCacheDir,
  });

  registerIpcHandlers(
    paths.appDataRoot,
    agentRuntime,
    serverActions,
    widgetModules,
    { setContentHeight: setPopoverContentHeight, getVisibility: () => ({ visible: popoverWindow?.isVisible() ?? false }) },
    settingsController,
    undefined,
    { recipesDir: paths.recipesDir, database },
  );
  activeTray = createBabyMenuTray(
    (bounds) => {
      void togglePopover(bounds);
    },
    { iconPath: paths.trayIconPath },
  );

  // Background tasks run on their own cadence in the main process, regardless of whether
  // the popover is open, and notify open widgets to re-read when a run completes.
  const backgroundTasks = createBackgroundTaskScheduler({
    source: createBackgroundTaskSource({
      rootDir: paths.appDataRoot,
      actionRoots: [paths.extensionsDir],
      cacheDir: paths.serverActionCacheDir,
    }),
    context: { rootDir: paths.appDataRoot, db: database, notify },
    watchDir: paths.extensionsDir,
    onTaskRun: (extensionId) => {
      if (!popoverWindow?.isVisible()) return;
      sendToPopover("baby-menu:background:update", { extensionId });
    },
  });
  void backgroundTasks.start();

  app.on("activate", () => undefined);
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", () => {
    backgroundTasks.stop();
    database.close();
  });
}

if (!process.env.VITEST) {
  void startBabyMenuApp();
}
