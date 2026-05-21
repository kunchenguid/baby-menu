import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Rectangle } from "electron";

const trayInstance = {
  tray: {},
  getBounds: vi.fn(),
};

const electronApp = {
  dock: { hide: vi.fn() },
  getPath: vi.fn((name: string) => (name === "home" ? "/home/test-user" : "/tmp")),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
  setLoginItemSettings: vi.fn(),
  isPackaged: false,
  on: vi.fn(),
  whenReady: vi.fn(async () => undefined),
};

const createBabyMenuTray = vi.fn((_onClick: (bounds: Rectangle) => void) => trayInstance);
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
};
const BrowserWindow = vi.fn(function BrowserWindowMock() {
  return browserWindowInstance;
});
const getDisplayNearestPoint = vi.fn(() => ({
  workArea: { x: 0, y: 0, width: 1440, height: 900 },
}));
const protocol = {
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn(),
};
const registerIpcHandlers = vi.fn();

vi.mock("electron", () => ({
  app: electronApp,
  BrowserWindow,
  protocol,
  screen: { getDisplayNearestPoint },
}));

vi.mock("../src/main/ipc", () => ({
  registerIpcHandlers,
}));

vi.mock("../src/main/agent-runtime", () => ({
  BabyMenuAgentRuntime: vi.fn(),
}));

vi.mock("../src/main/extension-seeder", () => ({
  seedExtensionWorkspace: vi.fn(async () => undefined),
}));

vi.mock("../src/main/server-action-registry", () => ({
  createServerActionRegistry: vi.fn(() => ({})),
}));

vi.mock("../src/main/widget-module-registry", () => ({
  createWidgetModuleRegistry: vi.fn(() => ({})),
}));

vi.mock("../src/main/widget-protocol", () => ({
  registerBabyMenuProtocolHandlers: vi.fn(),
  registerBabyMenuProtocolSchemes: vi.fn(),
}));

vi.mock("../src/main/tray", () => ({
  createBabyMenuTray,
}));

vi.mock("../src/main/shell-path", () => ({
  expandProcessPathForGuiLaunch: vi.fn(() => "/usr/bin:/bin"),
}));

vi.mock("../src/shared/paths", () => ({
  EXTENSIONS_DIR_ENV: "BABY_MENU_EXTENSIONS_DIR",
  getRepoRoot: vi.fn(() => "/repo"),
}));

describe("startBabyMenuApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronApp.isPackaged = false;
    browserWindowInstance.isDestroyed.mockReturnValue(false);
    browserWindowInstance.isVisible.mockReturnValue(false);
  });

  it("retains the tray object for the app lifetime", async () => {
    const appModule = (await import("../src/main/app")) as typeof import("../src/main/app") & {
      getActiveBabyMenuTray?: () => unknown;
    };

    expect(typeof appModule.getActiveBabyMenuTray).toBe("function");

    await appModule.startBabyMenuApp();

    expect(createBabyMenuTray).toHaveBeenCalledWith(expect.any(Function), {
      iconPath: "/repo/assets/tray/baby_menuTemplate.png",
    });
    expect(appModule.getActiveBabyMenuTray?.()).toBe(trayInstance);
  });

  it("creates the popover with the CommonJS preload bridge", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];

    expect(onTrayClick).toBeTypeOf("function");
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          preload: expect.stringMatching(/preload\/index\.cjs$/),
        }),
      }),
    );
  });

  it("wires content-height resize reports into the popover bounds", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const popoverController = registerIpcHandlers.mock.calls.at(-1)?.[4];
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    popoverController.setContentHeight(333);

    expect(browserWindowInstance.setBounds).toHaveBeenLastCalledWith({ x: 8, y: 42, width: 360, height: 333 });
  });

  it("does not opt source dev mode into opening at login", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();

    expect(electronApp.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it("opts packaged app launches into opening at login by default", async () => {
    electronApp.isPackaged = true;
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/Applications/Baby Menu.app/Contents/Resources",
    });
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();

    expect(electronApp.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });
});
