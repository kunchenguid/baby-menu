import { beforeEach, describe, expect, it, vi } from "vitest";

const image = {
  setTemplateImage: vi.fn(),
};

const tray = {
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0 })),
  on: vi.fn(),
  setContextMenu: vi.fn(),
  setTitle: vi.fn(),
  setToolTip: vi.fn(),
};

const createFromPath = vi.fn((_path: string) => image);
const Tray = vi.fn(function MockTray() {
  return tray;
});
const buildFromTemplate = vi.fn((template: unknown) => ({ template }));

vi.mock("electron", () => ({
  Menu: { buildFromTemplate },
  nativeImage: { createFromPath },
  Tray,
}));

describe("createBabyMenuTray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a template menu bar icon from the packaged tray asset on macOS", async () => {
    const { createBabyMenuTray } = await import("../src/main/tray");

    createBabyMenuTray(vi.fn(), {
      iconPath: "/repo/assets/tray/baby_menuTemplate.png",
      platform: "darwin",
    });

    expect(createFromPath).toHaveBeenCalledWith("/repo/assets/tray/baby_menuTemplate.png");
    expect(image.setTemplateImage).toHaveBeenCalledWith(true);
    expect(Tray).toHaveBeenCalledWith(image);
    expect(tray.setTitle).not.toHaveBeenCalled();
    expect(tray.setToolTip).toHaveBeenCalledWith("baby-menu");
  });

  it("does not ask for a template image on Linux, where the icon cannot be recolored", async () => {
    const { createBabyMenuTray } = await import("../src/main/tray");

    createBabyMenuTray(vi.fn(), {
      iconPath: "/repo/assets/tray/baby_menu-linux.png",
      platform: "linux",
    });

    expect(image.setTemplateImage).not.toHaveBeenCalled();
  });

  it("builds an Open and Quit context menu on Linux, where GNOME swallows left click", async () => {
    const { createBabyMenuTray } = await import("../src/main/tray");
    const onClick = vi.fn();
    tray.getBounds.mockReturnValue({ x: 12, y: 0, width: 24, height: 24 });

    createBabyMenuTray(onClick, {
      iconPath: "/repo/assets/tray/baby_menu-linux.png",
      platform: "linux",
    });

    expect(buildFromTemplate).toHaveBeenCalledTimes(1);
    const template = buildFromTemplate.mock.calls[0][0] as Array<{ label: string; role?: string; click?: () => void }>;
    expect(template.map((item) => item.label)).toEqual(["Open Baby Menu", "Quit"]);
    expect(template[1].role).toBe("quit");
    expect(tray.setContextMenu).toHaveBeenCalledWith({ template });

    template[0].click?.();
    expect(onClick).toHaveBeenCalledWith({ x: 12, y: 0, width: 24, height: 24 });
  });

  it("never sets a context menu on macOS, where it would hijack left click", async () => {
    const { createBabyMenuTray } = await import("../src/main/tray");

    createBabyMenuTray(vi.fn(), {
      iconPath: "/repo/assets/tray/baby_menuTemplate.png",
      platform: "darwin",
    });

    expect(tray.setContextMenu).not.toHaveBeenCalled();
    expect(buildFromTemplate).not.toHaveBeenCalled();
  });
});
