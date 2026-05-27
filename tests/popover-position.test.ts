import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POPOVER_SIZE,
  MAX_POPOVER_HEIGHT,
  MIN_POPOVER_HEIGHT,
  calculatePopoverBounds,
  createPopoverOptions,
  loadPopoverRenderer,
  responsivePopoverSize,
} from "../src/main/popover";

function createRendererWindow() {
  return {
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
  };
}

describe("calculatePopoverBounds", () => {
  it("uses the design-system tray popover width by default", () => {
    expect(DEFAULT_POPOVER_SIZE.width).toBe(360);
    expect(createPopoverOptions("/app/preload.js").width).toBe(360);
  });

  it("clamps content-driven popover height to a usable range", () => {
    expect(MIN_POPOVER_HEIGHT).toBe(220);
    expect(MAX_POPOVER_HEIGHT).toBe(720);
    expect(responsivePopoverSize(140)).toEqual({ width: 360, height: 220 });
    expect(responsivePopoverSize(420.2)).toEqual({ width: 360, height: 421 });
    expect(responsivePopoverSize(960)).toEqual({ width: 360, height: 720 });
  });

  it("centers the popover under a menu bar tray icon", () => {
    const bounds = calculatePopoverBounds(
      { x: 500, y: 0, width: 20, height: 22 },
      { x: 0, y: 0, width: 1440, height: 900 },
      { width: 420, height: 620 },
    );

    expect(bounds).toEqual({ x: 300, y: 30, width: 420, height: 620 });
  });

  it("keeps the popover inside the display work area horizontally", () => {
    const left = calculatePopoverBounds(
      { x: 4, y: 0, width: 18, height: 22 },
      { x: 0, y: 0, width: 800, height: 700 },
      { width: 420, height: 620 },
    );
    const right = calculatePopoverBounds(
      { x: 790, y: 0, width: 18, height: 22 },
      { x: 0, y: 0, width: 800, height: 700 },
      { width: 420, height: 620 },
    );

    expect(left.x).toBe(8);
    expect(right.x).toBe(372);
  });

  it("opens above the tray icon when there is not enough room below", () => {
    const bounds = calculatePopoverBounds(
      { x: 500, y: 650, width: 20, height: 22 },
      { x: 0, y: 0, width: 1440, height: 700 },
      { width: 420, height: 620 },
    );

    expect(bounds.y).toBe(22);
  });

  it("loads localhost renderer URLs during development", async () => {
    const window = createRendererWindow();

    await loadPopoverRenderer(window, "http://localhost:5273/", "/app/out/renderer/index.html");

    expect(window.loadURL).toHaveBeenCalledWith("http://localhost:5273/");
    expect(window.loadFile).not.toHaveBeenCalled();
  });

  it("falls back to the renderer file for non-local renderer URLs", async () => {
    const window = createRendererWindow();

    await loadPopoverRenderer(window, "https://example.com/", "/app/out/renderer/index.html");

    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith("/app/out/renderer/index.html");
  });

  it("ignores dev renderer URLs in packaged builds", async () => {
    const window = createRendererWindow();

    await loadPopoverRenderer(window, "http://localhost:5273/", "/app/out/renderer/index.html", {
      isPackaged: true,
    });

    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith("/app/out/renderer/index.html");
  });
});
