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

// Automatic reloads allowed per rolling window after the popover renderer dies.
// The cap keeps a renderer that dies on every load from spinning; past it,
// recovery waits for the next popover open.
export const RENDERER_RELOAD_LIMIT = 3;
export const RENDERER_RELOAD_WINDOW_MS = 60_000;

export type RendererReloadBudget = {
  tryConsume: () => boolean;
};

export function createRendererReloadBudget(now: () => number = Date.now): RendererReloadBudget {
  let reloadTimes: number[] = [];
  return {
    tryConsume() {
      const current = now();
      reloadTimes = reloadTimes.filter((time) => current - time < RENDERER_RELOAD_WINDOW_MS);
      if (reloadTimes.length >= RENDERER_RELOAD_LIMIT) return false;
      reloadTimes.push(current);
      return true;
    },
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function calculatePopoverBounds(
  trayBounds: Rectangle,
  workArea: Rectangle,
  size: Size = DEFAULT_POPOVER_SIZE,
): Rectangle {
  const trayCenterX = trayBounds.x + trayBounds.width / 2;
  const minX = workArea.x + EDGE_PADDING;
  const maxX = workArea.x + workArea.width - size.width - EDGE_PADDING;
  const x = Math.round(clamp(trayCenterX - size.width / 2, minX, maxX));

  const belowY = trayBounds.y + trayBounds.height + EDGE_PADDING;
  const aboveY = trayBounds.y - size.height - EDGE_PADDING;
  const fitsBelow = belowY + size.height <= workArea.y + workArea.height;
  const y = Math.round(
    fitsBelow
      ? belowY
      : clamp(aboveY, workArea.y + EDGE_PADDING, workArea.y + workArea.height - size.height - EDGE_PADDING),
  );

  return { x, y, width: size.width, height: size.height };
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

// On macOS the popover is a non-activating panel. A panel joins every Space,
// including another app's full-screen Space, and becomes the key window without
// activating the app. That lets baby-menu stay an accessory (dock-less) app while
// the popover opens over whatever the user is looking at, and the key window keeps
// Chromium's cursor tracking working. Activating the app instead (or switching it
// to the regular activation policy) makes macOS leave a full-screen Space for the
// desktop. A popover is never full screen itself, which also keeps the panel's
// full-screen-auxiliary behavior from conflicting with full-screen-primary.
// The panel is also transient (hidden in Mission Control): macOS drops a hidden
// panel from Spaces when a full-screen Space is torn down, and only a transient
// window is put back on the active Space when it is shown again. Without that the
// popover reports itself visible and focused while it is on no Space the user sees.
export function createPopoverOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: DEFAULT_POPOVER_SIZE.width,
    height: DEFAULT_POPOVER_SIZE.height,
    type: "panel",
    fullscreenable: false,
    hiddenInMissionControl: true,
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
