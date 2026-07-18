import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from "electron";

type PopoverRendererWindow = Pick<BrowserWindow, "loadURL" | "loadFile">;

type LoadPopoverRendererOptions = {
  isPackaged?: boolean;
};

export type Size = {
  width: number;
  height: number;
};

export const DEFAULT_POPOVER_SIZE: Size = {
  width: 504,
  height: 620,
};

export const MIN_POPOVER_HEIGHT = 220;
export const MAX_POPOVER_HEIGHT = 720;
export const MIN_POPOVER_WIDTH = 320;

const EDGE_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Places the popover fully inside `workArea` with EDGE_PADDING, edge-aware for
 * tray icons on top/bottom/left/right (mac menu bar, Windows taskbar orientations).
 *
 * 1. Measure free space from the tray to each workArea edge.
 * 2. Nearest edge selects the primary axis (top/bottom → vertical; left/right → horizontal).
 * 3. On that axis, prefer the side with more free space (toward the interior).
 * 4. Center on the secondary axis; clamp both axes into the workArea.
 */
export function calculatePopoverBounds(
  trayBounds: Rectangle,
  workArea: Rectangle,
  size: Size = DEFAULT_POPOVER_SIZE,
): Rectangle {
  const trayLeft = trayBounds.x;
  const trayRight = trayBounds.x + trayBounds.width;
  const trayTop = trayBounds.y;
  const trayBottom = trayBounds.y + trayBounds.height;
  const trayCenterX = trayLeft + trayBounds.width / 2;
  const trayCenterY = trayTop + trayBounds.height / 2;

  const workLeft = workArea.x;
  const workTop = workArea.y;
  const workRight = workArea.x + workArea.width;
  const workBottom = workArea.y + workArea.height;

  // Clamp free space at 0 so a tray that slightly overflows a workArea edge
  // (common for corner notification icons) does not look "closer" to that edge
  // than the true taskbar edge. When top/bottom and left/right free space are
  // both zero (corners), prefer the vertical axis so mac menu-bar and Windows
  // bottom-taskbar placement stay correct.
  const spaceAbove = Math.max(0, trayTop - workTop);
  const spaceBelow = Math.max(0, workBottom - trayBottom);
  const spaceLeft = Math.max(0, trayLeft - workLeft);
  const spaceRight = Math.max(0, workRight - trayRight);

  // Nearest edge to the tray decides primary axis (horizontal vs vertical placement).
  const nearest = Math.min(spaceAbove, spaceBelow, spaceLeft, spaceRight);
  const verticalAxis = nearest === spaceAbove || nearest === spaceBelow;

  const minX = workLeft + EDGE_PADDING;
  const maxX = workRight - size.width - EDGE_PADDING;
  const minY = workTop + EDGE_PADDING;
  const maxY = workBottom - size.height - EDGE_PADDING;

  let x: number;
  let y: number;

  if (verticalAxis) {
    // Top or bottom edge (menu bar / horizontal taskbar): open above or below.
    const preferBelow = spaceBelow >= spaceAbove;
    const belowY = trayBottom + EDGE_PADDING;
    const aboveY = trayTop - size.height - EDGE_PADDING;
    y = preferBelow ? belowY : aboveY;
    x = trayCenterX - size.width / 2;
  } else {
    // Left or right edge (vertical taskbar): open to the side with more free space.
    const preferRight = spaceRight >= spaceLeft;
    const rightX = trayRight + EDGE_PADDING;
    const leftX = trayLeft - size.width - EDGE_PADDING;
    x = preferRight ? rightX : leftX;
    y = trayCenterY - size.height / 2;
  }

  return {
    x: Math.round(clamp(x, minX, maxX)),
    y: Math.round(clamp(y, minY, maxY)),
    width: size.width,
    height: size.height,
  };
}

// Clamps the renderer-reported canvas size into the range the popover can
// actually display, so both width and height adapt to the layout content. The
// reported size is taken as-is (not max-ratcheted), so the popover grows AND
// shrinks back as a layout changes. When a work area is given, the size is also
// capped to it (minus edge padding) so an oversized layout never escapes the
// screen.
export function responsivePopoverSize(content: Size, workArea?: Rectangle): Size {
  const maxWidth = workArea ? Math.max(MIN_POPOVER_WIDTH, workArea.width - EDGE_PADDING * 2) : Number.POSITIVE_INFINITY;
  const maxHeight = workArea
    ? Math.max(MIN_POPOVER_HEIGHT, Math.min(MAX_POPOVER_HEIGHT, workArea.height - EDGE_PADDING * 2))
    : MAX_POPOVER_HEIGHT;
  return {
    width: Math.ceil(clamp(content.width, MIN_POPOVER_WIDTH, maxWidth)),
    height: Math.ceil(clamp(content.height, MIN_POPOVER_HEIGHT, maxHeight)),
  };
}

export function createPopoverOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: DEFAULT_POPOVER_SIZE.width,
    height: DEFAULT_POPOVER_SIZE.height,
    frame: false,
    show: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

function isLocalRendererUrl(rendererUrl: string): boolean {
  try {
    const url = new URL(rendererUrl);
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    const isLocalHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);

    return isHttp && isLocalHost;
  } catch {
    return false;
  }
}

export async function loadPopoverRenderer(
  window: PopoverRendererWindow,
  rendererUrl: string | undefined,
  rendererFile: string,
  options: LoadPopoverRendererOptions = {},
) {
  if (rendererUrl && !options.isPackaged && isLocalRendererUrl(rendererUrl)) {
    await window.loadURL(rendererUrl);
    return;
  }

  await window.loadFile(rendererFile);
}
