// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RefreshableBabyMenuWidget } from "../src/shared/contracts";
import { WidgetHost, widgetsFromModule } from "../src/renderer/menu/WidgetHost";
import { useWidgetRefresh } from "../src/renderer/menu/useWidgetRefresh";

describe("useWidgetRefresh", () => {
  it("refreshes a widget on its interval", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();

    renderHook(() =>
      useWidgetRefresh({ id: "quota", refreshIntervalMs: 1000, refresh }),
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2500));

    expect(refresh).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("supports manual refresh", () => {
    const refresh = vi.fn();

    const { result } = renderHook(() =>
      useWidgetRefresh({ id: "quota", refreshIntervalMs: 1000, refresh }),
    );
    act(() => result.current.refreshNow());

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

describe("WidgetHost", () => {
  it("honors a refreshable widget's declared interval", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const widget: RefreshableBabyMenuWidget = {
      id: "quota",
      title: "quota",
      refreshIntervalMs: 1000,
      refresh,
      render: () => null,
    };

    render(<WidgetHost widgets={[widget]} />);

    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2500));

    expect(refresh).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("ignores runtime widget exports without refresh callbacks", () => {
    expect(
      widgetsFromModule({
        stale: {
          id: "stale",
          title: "Stale",
          refreshIntervalMs: 1000,
          render: () => null,
        },
      }),
    ).toEqual([]);
  });
});
