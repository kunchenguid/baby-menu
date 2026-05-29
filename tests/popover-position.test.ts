import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POPOVER_SIZE,
  MAX_POPOVER_HEIGHT,
  MIN_POPOVER_HEIGHT,
  MIN_POPOVER_WIDTH,
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
    expect(DEFAULT_POPOVER_SIZE.width).toBe(504);
    expect(createPopoverOptions("/app/preload.js").width).toBe(504);
  });

  it("clamps content-driven popover width and height to a usable range", () => {
    expect(MIN_POPOVER_HEIGHT).toBe(220);
    expect(MAX_POPOVER_HEIGHT).toBe(720);
    expect(MIN_POPOVER_WIDTH).toBe(320);
    // Height clamps as before; width passes through above the floor so the
    // popover adapts to whatever canvas the layout reports.
    expect(responsivePopoverSize({ width: 504, height: 140 })).toEqual({ width: 504, height: 220 });
    expect(responsivePopoverSize({ width: 840, height: 420.2 })).toEqual({ width: 840, height: 421 });
    expect(responsivePopoverSize({ width: 504, height: 960 })).toEqual({ width: 504, height: 720 });
    // A layout narrower than the floor is pulled back up to the minimum width.
    expect(responsivePopoverSize({ width: 120, height: 300 })).toEqual({ width: 320, height: 300 });
  });

  it("caps the popover size to the display work area when one is given", () => {
    const workArea = { x: 0, y: 0, width: 700, height: 600 };
    // A layout asking for more than the screen can show is capped to the work
    // area minus edge padding (8px each side), in both dimensions.
    expect(responsivePopoverSize({ width: 2000, height: 2000 }, workArea)).toEqual({
      width: 684,
      height: 584,
    });
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
