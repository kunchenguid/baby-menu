// Extra vertical room around a centered design-system overlay so its
// max-h-[calc(100vh-1rem)] clamp does not trim it and it is not pressed flush
// against the window edges.
export const OVERLAY_MARGIN = 32;

// The width the popover reports when no agent-authored layout is active - the
// historical fixed column width. A custom layout (marked with [data-bm-canvas])
// reports its own intrinsic width plus host chrome, so the popover adapts to the
// canvas without clipping its right edge.
export const DEFAULT_POPOVER_CONTENT_WIDTH = 504;

/**
 * Height the tray popover window should request for the current content.
 *
 * While a design-system overlay ([data-bm-overlay], e.g. a Dialog or Select) is
 * open we grow only as much as that overlay actually needs - never to a fixed
 * maximum. A small confirmation dialog must not stretch the window into a sea of
 * empty space; a tall overlay still gets room (the main process clamps to the
 * popover max).
 */
export function measurePopoverContentHeight(shell: HTMLElement): number {
  const shellHeight = Math.ceil(shell.getBoundingClientRect().height);
  const overlay = document.querySelector<HTMLElement>("[data-bm-overlay]");
  if (!overlay) return shellHeight;
  const overlayHeight = Math.ceil(overlay.getBoundingClientRect().height) + OVERLAY_MARGIN;
  return Math.max(shellHeight, overlayHeight);
}

/**
 * Size the popover window should request so both dimensions adapt to the content.
 *
 * Height reuses {@link measurePopoverContentHeight}. Width is the intrinsic width
 * of the active layout canvas ([data-bm-canvas], which shrink-wraps an
 * agent-authored layout that sets its own width) plus the popover chrome on both
 * sides, so the canvas's right edge is never clipped. Without a custom layout
 * there is no canvas element and the historical fixed column width is reported,
 * so the default popover is unchanged. The main process clamps the result to a
 * usable range and the screen.
 */
export function measurePopoverContentSize(shell: HTMLElement): { width: number; height: number } {
  const height = measurePopoverContentHeight(shell);
  const canvas = document.querySelector<HTMLElement>("[data-bm-canvas]");
  if (!canvas) return { width: DEFAULT_POPOVER_CONTENT_WIDTH, height };

  // The canvas (width: max-content) overflows .pop-body, which clips it with
  // overflow-x: hidden - so that overflow never expands shell.scrollWidth, and we
  // cannot use it to recover the chrome (.app-shell border + .pop-body padding).
  // Measure the canvas's own width and add the chrome on both sides by mirroring
  // its left inset from the shell; the popover insets are horizontally symmetric.
  const shellRect = shell.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const leftInset = Math.max(0, canvasRect.left - shellRect.left);
  const width = Math.ceil(canvasRect.width + leftInset * 2);
  return { width, height };
}
