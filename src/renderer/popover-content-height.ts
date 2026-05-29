// Extra vertical room around a centered design-system overlay so its
// max-h-[calc(100vh-1rem)] clamp does not trim it and it is not pressed flush
// against the window edges.
export const OVERLAY_MARGIN = 32;

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
