import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Rectangle } from "electron";

const trayInstance = {
  tray: {},
  getBounds: vi.fn(),
};

const electronApp = {
  commandLine: { appendSwitch: vi.fn() },
  dock: { hide: vi.fn() },
  getPath: vi.fn((name: string): string => {
    if (name === "home") return "/home/test-user";
    if (name === "exe") return "/tmp/Baby Menu Dev.app/Contents/MacOS/Baby Menu Dev";
    return "/tmp";
  }),
  getVersion: vi.fn(() => "0.0.0-test"),
  getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
  setLoginItemSettings: vi.fn(),
  setActivationPolicy: vi.fn(),
  focus: vi.fn(),
  isPackaged: false,
  on: vi.fn(),
  whenReady: vi.fn(async () => undefined),
  isReady: vi.fn(() => true),
  requestSingleInstanceLock: vi.fn(() => true),
  quit: vi.fn(),
};

const createBabyMenuTray = vi.fn((_onClick: (bounds: Rectangle) => void) => trayInstance);
const browserWindowInstance = {
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => false),
  setBounds: vi.fn(),
  setContentSize: vi.fn(),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 504, height: 620 })),
  setPosition: vi.fn(),
  center: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  hide: vi.fn(),
  on: vi.fn(),
  loadFile: vi.fn(async () => undefined),
  loadURL: vi.fn(async () => undefined),
  webContents: { send: vi.fn() },
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
const telemetryClient = {
  track: vi.fn(),
  pageview: vi.fn(),
  close: vi.fn(async () => undefined),
};

vi.mock("electron", () => ({
  app: electronApp,
  BrowserWindow,
  protocol,
  screen: { getDisplayNearestPoint },
  shell: { openExternal: vi.fn(async () => undefined) },
}));

vi.mock("../src/main/ipc", () => ({
  registerIpcHandlers,
}));

vi.mock("../src/main/telemetry", () => ({
  initDefaultTelemetry: vi.fn(() => telemetryClient),
  getDefaultTelemetry: vi.fn(() => telemetryClient),
}));

vi.mock("../src/main/agent-runtime", () => ({
  BabyMenuAgentRuntime: vi.fn(),
  commandExists: vi.fn(() => false),
}));

vi.mock("../src/main/extension-seeder", () => ({
  seedExtensionWorkspace: vi.fn(async () => undefined),
}));

vi.mock("../src/main/server-action-registry", () => ({
  createServerActionRegistry: vi.fn(() => ({})),
  createBackgroundTaskSource: vi.fn(() => ({ list: vi.fn(async () => []) })),
}));

vi.mock("../src/main/background-task-scheduler", () => ({
  createBackgroundTaskScheduler: vi.fn(() => ({
    start: vi.fn(async () => undefined),
    resync: vi.fn(async () => undefined),
    stop: vi.fn(),
  })),
}));

vi.mock("../src/main/extension-database", () => ({
  createExtensionDatabase: vi.fn(() => ({
    query: vi.fn(() => []),
    get: vi.fn(),
    run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
    exec: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
  })),
}));

vi.mock("../src/main/widget-module-registry", () => ({
  createWidgetModuleRegistry: vi.fn(() => ({})),
  createLayoutModuleRegistry: vi.fn(() => ({ get: vi.fn(async () => null) })),
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
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    electronApp.isPackaged = false;
    electronApp.getPath.mockImplementation((name: string) => {
      if (name === "home") return "/home/test-user";
      if (name === "exe") return "/tmp/Baby Menu Dev.app/Contents/MacOS/Baby Menu Dev";
      return "/tmp";
    });
    browserWindowInstance.isDestroyed.mockReturnValue(false);
    browserWindowInstance.isVisible.mockReturnValue(false);
    trayInstance.getBounds.mockReturnValue({ x: 100, y: 10, width: 24, height: 24 });
    electronApp.requestSingleInstanceLock.mockReturnValue(true);
    delete process.env.BABY_MENU_OPEN_POPOVER_ON_START;
    delete process.env.BABY_MENU_REMOTE_DEBUGGING_PORT;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  afterEach(() => {
    delete process.env.BABY_MENU_OPEN_POPOVER_ON_START;
    delete process.env.BABY_MENU_REMOTE_DEBUGGING_PORT;
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("disables Chromium keychain prompts before app startup on macOS", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });

    await import("../src/main/app");

    expect(electronApp.commandLine.appendSwitch).toHaveBeenCalledWith("use-mock-keychain");
  });

  it("disables the Chromium keyring backend before app startup on Linux", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "linux",
    });

    await import("../src/main/app");

    expect(electronApp.commandLine.appendSwitch).toHaveBeenCalledWith("password-store", "basic");
    expect(electronApp.commandLine.appendSwitch).not.toHaveBeenCalledWith("use-mock-keychain");
  });

  it("accepts a validated remote debugging port for unattended popover checks", async () => {
    process.env.BABY_MENU_REMOTE_DEBUGGING_PORT = "9333";

    await import("../src/main/app");

    expect(electronApp.commandLine.appendSwitch).toHaveBeenCalledWith("remote-debugging-port", "9333");
  });

  it("ignores invalid remote debugging ports", async () => {
    process.env.BABY_MENU_REMOTE_DEBUGGING_PORT = "9333 --inspect";

    await import("../src/main/app");

    expect(electronApp.commandLine.appendSwitch).not.toHaveBeenCalledWith("remote-debugging-port", expect.anything());
  });

  it("opens the real popover on startup when the unattended-check seam is enabled", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      process.env.BABY_MENU_OPEN_POPOVER_ON_START = "1";
      const appModule = await import("../src/main/app");

      await appModule.startBabyMenuApp();

      await vi.waitFor(() => expect(browserWindowInstance.show).toHaveBeenCalled());
      expect(trayInstance.getBounds).toHaveBeenCalled();
      expect(browserWindowInstance.setBounds).toHaveBeenCalledWith({ x: 8, y: 42, width: 504, height: 620 });
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("retains the tray object for the app lifetime", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const appModule = (await import("../src/main/app")) as typeof import("../src/main/app") & {
        getActiveBabyMenuTray?: () => unknown;
      };

      expect(typeof appModule.getActiveBabyMenuTray).toBe("function");

      await appModule.startBabyMenuApp();

      expect(createBabyMenuTray).toHaveBeenCalledWith(expect.any(Function), {
        iconPath: "/repo/assets/tray/baby_menuTemplate.png",
      });
      expect(appModule.getActiveBabyMenuTray?.()).toBe(trayInstance);
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("still creates the tray when extension workspace seeding fails", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const { seedExtensionWorkspace } = await import("../src/main/extension-seeder");
      (seedExtensionWorkspace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EISDIR: symlinked workspace"));
      const appModule = await import("../src/main/app");

      await expect(appModule.startBabyMenuApp()).resolves.toBeUndefined();

      expect(createBabyMenuTray).toHaveBeenCalledWith(expect.any(Function), {
        iconPath: "/repo/assets/tray/baby_menuTemplate.png",
      });
      expect(appModule.getActiveBabyMenuTray()).toBe(trayInstance);
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
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
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const appModule = await import("../src/main/app");

      await appModule.startBabyMenuApp();
      const popoverController = registerIpcHandlers.mock.calls.at(-1)?.[4];
      const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
      await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });
      await vi.waitFor(() => expect(browserWindowInstance.setBounds).toHaveBeenCalled());

      popoverController.setContentHeight(333);

      expect(browserWindowInstance.setBounds).toHaveBeenLastCalledWith({ x: 8, y: 42, width: 504, height: 333 });
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("caps initial renderer size reports before first popover bounds", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      const appModule = await import("../src/main/app");

      await appModule.startBabyMenuApp();
      const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
      browserWindowInstance.loadFile.mockImplementationOnce(async () => {
        const popoverController = registerIpcHandlers.mock.calls.at(-1)?.[4];
        popoverController.setContentSize({ width: 2000, height: 300 });
      });

      await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

      await vi.waitFor(() =>
        expect(browserWindowInstance.setBounds).toHaveBeenLastCalledWith({ x: 8, y: 42, width: 1424, height: 300 }),
      );
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("starts the background scheduler and only forwards task-run events to visible renderer", async () => {
    const { createBackgroundTaskScheduler } = await import("../src/main/background-task-scheduler");
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    const schedulerOptions = (createBackgroundTaskScheduler as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
    expect(schedulerOptions.watchDir).toBe("/repo/extensions");

    browserWindowInstance.webContents.send.mockClear();
    browserWindowInstance.isVisible.mockReturnValue(false);
    schedulerOptions.onTaskRun("cpu-usage");
    expect(browserWindowInstance.webContents.send).not.toHaveBeenCalled();

    browserWindowInstance.isVisible.mockReturnValue(true);
    schedulerOptions.onTaskRun("cpu-usage");
    expect(browserWindowInstance.webContents.send).toHaveBeenCalledWith("baby-menu:background:update", {
      extensionId: "cpu-usage",
    });
  });

  it("emits popover visibility to the renderer on show and hide", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    const onShow = browserWindowInstance.on.mock.calls.find(([event]) => event === "show")?.[1];
    const onHide = browserWindowInstance.on.mock.calls.find(([event]) => event === "hide")?.[1];

    onShow?.();
    expect(browserWindowInstance.webContents.send).toHaveBeenCalledWith("baby-menu:popover:visibility", {
      visible: true,
    });

    onHide?.();
    expect(browserWindowInstance.webContents.send).toHaveBeenLastCalledWith("baby-menu:popover:visibility", {
      visible: false,
    });
  });

  it("records popover opens as both a pageview and a named event", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    await vi.waitFor(() => expect(telemetryClient.pageview).toHaveBeenCalledWith("/popover"));
    expect(telemetryClient.track).toHaveBeenCalledWith("popover_open");
  });

  it("does not touch login items in source dev mode", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();

    expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it.each(["Baby Menu Dev", "Baby Menu Test"])(
    "does not touch login items for the packaged %s bundle",
    async (appName) => {
      electronApp.isPackaged = true;
      electronApp.getPath.mockImplementation((name: string) => {
        if (name === "home") return "/home/test-user";
        if (name === "exe") return `/tmp/${appName}.app/Contents/MacOS/${appName}`;
        return "/tmp";
      });
      Object.defineProperty(process, "resourcesPath", {
        configurable: true,
        value: `/tmp/${appName}.app/Contents/Resources`,
      });
      const appModule = await import("../src/main/app");

      await appModule.startBabyMenuApp();

      expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
    },
  );

  it("opts the packaged production app into opening at login by default", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    try {
      electronApp.isPackaged = true;
      electronApp.getPath.mockImplementation((name: string) => {
        if (name === "home") return "/home/test-user";
        if (name === "exe") return "/Applications/Baby Menu.app/Contents/MacOS/Baby Menu";
        return "/tmp";
      });
      Object.defineProperty(process, "resourcesPath", {
        configurable: true,
        value: "/Applications/Baby Menu.app/Contents/Resources",
      });
      const appModule = await import("../src/main/app");

      await appModule.startBabyMenuApp();

      expect(electronApp.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    } finally {
      if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
    }
  });

  it("temporarily uses regular activation policy while the macOS popover is visible", async () => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "darwin",
    });
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    await vi.waitFor(() =>
      expect((electronApp as { setActivationPolicy: ReturnType<typeof vi.fn> }).setActivationPolicy).toHaveBeenCalledWith(
        "regular",
      ),
    );
    expect((electronApp as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalledWith({ steal: true });

    const onHide = browserWindowInstance.on.mock.calls.find(([event]) => event === "hide")?.[1];
    onHide?.();

    expect((electronApp as { setActivationPolicy: ReturnType<typeof vi.fn> }).setActivationPolicy).toHaveBeenLastCalledWith(
      "accessory",
    );
  });
});

describe("linux popover placement", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    electronApp.isPackaged = false;
    browserWindowInstance.isDestroyed.mockReturnValue(false);
    browserWindowInstance.isVisible.mockReturnValue(false);
    // Linux tray clicks carry an empty rectangle: Tray.getBounds is macOS and
    // Windows only.
    trayInstance.getBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
    process.env.BABY_MENU_OPEN_POPOVER_ON_START = "1";
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  });

  afterEach(() => {
    delete process.env.BABY_MENU_OPEN_POPOVER_ON_START;
    Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
    // vi.clearAllMocks() drops recorded calls but keeps configured implementations,
    // so a work area or window position set by one test would leak into the next.
    getDisplayNearestPoint.mockImplementation(() => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }));
    browserWindowInstance.getBounds.mockImplementation(() => ({ x: 0, y: 0, width: 504, height: 620 }));
  });

  it("sizes and centers the popover instead of anchoring it to tray bounds", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();

    expect(browserWindowInstance.setBounds).not.toHaveBeenCalled();
    expect(browserWindowInstance.setContentSize).toHaveBeenCalledWith(504, 620);
    expect(browserWindowInstance.center).toHaveBeenCalledTimes(1);
    expect(browserWindowInstance.show).toHaveBeenCalled();
  });

  it("re-sizes without re-centering when the renderer reports a new canvas size", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    const setContentSize = registerIpcHandlers.mock.calls[0][4].setContentSize as (size: {
      width: number;
      height: number;
    }) => void;
    setContentSize({ width: 840, height: 400 });

    expect(browserWindowInstance.setContentSize).toHaveBeenLastCalledWith(840, 400);
    expect(browserWindowInstance.setBounds).not.toHaveBeenCalled();
    expect(browserWindowInstance.center).toHaveBeenCalledTimes(1);
    // Still fully on-screen at 1440x900, so the clamp must leave it where it is.
    expect(browserWindowInstance.setPosition).not.toHaveBeenCalled();
  });

  it("clamps a grown popover back into the work area without re-centering it", async () => {
    getDisplayNearestPoint.mockReturnValue({ workArea: { x: 0, y: 0, width: 1366, height: 768 } });
    // Where center() left the default 504x620 popover on a 1366x768 work area.
    browserWindowInstance.getBounds.mockReturnValue({ x: 431, y: 74, width: 504, height: 620 });
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    const setContentSize = registerIpcHandlers.mock.calls[0][4].setContentSize as (size: {
      width: number;
      height: number;
    }) => void;
    setContentSize({ width: 504, height: 728 });

    // setContentSize anchors the top-left, so 720 tall from y=74 would run 26px
    // past the bottom of the work area and stay there.
    expect(browserWindowInstance.setContentSize).toHaveBeenLastCalledWith(504, 720);
    expect(browserWindowInstance.setPosition).toHaveBeenCalledWith(431, 48);
    expect(browserWindowInstance.center).toHaveBeenCalledTimes(1);
  });

  it("does not re-center on a second popover open", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

    expect(browserWindowInstance.center).toHaveBeenCalledTimes(1);
    expect(browserWindowInstance.show).toHaveBeenCalledTimes(2);
  });
});

describe("popover blur guard", () => {
  const originalPlatform = process.platform;

  function windowHandler(event: string): (() => void) | undefined {
    const call = browserWindowInstance.on.mock.calls.find(([name]) => name === event);
    return call?.[1] as (() => void) | undefined;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    electronApp.isPackaged = false;
    browserWindowInstance.isDestroyed.mockReturnValue(false);
    browserWindowInstance.isVisible.mockReturnValue(false);
    trayInstance.getBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
    process.env.BABY_MENU_OPEN_POPOVER_ON_START = "1";
    delete process.env.BABY_MENU_KEEP_POPOVER_OPEN;
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  });

  afterEach(() => {
    delete process.env.BABY_MENU_OPEN_POPOVER_ON_START;
    Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
  });

  it("ignores a blur delivered before the popover was ever focused", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    windowHandler("blur")?.();

    expect(browserWindowInstance.hide).not.toHaveBeenCalled();
  });

  it("hides on blur once the popover has been focused", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    windowHandler("focus")?.();
    windowHandler("blur")?.();

    expect(browserWindowInstance.hide).toHaveBeenCalledTimes(1);
  });

  it("still honors BABY_MENU_KEEP_POPOVER_OPEN after a focus", async () => {
    process.env.BABY_MENU_KEEP_POPOVER_OPEN = "1";
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    windowHandler("focus")?.();
    windowHandler("blur")?.();

    expect(browserWindowInstance.hide).not.toHaveBeenCalled();
    delete process.env.BABY_MENU_KEEP_POPOVER_OPEN;
  });

  it("re-arms the guard on every popover open, not just the first", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    windowHandler("focus")?.();
    windowHandler("blur")?.();
    windowHandler("hide")?.();

    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });
    // A compositor that delivers blur before focus does it on every surface map,
    // not only for a brand new window, so the second open must survive it too.
    windowHandler("blur")?.();

    expect(browserWindowInstance.hide).toHaveBeenCalledTimes(1);
  });
});

describe("single instance lock", () => {
  const originalPlatform = process.platform;

  function appHandler(event: string): ((...args: unknown[]) => void) | undefined {
    const call = electronApp.on.mock.calls.find(([name]) => name === event);
    return call?.[1] as ((...args: unknown[]) => void) | undefined;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    electronApp.isPackaged = false;
    electronApp.requestSingleInstanceLock.mockReturnValue(true);
    electronApp.isReady.mockReturnValue(true);
    browserWindowInstance.isDestroyed.mockReturnValue(false);
    browserWindowInstance.isVisible.mockReturnValue(false);
    trayInstance.getBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
    delete process.env.BABY_MENU_OPEN_POPOVER_ON_START;
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
  });

  it("ignores a --toggle second instance that arrives before the app is ready", async () => {
    const { startBabyMenuApp, TOGGLE_ARGUMENT } = await import("../src/main/app");

    await startBabyMenuApp();
    // A --toggle launch can land while this instance is still starting up.
    // Creating a BrowserWindow before readiness throws, and the rejection would
    // escape the fire-and-forget call and kill the main process.
    electronApp.isReady.mockReturnValue(false);

    appHandler("second-instance")?.({}, ["/usr/bin/baby-menu", TOGGLE_ARGUMENT]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(browserWindowInstance.show).not.toHaveBeenCalled();
  });

  it("quits a second instance instead of creating a second tray icon", async () => {
    electronApp.requestSingleInstanceLock.mockReturnValueOnce(false);
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();

    expect(electronApp.quit).toHaveBeenCalledTimes(1);
    expect(createBabyMenuTray).not.toHaveBeenCalled();
    expect(electronApp.whenReady).not.toHaveBeenCalled();
  });

  it("toggles the popover when a second instance passes --toggle", async () => {
    const { startBabyMenuApp, TOGGLE_ARGUMENT } = await import("../src/main/app");

    await startBabyMenuApp();
    expect(browserWindowInstance.show).not.toHaveBeenCalled();

    appHandler("second-instance")?.({}, ["/usr/bin/baby-menu", TOGGLE_ARGUMENT]);
    await vi.waitFor(() => expect(browserWindowInstance.show).toHaveBeenCalledTimes(1));
  });

  it("toggles the popover for a bare second launch too", async () => {
    const { startBabyMenuApp } = await import("../src/main/app");

    await startBabyMenuApp();
    expect(browserWindowInstance.show).not.toHaveBeenCalled();

    // Re-launching from the .desktop entry or an app grid carries no --toggle,
    // and on a tray-less GNOME session it is the user's only other entry point.
    appHandler("second-instance")?.({}, ["/usr/bin/baby-menu"]);
    await vi.waitFor(() => expect(browserWindowInstance.show).toHaveBeenCalledTimes(1));
  });

  it("ignores a second instance that arrives before startup finishes", async () => {
    const { startBabyMenuApp, TOGGLE_ARGUMENT } = await import("../src/main/app");
    // Readiness is not the end of startup: IPC handlers and the tray are only
    // registered several awaits later, so a popover opened here would come up
    // with every window.babyMenu.* call rejecting as unhandled.
    electronApp.whenReady.mockImplementationOnce(async () => {
      appHandler("second-instance")?.({}, ["/usr/bin/baby-menu", TOGGLE_ARGUMENT]);
    });

    await startBabyMenuApp();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(browserWindowInstance.show).not.toHaveBeenCalled();
    expect(BrowserWindow).not.toHaveBeenCalled();
  });
});

describe("linux autostart wiring", () => {
  const originalPlatform = process.platform;
  const originalResourcesPath = Object.getOwnPropertyDescriptor(process, "resourcesPath");
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    browserWindowInstance.isDestroyed.mockReturnValue(false);
    browserWindowInstance.isVisible.mockReturnValue(false);
    trayInstance.getBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 });
    electronApp.requestSingleInstanceLock.mockReturnValue(true);
    delete process.env.BABY_MENU_PACKAGED_TEST_HOME;
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
  });

  afterEach(async () => {
    electronApp.isPackaged = false;
    Object.defineProperty(process, "platform", { configurable: true, value: originalPlatform });
    // vi.clearAllMocks() clears recorded calls but not a configured implementation,
    // so a getPath pointing at a temp home deleted below would outlive this block.
    // createLinuxLoginItem reads getPath("home") unconditionally on Linux, where a
    // stale value is a startup TypeError rather than a silent no-op.
    electronApp.getPath.mockImplementation((name: string) => {
      if (name === "home") return "/home/test-user";
      if (name === "exe") return "/tmp/Baby Menu Dev.app/Contents/MacOS/Baby Menu Dev";
      return "/tmp";
    });
    if (originalResourcesPath) Object.defineProperty(process, "resourcesPath", originalResourcesPath);
    const { rm } = await import("node:fs/promises");
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("creates an autostart entry for the packaged production Linux executable", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "baby-menu-linux-home-"));
    tempDirs.push(home);

    electronApp.isPackaged = true;
    electronApp.getPath.mockImplementation((name: string) => {
      if (name === "home") return home;
      if (name === "exe") return "/usr/bin/baby-menu";
      return home;
    });
    Object.defineProperty(process, "resourcesPath", { configurable: true, value: join(home, "resources") });

    const { startBabyMenuApp } = await import("../src/main/app");
    await startBabyMenuApp();

    const filePath = join(home, ".config", "autostart", "baby-menu.desktop");
    await vi.waitFor(async () => {
      await expect(readFile(filePath, "utf8")).resolves.toContain("Exec=/usr/bin/baby-menu");
    });

    expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("does not create an autostart entry for a packaged dev-build Linux executable", async () => {
    const { mkdtemp, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const home = await mkdtemp(join(tmpdir(), "baby-menu-linux-home-"));
    tempDirs.push(home);

    electronApp.isPackaged = true;
    electronApp.getPath.mockImplementation((name: string) => {
      if (name === "home") return home;
      if (name === "exe") return "/repo/release/linux-unpacked/baby-menu-dev";
      return home;
    });
    Object.defineProperty(process, "resourcesPath", { configurable: true, value: join(home, "resources") });

    const { startBabyMenuApp } = await import("../src/main/app");
    await startBabyMenuApp();

    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(access(join(home, ".config", "autostart", "baby-menu.desktop"))).rejects.toThrow();
  });
});
