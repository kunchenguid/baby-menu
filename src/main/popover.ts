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

export function createPopoverOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: DEFAULT_POPOVER_SIZE.width,
    height: DEFAULT_POPOVER_SIZE.height,
    frame: false,
    show: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    hasShadow: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

// macOS Spaces fix (issue #117): a menu-bar popover must live on every Space.
// Without this the window stays pinned to the Space where it was first shown:
// clicking the tray from another desktop forces a Space switch back, the
// switch steals focus, `blur` fires and the popover instantly hides again.
// `setVisibleOnAllWorkspaces` keeps the popover on the current desktop so
// show/hide never triggers a Space jump. Safe to call with test doubles: it
// no-ops when the methods do not exist.
export type SpaceAwareWindow = {
  setVisibleOnAllWorkspaces?: (visible: boolean, options?: { visibleOnFullScreen?: boolean }) => void;
  setFullScreenable?: (fullscreenable: boolean) => void;
};

export function applyPopoverSpaceBehavior(window: SpaceAwareWindow): void {
  try {
    window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  } catch {
    // Older Electron or mocked windows: Spaces pinning is best-effort.
  }
  try {
    window.setFullScreenable?.(false);
  } catch {
    // ignore
  }
}

// How long after an explicit show a `blur` event is ignored. Showing the
// popover (especially while macOS animates a Space/display change) briefly
// steals and loses focus; hiding on that transient blur is what made the menu
// "flash and close" right after clicking the tray icon.
export const POPOVER_BLUR_GRACE_MS = 300;
// Deferred hide: on macOS a tray click fires `blur` just before the tray
// `click` handler runs. Hiding synchronously in `blur` wins the race and the
// popover can never be toggled back open. Deferring lets the toggle refocus
// first; the hide only proceeds if the window is still blurred then.
export const POPOVER_BLUR_HIDE_DELAY_MS = 120;

export function shouldSuppressPopoverBlur(suppressUntil: number, now: number = Date.now()): boolean {
  return now < suppressUntil;
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
