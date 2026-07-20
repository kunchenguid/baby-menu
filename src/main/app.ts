import { app, BrowserWindow, screen, shell, type Rectangle } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BabyMenuCustomAgentInput, BabyMenuSettings } from "../shared/contracts";
import { getRepoRoot } from "../shared/paths";
import { createAgentCatalogController } from "./agent-catalog-controller";
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
import { createPiKimiCredentialResolver } from "./pi-kimi-credential-resolver";
import {
  createKimiCodeCliCredentialResolver,
  createKimiCredentialResolverChain,
} from "./kimi-code-cli-credential-resolver";
import { createKimiQuotaBroker } from "./kimi-quota-broker";
import { createPreferencesService } from "./preferences";
import { createBackgroundTaskSource, createServerActionRegistry } from "./server-action-registry";
import { getDefaultTelemetry, initDefaultTelemetry } from "./telemetry";
import { expandProcessPathForGuiLaunch } from "./shell-path";
import { createUpdateChecker } from "./update-checker";
import { createBabyMenuTray, type BabyMenuTray } from "./tray";
import { createLayoutModuleRegistry, createWidgetModuleRegistry } from "./widget-module-registry";
import { registerBabyMenuProtocolHandlers, registerBabyMenuProtocolSchemes } from "./widget-protocol";

if (process.platform === "darwin") {
  app.commandLine.appendSwitch("use-mock-keychain");
}

const remoteDebuggingPort = Number(process.env.BABY_MENU_REMOTE_DEBUGGING_PORT);
if (Number.isInteger(remoteDebuggingPort) && remoteDebuggingPort >= 1 && remoteDebuggingPort <= 65_535) {
  app.commandLine.appendSwitch("remote-debugging-port", String(remoteDebuggingPort));
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
  latestTrayBounds = trayBounds;
  const window = await createPopoverWindow();
  if (window.isVisible()) {
    window.hide();
    return;
  }

  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  window.setBounds(calculatePopoverBounds(trayBounds, display.workArea, latestPopoverSize));
  setPopoverKeyWindowActive(true);
  window.show();
  window.focus();
  // The popover is baby-menu's single screen, so opening it is the app's page
  // view. Send a Umami pageview (empty event name) so the dashboard's Views /
  // Visitors / Pages reports populate, and keep the named event for funnels.
  const telemetry = getDefaultTelemetry();
  telemetry.pageview("/popover");
  telemetry.track("popover_open");
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

function setPopoverContentSize(size: { width: number; height: number }) {
  const workArea = latestTrayBounds
    ? screen.getDisplayNearestPoint({ x: latestTrayBounds.x, y: latestTrayBounds.y }).workArea
    : undefined;
  latestPopoverSize = responsivePopoverSize(size, workArea);
  if (!latestTrayBounds || !popoverWindow || popoverWindow.isDestroyed()) return;

  const display = screen.getDisplayNearestPoint({ x: latestTrayBounds.x, y: latestTrayBounds.y });
  popoverWindow.setBounds(calculatePopoverBounds(latestTrayBounds, display.workArea, latestPopoverSize));
}

// Retained for the height-only bridge call; keeps the current width and lets the
// new width+height path own the full adaptive sizing.
function setPopoverContentHeight(height: number) {
  setPopoverContentSize({ width: latestPopoverSize.width, height });
}

export async function startBabyMenuApp(): Promise<void> {
  expandProcessPathForGuiLaunch();
  await app.whenReady();

  // Anonymous, best-effort usage telemetry. No-op unless a build-time Umami
  // website id was injected (packaged release builds only); see ./telemetry.
  const telemetry = initDefaultTelemetry({
    app: "baby-menu",
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
  });
  telemetry.track("app_start");

  const sourceRoot = getRepoRoot();
  const paths = resolveBabyMenuRuntimePaths(sourceRoot);
  // Seeding the bundled defaults is best-effort: it touches a user-owned
  // workspace that can be a read-only or managed (home-manager / Nix) symlink,
  // and the embedded agent self-heals it later anyway. A failure here must never
  // prevent the tray from appearing, so it is contained rather than fatal.
  try {
    await seedExtensionWorkspace({ extensionsDir: paths.extensionsDir, templateDir: paths.bundledExtensionTemplateDir });
  } catch (error) {
    console.error("[baby-menu] extension workspace seeding failed; continuing startup", error);
  }
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

  // Built-in claude/codex agents are driven by the bundled clean-room ACP
  // adapters. Run them with the bundled Electron as Node (ELECTRON_RUN_AS_NODE)
  // so there is no dependency on a separately-installed `node` - the same class
  // of PATH fragility that made the agent look "unavailable" before.
  const adapterLauncher = ["env", "ELECTRON_RUN_AS_NODE=1", process.execPath];
  // The catalog is a live runtime service: it owns agents.json and pushes
  // rebuilt registry overrides into the runtime so UI-added custom agents apply
  // immediately. agentRuntime is referenced through closures (assigned just below)
  // and only invoked after startup, so the forward reference is safe.
  let agentRuntime: BabyMenuAgentRuntime;
  const agentCatalog = createAgentCatalogController({
    agentsJsonPath: join(paths.appDataRoot, "agents.json"),
    resolveAdapterPath: (adapter) => join(paths.adaptersDir, adapter, "index.mjs"),
    adapterLauncher,
    commandExists,
    getActiveAgentName: () => agentRuntime.currentAgent,
    onOverridesChange: (overrides) => agentRuntime.setRegistryOverrides(overrides),
  });
  await agentCatalog.load();

  agentRuntime = new BabyMenuAgentRuntime(paths.appDataRoot, {
    agentName: persistedPreferences.agentName,
    registryOverrides: Object.keys(agentCatalog.overrides).length > 0 ? agentCatalog.overrides : undefined,
    telemetry,
    paths: {
      extensionsDir: paths.extensionsDir,
      agentStateDir: paths.agentStateDir,
      snapshotDir: paths.devExtensionSnapshotDir,
      isPackaged: paths.isPackaged,
    },
  });
  const database = createExtensionDatabase(paths.databasePath);
  const notify = createNotifier();
  const kimiQuota = createKimiQuotaBroker({
    db: database,
    credentialResolver: createKimiCredentialResolverChain([
      createPiKimiCredentialResolver(),
      createKimiCodeCliCredentialResolver(),
    ]),
    userAgent: `baby-menu/${app.getVersion()}`,
  });

  async function buildSettings(): Promise<BabyMenuSettings> {
    const current = await preferences.get();
    return {
      openAtLogin: current.openAtLogin,
      agentName: agentRuntime.currentAgent,
      agentSwitchDisabledReason: agentRuntime.agentSwitchDisabledReason,
      agents: agentCatalog.options(),
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
    async addAgent(input: BabyMenuCustomAgentInput) {
      await agentCatalog.addAgent(input);
      return buildSettings();
    },
    async updateAgent(name: string, input: { label?: string; command: string }) {
      await agentCatalog.updateAgent(name, input);
      return buildSettings();
    },
    async removeAgent(name: string) {
      await agentCatalog.removeAgent(name);
      return buildSettings();
    },
  };

  const serverActions = createServerActionRegistry({
    rootDir: paths.appDataRoot,
    actionRoots: [paths.extensionsDir],
    cacheDir: paths.serverActionCacheDir,
    db: database,
    notify,
    kimiQuota,
  });
  const widgetRegistryOptions = {
    rootDir: paths.appDataRoot,
    extensionsDir: paths.extensionsDir,
    mode: (paths.isPackaged ? "compiled" : "vite") as "compiled" | "vite",
    widgetCacheDir: paths.widgetCacheDir,
  };
  const widgetModules = createWidgetModuleRegistry(widgetRegistryOptions);
  const layoutModules = createLayoutModuleRegistry(widgetRegistryOptions);

  const updateChecker = createUpdateChecker({
    currentVersion: app.getVersion(),
    openExternal: (url) => shell.openExternal(url),
    // Dev/source builds are never "behind" a release, so force the indicator on
    // there to make it visible while developing. Packaged builds do the real check.
    simulateUpdate: !app.isPackaged,
  });

  registerIpcHandlers(
    paths.appDataRoot,
    agentRuntime,
    serverActions,
    widgetModules,
    {
      setContentHeight: setPopoverContentHeight,
      setContentSize: setPopoverContentSize,
      getVisibility: () => ({ visible: popoverWindow?.isVisible() ?? false }),
    },
    settingsController,
    {
      quit: () => app.quit(),
      getUpdateStatus: () => updateChecker.getStatus(),
      openReleasePage: () => updateChecker.openReleasePage(),
    },
    { recipesDir: paths.recipesDir, database, layoutModules },
  );
  activeTray = createBabyMenuTray(
    (bounds) => {
      void togglePopover(bounds);
    },
    { iconPath: paths.trayIconPath },
  );

  if (process.env.BABY_MENU_OPEN_POPOVER_ON_START === "1") {
    await togglePopover(activeTray.getBounds());
  }

  // Background tasks run on their own cadence in the main process, regardless of whether
  // the popover is open, and notify open widgets to re-read when a run completes.
  const backgroundTasks = createBackgroundTaskScheduler({
    source: createBackgroundTaskSource({
      rootDir: paths.appDataRoot,
      actionRoots: [paths.extensionsDir],
      cacheDir: paths.serverActionCacheDir,
    }),
    context: { rootDir: paths.appDataRoot, db: database, notify, kimiQuota },
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
    void telemetry.close(1_000);
  });
}

if (!process.env.VITEST) {
  // Last-resort guard: an unhandled rejection here would otherwise leave a dead
  // app with a lingering dock icon and no tray, with no diagnostic in the logs.
  startBabyMenuApp().catch((error) => {
    console.error("[baby-menu] fatal startup error", error);
  });
}
