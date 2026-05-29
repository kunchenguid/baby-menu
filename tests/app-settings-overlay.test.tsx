// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/renderer/App";

describe("App settings overlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens settings as an overlay without unmounting the default view", () => {
    const { container, getByLabelText } = render(<App />);

    const menuSurfaceBefore = container.querySelector(".menu-surface");
    expect(menuSurfaceBefore).not.toBeNull();
    expect(container.querySelector(".settings-overlay")).toBeNull();

    fireEvent.click(getByLabelText("open settings"));

    // Settings is now shown as an overlay...
    expect(container.querySelector(".settings-overlay")).not.toBeNull();
    // ...and the default view's menu surface is the very same DOM node, never
    // unmounted/remounted - so any React state inside it survives.
    expect(container.querySelector(".menu-surface")).toBe(menuSurfaceBefore);

    fireEvent.click(getByLabelText("close settings"));

    expect(container.querySelector(".settings-overlay")).toBeNull();
    expect(container.querySelector(".menu-surface")).toBe(menuSurfaceBefore);
  });

  it("makes the covered default view inert while settings is open", () => {
    const { container, getByLabelText } = render(<App />);
    const defaultView = container.querySelector(".app-view");
    expect(defaultView).not.toBeNull();
    expect(defaultView?.hasAttribute("inert")).toBe(false);

    fireEvent.click(getByLabelText("open settings"));
    expect(defaultView?.hasAttribute("inert")).toBe(true);

    fireEvent.click(getByLabelText("close settings"));
    expect(defaultView?.hasAttribute("inert")).toBe(false);
  });
});
