// Integration repro for the 0.1.13 launch crash: a symlinked extension
// workspace (the home-manager mkOutOfStoreSymlink pattern) made the seeder's
// fs.cp throw ERR_FS_CP_DIR_TO_NON_DIR before the tray was ever created. This
// drives the REAL startBabyMenuApp with the REAL seeder against a symlinked
// temp workspace, so it fails if startup aborts OR if seeding does not land in
// the resolved target. Only Electron-surface deps are mocked.
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rectangle } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathsRef = vi.hoisted(() => ({ current: null as unknown }));

const trayInstance = { tray: {}, getBounds: vi.fn() };
const createBabyMenuTray = vi.fn((_onClick: (bounds: Rectangle) => void) => trayInstance);

const electronApp = {
  commandLine: { appendSwitch: vi.fn() },
  dock: { hide: vi.fn() },
  getPath: vi.fn(() => "/tmp"),
  getVersion: vi.fn(() => "0.0.0-test"),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
  setLoginItemSettings: vi.fn(),
  setActivationPolicy: vi.fn(),
  focus: vi.fn(),
  isPackaged: false,
  on: vi.fn(),
  whenReady: vi.fn(async () => undefined),
};
const browserWindowInstance = {
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => false),
  setBounds: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  hide: vi.fn(),
  on: vi.fn(),
  loadFile: vi.fn(async () => undefined),
  loadURL: vi.fn(async () => undefined),
  webContents: { send: vi.fn() },
};

vi.mock("electron", () => ({
  app: electronApp,
  BrowserWindow: vi.fn(() => browserWindowInstance),
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  screen: { getDisplayNearestPoint: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })) },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

// Inject a runtime-paths object pointing at the per-test temp workspace. The
// seeder is intentionally NOT mocked - it runs for real against these paths.
vi.mock("../src/main/app-paths", () => ({
  resolveBabyMenuRuntimePaths: () => pathsRef.current,
}));

vi.mock("../src/main/ipc", () => ({ registerIpcHandlers: vi.fn() }));
vi.mock("../src/main/telemetry", () => {
  const client = { track: vi.fn(), pageview: vi.fn(), close: vi.fn(async () => undefined) };
  return { initDefaultTelemetry: vi.fn(() => client), getDefaultTelemetry: vi.fn(() => client) };
});
vi.mock("../src/main/agent-runtime", () => ({
  BabyMenuAgentRuntime: vi.fn(function (this: Record<string, unknown>) {
    this.currentAgent = "test";
    this.agentSwitchDisabledReason = undefined;
    this.setRegistryOverrides = vi.fn();
  }),
  commandExists: vi.fn(() => false),
}));
vi.mock("../src/main/agent-catalog-controller", () => ({
  createAgentCatalogController: vi.fn(() => ({
    load: vi.fn(async () => undefined),
    overrides: {},
    options: vi.fn(() => []),
  })),
}));
vi.mock("../src/main/preferences", () => ({
  createPreferencesService: vi.fn(() => ({ apply: vi.fn(async () => ({ openAtLogin: false })), get: vi.fn(async () => ({ openAtLogin: false })) })),
}));
vi.mock("../src/main/server-action-registry", () => ({
  createServerActionRegistry: vi.fn(() => ({})),
  createBackgroundTaskSource: vi.fn(() => ({ list: vi.fn(async () => []) })),
}));
vi.mock("../src/main/background-task-scheduler", () => ({
  createBackgroundTaskScheduler: vi.fn(() => ({ start: vi.fn(async () => undefined), stop: vi.fn() })),
}));
vi.mock("../src/main/extension-database", () => ({ createExtensionDatabase: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("../src/main/notifier", () => ({ createNotifier: vi.fn(() => vi.fn()) }));
vi.mock("../src/main/update-checker", () => ({
  createUpdateChecker: vi.fn(() => ({ getStatus: vi.fn(), openReleasePage: vi.fn() })),
}));
vi.mock("../src/main/widget-module-registry", () => ({
  createWidgetModuleRegistry: vi.fn(() => ({})),
  createLayoutModuleRegistry: vi.fn(() => ({ get: vi.fn(async () => null) })),
}));
vi.mock("../src/main/widget-protocol", () => ({
  registerBabyMenuProtocolHandlers: vi.fn(),
  registerBabyMenuProtocolSchemes: vi.fn(),
}));
vi.mock("../src/main/tray", () => ({ createBabyMenuTray }));
vi.mock("../src/main/shell-path", () => ({ expandProcessPathForGuiLaunch: vi.fn(() => "/usr/bin:/bin") }));
vi.mock("../src/shared/paths", () => ({ EXTENSIONS_DIR_ENV: "BABY_MENU_EXTENSIONS_DIR", getRepoRoot: vi.fn(() => "/repo") }));

describe("startBabyMenuApp with a symlinked extension workspace", () => {
  const tempDirs: string[] = [];
  let templateDir: string;
  let symlinkTarget: string;
  let extensionsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const root = await mkdtemp(join(tmpdir(), "baby-menu-launch-"));
    tempDirs.push(root);

    // A bundled template that the seeder force-copies on launch.
    templateDir = join(root, "extensions-template");
    await mkdir(join(templateDir, "hello-world"), { recursive: true });
    await writeFile(join(templateDir, "AGENTS.md"), "template rules\n");
    await writeFile(join(templateDir, "hello-world", "widget.tsx"), "export const helloWorldWidget = {};\n");

    // The workspace is a symlink into a writable dir (mkOutOfStoreSymlink), and
    // already holds a user-created extension that must survive seeding.
    symlinkTarget = join(root, "dotfiles-extensions");
    await mkdir(join(symlinkTarget, "my-ext"), { recursive: true });
    await writeFile(join(symlinkTarget, "my-ext", "widget.tsx"), "export const myWidget = {};\n");
    extensionsDir = join(root, "extensions");
    await symlink(symlinkTarget, extensionsDir);

    pathsRef.current = {
      appDataRoot: root,
      sourceRoot: root,
      extensionsDir,
      recipesDir: join(extensionsDir, "recipes"),
      cacheDir: join(root, "cache"),
      widgetCacheDir: join(root, "cache", "widgets"),
      serverActionCacheDir: join(root, "cache", "server-actions"),
      agentStateDir: join(root, "cache", "acp-sessions"),
      devExtensionSnapshotDir: join(root, "cache", "snapshots"),
      bundledExtensionTemplateDir: templateDir,
      trayIconPath: join(root, "tray.png"),
      databasePath: join(root, "baby-menu.db"),
      adaptersDir: join(root, "adapters"),
      isPackaged: false,
    };
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("launches without crashing, creates the tray, and seeds the resolved real target", async () => {
    const appModule = await import("../src/main/app");

    await expect(appModule.startBabyMenuApp()).resolves.toBeUndefined();

    // Startup reached tray creation instead of aborting on the seeder throw.
    expect(createBabyMenuTray).toHaveBeenCalledWith(expect.any(Function), { iconPath: join(tempDirs[0], "tray.png") });
    expect(appModule.getActiveBabyMenuTray()).toBe(trayInstance);

    // The seed resolved the symlink and landed in the real writable target...
    await expect(readFile(join(symlinkTarget, "AGENTS.md"), "utf8")).resolves.toBe("template rules\n");
    await expect(readFile(join(symlinkTarget, "hello-world", "widget.tsx"), "utf8")).resolves.toBe(
      "export const helloWorldWidget = {};\n",
    );
    // ...the user-created extension survived...
    await expect(readFile(join(symlinkTarget, "my-ext", "widget.tsx"), "utf8")).resolves.toBe(
      "export const myWidget = {};\n",
    );
    // ...and the user-owned symlink was never replaced.
    await expect(lstat(extensionsDir).then((s) => s.isSymbolicLink())).resolves.toBe(true);
  });
});
