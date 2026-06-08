// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/renderer/App";

describe("App reload layout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("force-remounts the menu surface when the reload button is clicked", () => {
    const { container, getByLabelText } = render(<App />);

    const menuSurfaceBefore = container.querySelector(".menu-surface");
    expect(menuSurfaceBefore).not.toBeNull();

    fireEvent.click(getByLabelText("reload layout"));

    const menuSurfaceAfter = container.querySelector(".menu-surface");
    expect(menuSurfaceAfter).not.toBeNull();
    // A force reload remounts the entire layout: the menu surface is a brand new
    // DOM node, not the same one preserved across renders. This re-runs widget
    // and layout discovery and resets all widget React state.
    expect(menuSurfaceAfter).not.toBe(menuSurfaceBefore);
  });

  it("keeps the reload button available while settings is closed", () => {
    const { getByLabelText, queryByLabelText } = render(<App />);
    expect(queryByLabelText("reload layout")).not.toBeNull();
    // Opening settings should not break the default-view reload control.
    fireEvent.click(getByLabelText("open settings"));
    fireEvent.click(getByLabelText("close settings"));
    expect(queryByLabelText("reload layout")).not.toBeNull();
  });
});
