import { beforeEach, describe, expect, it, vi } from "vitest";

const image = {
  setTemplateImage: vi.fn(),
};

const tray = {
  getBounds: vi.fn(),
  on: vi.fn(),
  setTitle: vi.fn(),
  setToolTip: vi.fn(),
};

const createFromPath = vi.fn((_path: string) => image);
const Tray = vi.fn(function MockTray() {
  return tray;
});

vi.mock("electron", () => ({
  nativeImage: { createFromPath },
  Tray,
}));

describe("createBabyMenuTray", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a template menu bar icon from the packaged tray asset", async () => {
    const { createBabyMenuTray } = await import("../src/main/tray");

    createBabyMenuTray(vi.fn(), { iconPath: "/repo/assets/tray/baby_menuTemplate.png" });

    expect(createFromPath).toHaveBeenCalledWith("/repo/assets/tray/baby_menuTemplate.png");
    expect(image.setTemplateImage).toHaveBeenCalledWith(true);
    expect(Tray).toHaveBeenCalledWith(image);
    expect(tray.setTitle).not.toHaveBeenCalled();
    expect(tray.setToolTip).toHaveBeenCalledWith("baby-menu");
  });
});
