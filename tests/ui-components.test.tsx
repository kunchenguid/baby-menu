// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Button, DataTable, Field, Input, Progress, Skeleton, Sparkline, StatusDot, Tooltip } from "../src/ui";

describe("@babymenu/ui components", () => {
  it("renders a button with variant styling and a safe default type", () => {
    const { getByRole } = render(<Button variant="danger">delete</Button>);
    const button = getByRole("button", { name: "delete" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("text-signal-danger");
  });

  it("renders status signals with tone", () => {
    const { container } = render(
      <span>
        <StatusDot tone="warn" />
        <Badge tone="live">live</Badge>
      </span>,
    );
    expect(container.querySelector("[data-slot='status-dot']")?.className).toContain("bg-signal-warn");
    expect(container.querySelector("[data-slot='badge']")?.textContent).toBe("live");
  });

  it("pulses a status dot when asked", () => {
    const { container } = render(<StatusDot tone="live" pulse />);
    const dot = container.querySelector("[data-slot='status-dot']");
    expect(dot?.className).toContain("animate-pulse");
  });

  it("does not pulse by default", () => {
    const { container } = render(<StatusDot tone="live" />);
    const dot = container.querySelector("[data-slot='status-dot']");
    expect(dot?.className).not.toContain("animate-pulse");
  });

  it("associates a Field label with its control", () => {
    const { getByText, getByRole } = render(
      <Field label="Threshold">
        <Input placeholder="80" />
      </Field>,
    );
    const label = getByText("Threshold");
    const input = getByRole("textbox");
    expect(label.getAttribute("for")).toBeTruthy();
    expect(label.getAttribute("for")).toBe(input.id);
  });

  it("renders DataTable rows and an empty state", () => {
    const columns = [
      { key: "name", header: "name" },
      { key: "value", header: "value", align: "right" as const, render: (row: { value: number }) => `${row.value}%` },
    ];
    const { getByText, rerender } = render(
      <DataTable columns={columns} rows={[{ name: "cpu", value: 72 }]} />,
    );
    expect(getByText("cpu")).toBeTruthy();
    expect(getByText("72%")).toBeTruthy();

    rerender(<DataTable columns={columns} rows={[]} empty="nothing here" />);
    expect(getByText("nothing here")).toBeTruthy();
  });

  it("clamps Progress value into the indicator width", () => {
    const { container } = render(<Progress value={140} />);
    const indicator = container.querySelector("[data-slot='progress-indicator']") as HTMLElement;
    expect(indicator.style.width).toBe("100%");
  });

  it("draws a sparkline path for a data series", () => {
    const { container } = render(<Sparkline data={[1, 4, 2, 8, 5]} />);
    const path = container.querySelector("path");
    expect(path?.getAttribute("d")).toMatch(/^M0/);
  });

  it("does not mark its tooltip content as a full-height overlay", async () => {
    // The popover grows to the overlay height whenever a [data-bm-overlay] element
    // exists. A small positioned tooltip must not opt into that, or hovering a
    // header button stretches the popover.
    render(
      <Tooltip content="Open settings" defaultOpen>
        <button type="button">gear</button>
      </Tooltip>,
    );
    const tip = document.querySelector("[data-slot='tooltip-content']");
    expect(tip).not.toBeNull();
    expect(tip?.textContent).toContain("Open settings");
    expect(tip?.hasAttribute("data-bm-overlay")).toBe(false);
  });

  it("renders a skeleton placeholder", () => {
    const { container } = render(<Skeleton className="h-4 w-10" />);
    expect(container.querySelector("[data-slot='skeleton']")?.className).toContain("animate-pulse");
  });
});
