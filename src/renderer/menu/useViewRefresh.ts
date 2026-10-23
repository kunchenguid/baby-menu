import { useEffect, useRef, useState } from "react";

export type ViewRefreshOptions = {
  id: string;
  viewRefreshIntervalMs?: number;
  refreshView: () => void | Promise<void>;
};

// Whether the popover is currently shown. The window hides (it is not
// unmounted) when it loses focus, so module-level polling (widget/layout
// discovery) must idle while hidden: every poll is an IPC round-trip plus a
// main-side filesystem walk, and a 1s cadence 24/7 keeps both processes and
// the efficiency cores awake for nobody. Consumers poll only while visible
// and refresh once on every show, so hidden edits still appear instantly.
export function usePopoverVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.babyMenu?.popover.onVisibility(({ visible }) => {
      if (!disposed) setVisible(visible);
    });
    void window.babyMenu?.popover
      .getVisibility?.()
      .then((state) => {
        if (!disposed && state) setVisible(state.visible);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return visible;
}

// View refresh keeps a *visible* widget current. The popover hides (it is not
// unmounted) when it loses focus, so an unconditional interval would keep firing
// for the whole session. We gate it on the main-emitted popover visibility signal
// (see app.ts) - the timer only runs while the popover is shown, and we refresh
// once on each show so the widget is current the moment the user looks at it.
export function useViewRefresh(options: ViewRefreshOptions) {
  const refreshRef = useRef(options.refreshView);
  refreshRef.current = options.refreshView;

  const refreshNow = () => {
    void refreshRef.current();
  };

  useEffect(() => {
    let disposed = false;
    let visibilityEventSeen = false;

    const intervalMs = options.viewRefreshIntervalMs;
    let timer: number | undefined;

    const start = () => {
      if (!intervalMs) return;
      if (timer !== undefined) return;
      timer = window.setInterval(refreshNow, intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };

    const show = () => {
      refreshNow();
      start();
    };

    const unsubscribe = window.babyMenu?.popover.onVisibility(({ visible }) => {
      visibilityEventSeen = true;
      if (visible) {
        show();
      } else {
        stop();
      }
    });

    const getVisibility = window.babyMenu?.popover.getVisibility;
    const initialize = async () => {
      const visibility = await getVisibility?.();
      if (disposed || visibilityEventSeen) return;
      if (visibility?.visible === false) {
        stop();
      } else {
        show();
      }
    };

    if (getVisibility) {
      void initialize();
    } else {
      show();
    }

    return () => {
      disposed = true;
      stop();
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.id, options.viewRefreshIntervalMs]);
}
