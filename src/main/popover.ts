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

const EDGE_PADDING = 8;

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

export function responsivePopoverSize(contentHeight: number): Size {
  return {
    width: DEFAULT_POPOVER_SIZE.width,
    height: Math.ceil(clamp(contentHeight, MIN_POPOVER_HEIGHT, MAX_POPOVER_HEIGHT)),
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
