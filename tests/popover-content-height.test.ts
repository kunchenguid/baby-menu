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

function canvas(scrollWidth: number): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-bm-canvas", "");
  Object.defineProperty(el, "scrollWidth", { value: scrollWidth, configurable: true });
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

  it("reports the intrinsic canvas width when a custom layout is active", () => {
    const shell = document.createElement("main");
    stubHeight(shell, 360);
    document.body.appendChild(shell);
    canvas(840);
    expect(measurePopoverContentSize(shell)).toEqual({ width: 840, height: 360 });
  });

  it("includes shell chrome around a custom layout canvas", () => {
    const shell = document.createElement("main");
    stubHeight(shell, 360);
    Object.defineProperty(shell, "scrollWidth", { value: 870, configurable: true });
    document.body.appendChild(shell);
    canvas(840);
    expect(measurePopoverContentSize(shell)).toEqual({ width: 870, height: 360 });
  });
});
