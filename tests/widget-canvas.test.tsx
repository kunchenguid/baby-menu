// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetHost, layoutFromModule, loadRuntimeLayout } from "../src/renderer/menu/WidgetHost";
import type { BabyMenuLayout, RefreshableBabyMenuWidget } from "../src/shared/contracts";

afterEach(() => {
  cleanup();
  delete window.babyMenu;
});

const widgetA: RefreshableBabyMenuWidget = { id: "a", title: "ALPHA", render: () => <span>alpha-body</span> };
const widgetB: RefreshableBabyMenuWidget = { id: "b", title: "BRAVO", render: () => <span>bravo-body</span> };

describe("WidgetHost layout", () => {
  it("renders widgets without a host-drawn title header so the extension owns its area", () => {
    const { container } = render(<WidgetHost widgets={[widgetA]} layout={null} />);

    expect(screen.getByText("alpha-body")).toBeTruthy();
    // The old per-widget title chrome is gone.
    expect(container.querySelector(".w-head")).toBeNull();
    expect(screen.queryByText("ALPHA")).toBeNull();
  });

  it("uses the built-in column when there is no custom layout", () => {
    const { container } = render(<WidgetHost widgets={[widgetA, widgetB]} layout={null} />);

    expect(container.querySelector(".widget-host")).toBeTruthy();
    expect(container.querySelector("[data-bm-canvas]")).toBeNull();
  });

  it("renders an agent-authored layout that arranges widgets by id", () => {
    const layout: BabyMenuLayout = ({ widgets, renderWidget }) => (
      <div data-testid="canvas-grid">
        {widgets.map((w) => (
          <section key={w.id} data-col={w.id}>
            {renderWidget(w.id)}
          </section>
        ))}
      </div>
    );

    const { container } = render(<WidgetHost widgets={[widgetA, widgetB]} layout={layout} />);

    expect(container.querySelector("[data-bm-canvas]")).toBeTruthy();
    expect(screen.getByTestId("canvas-grid")).toBeTruthy();
    expect(screen.getByText("alpha-body")).toBeTruthy();
    expect(screen.getByText("bravo-body")).toBeTruthy();
  });

  it("falls back to the built-in column when the custom layout throws", () => {
    const Boom: BabyMenuLayout = () => {
      throw new Error("layout blew up");
    };

    const { container } = render(<WidgetHost widgets={[widgetA]} layout={Boom} />);

    // The popover never blanks: the column renders the widget content instead.
    expect(container.querySelector(".widget-host")).toBeTruthy();
    expect(screen.getByText("alpha-body")).toBeTruthy();
  });
});

describe("loadRuntimeLayout", () => {
  it("loads the default-export component from the discovered module", async () => {
    const Layout: BabyMenuLayout = () => null;
    window.babyMenu = {
      layout: { get: vi.fn(async () => ({ moduleUrl: "/@fs/x/layout.tsx" })) },
    } as unknown as typeof window.babyMenu;

    const loaded = await loadRuntimeLayout(async () => ({ default: Layout }));
    expect(loaded).toBe(Layout);
  });

  it("returns null when there is no layout module", async () => {
    window.babyMenu = { layout: { get: vi.fn(async () => null) } } as unknown as typeof window.babyMenu;
    expect(await loadRuntimeLayout(async () => ({}))).toBeNull();
  });

  it("degrades to null (built-in column) when the host bridge lacks layout.get", async () => {
    window.babyMenu = {} as unknown as typeof window.babyMenu;
    await expect(loadRuntimeLayout(async () => ({}))).resolves.toBeNull();
  });

  it("degrades to null when importing the module throws", async () => {
    window.babyMenu = {
      layout: { get: vi.fn(async () => ({ moduleUrl: "/@fs/x/layout.tsx" })) },
    } as unknown as typeof window.babyMenu;
    await expect(
      loadRuntimeLayout(async () => {
        throw new Error("boom");
      }),
    ).resolves.toBeNull();
  });
});

describe("layoutFromModule", () => {
  it("extracts a default-export function component", () => {
    const Layout: BabyMenuLayout = () => null;
    expect(layoutFromModule({ default: Layout })).toBe(Layout);
  });

  it("returns null when there is no default export function", () => {
    expect(layoutFromModule({})).toBeNull();
    expect(layoutFromModule({ default: 42 })).toBeNull();
    expect(layoutFromModule(null)).toBeNull();
  });
});
