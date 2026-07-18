import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POPOVER_SIZE,
  EDGE_PADDING,
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

  // G08: tray-only shell on all platforms; Windows relies on skipTaskbar (no dock API).
  it("creates a frameless skipTaskbar alwaysOnTop popover (G08)", () => {
    expect(createPopoverOptions("/app/preload.js")).toEqual(
      expect.objectContaining({
        frame: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
      }),
    );
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

  function expectFullyInsideWorkArea(
    bounds: { x: number; y: number; width: number; height: number },
    workArea: { x: number; y: number; width: number; height: number },
  ) {
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x + EDGE_PADDING);
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y + EDGE_PADDING);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width - EDGE_PADDING);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(workArea.y + workArea.height - EDGE_PADDING);
  }

  it("opens above a bottom-edge tray (Windows-style horizontal taskbar)", () => {
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    // Notification-area icon flush with the bottom of the work area.
    const tray = { x: 1380, y: 876, width: 24, height: 24 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    // Prefer above: tray.y - height - padding = 876 - 620 - 8 = 248
    expect(bounds.y).toBe(248);
    // Horizontally centered on the tray, clamped into the work area.
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("opens below a top-edge tray when that side has more free space", () => {
    const workArea = { x: 0, y: 0, width: 1280, height: 800 };
    const tray = { x: 640, y: 0, width: 22, height: 22 };
    const size = { width: 420, height: 500 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.height + EDGE_PADDING);
    expect(bounds.x).toBe(Math.round(tray.x + tray.width / 2 - size.width / 2));
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("opens to the right of a left-edge tray (vertical taskbar)", () => {
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    // Tray icon on a left vertical taskbar.
    const tray = { x: 4, y: 420, width: 40, height: 40 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    // Prefer right of tray: tray.x + width + padding
    expect(bounds.x).toBe(tray.x + tray.width + EDGE_PADDING);
    // Vertically centered on the tray.
    expect(bounds.y).toBe(Math.round(tray.y + tray.height / 2 - size.height / 2));
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("opens to the left of a right-edge tray (vertical taskbar)", () => {
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 1400, y: 420, width: 40, height: 40 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    // Prefer left of tray: tray.x - width - padding = 1400 - 420 - 8 = 972
    expect(bounds.x).toBe(972);
    expect(bounds.y).toBe(Math.round(tray.y + tray.height / 2 - size.height / 2));
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("keeps vertical placement for a slightly inset top-right tray flush with the right", () => {
    // spaceAbove=16 (docked strip), spaceRight=0 → must not flip to horizontal.
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 1416, y: 16, width: 24, height: 24 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.y + tray.height + EDGE_PADDING);
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("keeps vertical placement for a slightly inset bottom-right tray flush with the right", () => {
    // spaceBelow=12 (docked strip), spaceRight=0 → open above, not left.
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 1416, y: 864, width: 24, height: 24 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.y - size.height - EDGE_PADDING);
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("prefers vertical placement on dual-zero top-right corner (mac notification corner)", () => {
    // Flush with top and right (both free spaces 0).
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 1420, y: 0, width: 20, height: 22 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.height + EDGE_PADDING);
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("prefers vertical placement on dual-zero bottom-right corner (Windows notification corner)", () => {
    // Flush with bottom and right (both free spaces 0).
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 1416, y: 876, width: 24, height: 24 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.y - size.height - EDGE_PADDING);
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("locks dual-zero left-bottom corner to vertical axis (G02 MVP corner policy)", () => {
    // Vertical-taskbar icon at the bottom-left corner: both free spaces 0.
    // Policy prefers vertical → opens above rather than to the right.
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 0, y: 876, width: 40, height: 24 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.y - size.height - EDGE_PADDING);
    expect(bounds.x).toBe(EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("places above a tray that sits fully below the workArea (taskbar outside workArea)", () => {
    // Real Windows: Tray.getBounds() often lives in the taskbar strip excluded from workArea.
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    const tray = { x: 1380, y: 908, width: 24, height: 32 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    // Preferred above (tray.y - height - padding) can sit past the workArea top bound
    // when the icon is outside; clamp keeps it fully inside with EDGE_PADDING.
    expect(bounds.y).toBe(workArea.height - size.height - EDGE_PADDING);
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("places below a top-right tray that overflows above and past the right of the workArea", () => {
    const workArea = { x: 0, y: 0, width: 1440, height: 900 };
    // Icon partially above workArea and past the right edge (overflow free space → 0).
    const tray = { x: 1430, y: -8, width: 22, height: 22 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(tray.y + tray.height + EDGE_PADDING);
    expect(bounds.x).toBe(workArea.width - size.width - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("clamps a bottom-edge popover that would overflow the top of the work area", () => {
    // Short work area: preferred "above" position would go past y=0; clamp to padding.
    const workArea = { x: 0, y: 0, width: 800, height: 500 };
    const tray = { x: 400, y: 470, width: 24, height: 24 };
    const size = { width: 420, height: 480 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("clamps a left-edge popover that would overflow the bottom of the work area", () => {
    const workArea = { x: 0, y: 0, width: 1000, height: 600 };
    // Left taskbar mid-low: spaceBelow stays above the dock strip so axis stays
    // horizontal; centering on the tray still needs a bottom Y clamp.
    const tray = { x: 2, y: 480, width: 36, height: 36 };
    const size = { width: 420, height: 500 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.x).toBe(tray.x + tray.width + EDGE_PADDING);
    expect(bounds.y).toBe(workArea.height - size.height - EDGE_PADDING);
    expectFullyInsideWorkArea(bounds, workArea);
  });

  it("respects a non-origin workArea (multi-monitor secondary display)", () => {
    // Secondary monitor to the right of the primary; workArea origin is not (0,0).
    const workArea = { x: 1920, y: 100, width: 1440, height: 900 };
    const tray = { x: 1920 + 700, y: 100, width: 22, height: 22 };
    const size = { width: 420, height: 620 };
    const bounds = calculatePopoverBounds(tray, workArea, size);

    expect(bounds.y).toBe(workArea.y + tray.height + EDGE_PADDING);
    expect(bounds.x).toBe(Math.round(tray.x + tray.width / 2 - size.width / 2));
    expectFullyInsideWorkArea(bounds, workArea);
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
