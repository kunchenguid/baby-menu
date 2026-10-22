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
  webContents: { send: vi.fn(), on: vi.fn(), reload: vi.fn(), isCrashed: vi.fn(() => false) },
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
    browserWindowInstance.webContents.isCrashed.mockReturnValue(false);
    trayInstance.getBounds.mockReturnValue({ x: 100, y: 10, width: 24, height: 24 });
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
    process.env.BABY_MENU_OPEN_POPOVER_ON_START = "1";
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();

    await vi.waitFor(() => expect(browserWindowInstance.show).toHaveBeenCalled());
    expect(trayInstance.getBounds).toHaveBeenCalled();
    expect(browserWindowInstance.setBounds).toHaveBeenCalledWith({ x: 8, y: 42, width: 504, height: 620 });
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

  it("still creates the tray when extension workspace seeding fails", async () => {
    const { seedExtensionWorkspace } = await import("../src/main/extension-seeder");
    (seedExtensionWorkspace as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EISDIR: symlinked workspace"));
    const appModule = await import("../src/main/app");

    await expect(appModule.startBabyMenuApp()).resolves.toBeUndefined();

    expect(createBabyMenuTray).toHaveBeenCalledWith(expect.any(Function), {
      iconPath: "/repo/assets/tray/baby_menuTemplate.png",
    });
    expect(appModule.getActiveBabyMenuTray()).toBe(trayInstance);
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
    await vi.waitFor(() => expect(browserWindowInstance.setBounds).toHaveBeenCalled());

    popoverController.setContentHeight(333);

    expect(browserWindowInstance.setBounds).toHaveBeenLastCalledWith({ x: 8, y: 42, width: 504, height: 333 });
  });

  it("caps initial renderer size reports before first popover bounds", async () => {
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

  it("does not message a dead popover renderer", async () => {
    const appModule = await import("../src/main/app");

    await appModule.startBabyMenuApp();
    const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
    await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });
    const schedulerOptions = (
      (await import("../src/main/background-task-scheduler")).createBackgroundTaskScheduler as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1)?.[0];
    const onShow = browserWindowInstance.on.mock.calls.find(([event]) => event === "show")?.[1];
    const onHide = browserWindowInstance.on.mock.calls.find(([event]) => event === "hide")?.[1];

    // Sending to a dead renderer makes Electron log "Render frame was disposed".
    browserWindowInstance.webContents.send.mockClear();
    browserWindowInstance.webContents.isCrashed.mockReturnValue(true);
    browserWindowInstance.isVisible.mockReturnValue(true);
    onShow?.();
    onHide?.();
    schedulerOptions.onTaskRun("cpu-usage");

    expect(browserWindowInstance.webContents.send).not.toHaveBeenCalled();
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
  describe("popover renderer recovery", () => {
    async function openPopoverAndGetGoneHandler() {
      const appModule = await import("../src/main/app");
      await appModule.startBabyMenuApp();
      const onTrayClick = createBabyMenuTray.mock.calls.at(-1)?.[0];
      await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });
      await vi.waitFor(() => expect(browserWindowInstance.show).toHaveBeenCalled());
      const onGone = browserWindowInstance.webContents.on.mock.calls.find(
        ([event]) => event === "render-process-gone",
      )?.[1];
      expect(onGone).toBeTypeOf("function");
      return { onTrayClick, onGone: onGone as (event: unknown, details: { reason: string; exitCode: number }) => void };
    }

    it("reloads the popover renderer when its process dies so the window never stays blank", async () => {
      const { onGone } = await openPopoverAndGetGoneHandler();

      onGone({}, { reason: "killed", exitCode: 9 });

      // Deferred: reloading inside the event itself crashes Electron's main process.
      expect(browserWindowInstance.webContents.reload).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(browserWindowInstance.webContents.reload).toHaveBeenCalledTimes(1));
    });

    it("does not reload after a clean renderer exit such as app shutdown", async () => {
      const { onGone } = await openPopoverAndGetGoneHandler();

      onGone({}, { reason: "clean-exit", exitCode: 0 });
      await new Promise((resolve) => setImmediate(resolve));

      expect(browserWindowInstance.webContents.reload).not.toHaveBeenCalled();
    });

    it("caps automatic reloads and recovers a dead renderer on the next tray click", async () => {
      const { onGone, onTrayClick } = await openPopoverAndGetGoneHandler();

      for (let index = 0; index < 5; index += 1) onGone({}, { reason: "crashed", exitCode: 1 });
      await new Promise((resolve) => setImmediate(resolve));
      expect(browserWindowInstance.webContents.reload).toHaveBeenCalledTimes(3);

      browserWindowInstance.webContents.isCrashed.mockReturnValue(true);
      browserWindowInstance.isVisible.mockReturnValue(true);
      browserWindowInstance.show.mockClear();
      await onTrayClick?.({ x: 100, y: 10, width: 24, height: 24 });

      expect(browserWindowInstance.webContents.reload).toHaveBeenCalledTimes(4);
      expect(browserWindowInstance.hide).not.toHaveBeenCalled();
      expect(browserWindowInstance.show).toHaveBeenCalled();
    });
  });
});
