/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { helloWorldWidget } from "../extensions/hello-world/widget";

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

afterEach(() => {
  cleanup();
});

describe("hello-world widget examples", () => {
  it("renders each example as a clickable button", () => {
    render(<>{helloWorldWidget.render()}</>);
    const button = screen.getByRole("button", {
      name: /add a widget tracking my weekly claude code quota/i,
    });
    expect(button.tagName).toBe("BUTTON");
  });

  it("copies the example prompt to the clipboard when clicked", async () => {
    render(<>{helloWorldWidget.render()}</>);
    const prompt = "add a widget tracking my weekly claude code quota";
    fireEvent.click(screen.getByRole("button", { name: new RegExp(prompt, "i") }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(prompt));
  });

  it("shows transient copied feedback after a click", async () => {
    render(<>{helloWorldWidget.render()}</>);
    const prompt = "add a widget showing current cpu and memory usage %";
    fireEvent.click(screen.getByRole("button", { name: new RegExp(prompt, "i") }));

    await waitFor(() => expect(screen.getByText(/copied/i)).toBeTruthy());
  });
});
