// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PopoverVisibilityState, RefreshableBabyMenuWidget } from "../src/shared/contracts";
import { WidgetHost, widgetsFromModule } from "../src/renderer/menu/WidgetHost";
import { useViewRefresh } from "../src/renderer/menu/useViewRefresh";

type VisibilityListener = (state: PopoverVisibilityState) => void;

function installPopoverVisibility(initialVisible?: boolean) {
  let listener: VisibilityListener | null = null;
  window.babyMenu = {
    popover: {
      setContentHeight: vi.fn(async () => ({ ok: true })),
      getVisibility:
        initialVisible === undefined ? undefined : vi.fn(async () => ({ visible: initialVisible })),
      onVisibility: vi.fn((cb: VisibilityListener) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
    },
  } as unknown as typeof window.babyMenu;
  return {
    emit(visible: boolean) {
      listener?.({ visible });
    },
  };
}

afterEach(() => {
  delete window.babyMenu;
  vi.useRealTimers();
});

describe("useViewRefresh", () => {
  it("refreshes a widget on its interval", () => {
    vi.useFakeTimers();
    const refreshView = vi.fn();

    renderHook(() => useViewRefresh({ id: "quota", viewRefreshIntervalMs: 1000, refreshView }));

    expect(refreshView).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2500));

    expect(refreshView).toHaveBeenCalledTimes(3);
  });

  it("pauses the interval while the popover is hidden and resumes on show", () => {
    vi.useFakeTimers();
    const popover = installPopoverVisibility();
    const refreshView = vi.fn();

    renderHook(() => useViewRefresh({ id: "quota", viewRefreshIntervalMs: 1000, refreshView }));
    expect(refreshView).toHaveBeenCalledTimes(1); // initial mount refresh

    act(() => popover.emit(false)); // popover hidden
    act(() => vi.advanceTimersByTime(5000));
    expect(refreshView).toHaveBeenCalledTimes(1); // no ticks while hidden

    act(() => popover.emit(true)); // popover shown again
    expect(refreshView).toHaveBeenCalledTimes(2); // refreshes immediately on show
    act(() => vi.advanceTimersByTime(2000));
    expect(refreshView).toHaveBeenCalledTimes(4); // interval resumed
  });

  it("does not start the interval when mounted while the popover is hidden", async () => {
    vi.useFakeTimers();
    const popover = installPopoverVisibility(false);
    const refreshView = vi.fn();

    renderHook(() => useViewRefresh({ id: "quota", viewRefreshIntervalMs: 1000, refreshView }));
    await act(async () => {});
    act(() => vi.advanceTimersByTime(5000));

    expect(refreshView).not.toHaveBeenCalled();

    act(() => popover.emit(true));

    expect(refreshView).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2000));
    expect(refreshView).toHaveBeenCalledTimes(3);
  });

  it("refreshes a widget without an interval each time the popover is shown", () => {
    const popover = installPopoverVisibility();
    const refreshView = vi.fn();

    renderHook(() => useViewRefresh({ id: "quota", refreshView }));
    expect(refreshView).toHaveBeenCalledTimes(1);

    act(() => popover.emit(false));
    expect(refreshView).toHaveBeenCalledTimes(1);

    act(() => popover.emit(true));
    expect(refreshView).toHaveBeenCalledTimes(2);
  });
});

describe("WidgetHost", () => {
  it("honors a refreshable widget's declared view refresh interval", () => {
    vi.useFakeTimers();
    const refreshView = vi.fn();
    const widget: RefreshableBabyMenuWidget = {
      id: "quota",
      title: "quota",
      viewRefreshIntervalMs: 1000,
      refreshView,
      render: () => null,
    };

    render(<WidgetHost widgets={[widget]} />);

    expect(refreshView).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(2500));

    expect(refreshView).toHaveBeenCalledTimes(3);
  });

  it("ignores runtime widget exports without refresh callbacks", () => {
    expect(
      widgetsFromModule({
        stale: {
          id: "stale",
          title: "Stale",
          viewRefreshIntervalMs: 1000,
          render: () => null,
        },
      }),
    ).toEqual([]);
  });
});
