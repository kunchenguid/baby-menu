// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_POPOVER_CONTENT_WIDTH,
  measurePopoverContentHeight,
  measurePopoverContentSize,
  OVERLAY_MARGIN,
} from "../src/renderer/popover-content-height";

function stubHeight(el: HTMLElement, height: number): void {
  el.getBoundingClientRect = () =>
    ({ height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
}

function overlay(height: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-bm-overlay", "");
  stubHeight(el, height);
  document.body.appendChild(el);
  return el;
}

describe("measurePopoverContentHeight", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports the shell height when no overlay is open", () => {
    const shell = document.createElement("main");
    stubHeight(shell, 240);
    document.body.appendChild(shell);
    expect(measurePopoverContentHeight(shell)).toBe(240);
  });

  it("does not stretch the window for a small overlay that already fits the shell", () => {
    const shell = document.createElement("main");
    stubHeight(shell, 320);
    document.body.appendChild(shell);
    // A small confirmation dialog: even with breathing room it stays under the
    // shell height, so the window must not grow into empty space.
    overlay(120);
    expect(measurePopoverContentHeight(shell)).toBe(320);
  });

  it("grows only as much as an overlay taller than the shell needs", () => {
    const shell = document.createElement("main");
    stubHeight(shell, 200);
    document.body.appendChild(shell);
    overlay(480);
    expect(measurePopoverContentHeight(shell)).toBe(480 + OVERLAY_MARGIN);
  });
});

function stubRect(el: HTMLElement, rect: { left?: number; width?: number; height?: number }): void {
  const left = rect.left ?? 0;
  const width = rect.width ?? 0;
  const height = rect.height ?? 0;
  el.getBoundingClientRect = () =>
    ({ height, width, top: 0, left, right: left + width, bottom: height, x: left, y: 0, toJSON() {} }) as DOMRect;
}

// A custom layout canvas, positioned `left` px in from the shell's left edge.
// That inset is the real popover chrome: .app-shell's 1px border plus
// .pop-body's 14px padding on each side.
function canvas(rect: { left: number; width: number }): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-bm-canvas", "");
  stubRect(el, rect);
  document.body.appendChild(el);
  return el;
}

describe("measurePopoverContentSize", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports the default column width when no custom layout canvas is present", () => {
    const shell = document.createElement("main");
    stubHeight(shell, 300);
    document.body.appendChild(shell);
    expect(measurePopoverContentSize(shell)).toEqual({ width: DEFAULT_POPOVER_CONTENT_WIDTH, height: 300 });
  });

  it("adds the chrome on both sides of a custom layout canvas so its right edge is not clipped", () => {
    const shell = document.createElement("main");
    stubRect(shell, { left: 0, height: 360 });
    document.body.appendChild(shell);
    // 15px inset on the left (1px shell border + 14px body padding); the window
    // must grow by that much on the right too, so 840 + 15 * 2 = 870.
    canvas({ left: 15, width: 840 });
    expect(measurePopoverContentSize(shell)).toEqual({ width: 870, height: 360 });
  });

  it("does not rely on shell.scrollWidth, which overflow-x: hidden on .pop-body never grows", () => {
    const shell = document.createElement("main");
    stubRect(shell, { left: 0, height: 360 });
    // In the real DOM .pop-body clips the wider canvas (overflow-x: hidden), so
    // the overflow never expands the shell - scrollWidth stays at the (too
    // narrow) window width. The measurement must ignore it and still add chrome.
    Object.defineProperty(shell, "scrollWidth", { value: 840, configurable: true });
    document.body.appendChild(shell);
    canvas({ left: 15, width: 840 });
    expect(measurePopoverContentSize(shell)).toEqual({ width: 870, height: 360 });
  });
});
