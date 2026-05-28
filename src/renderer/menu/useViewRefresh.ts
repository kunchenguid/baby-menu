import { useEffect, useRef } from "react";

export type ViewRefreshOptions = {
  id: string;
  viewRefreshIntervalMs?: number;
  refreshView: () => void | Promise<void>;
};

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
    refreshNow();
    if (!options.viewRefreshIntervalMs) return undefined;

    const intervalMs = options.viewRefreshIntervalMs;
    let timer: number | undefined;

    const start = () => {
      if (timer !== undefined) return;
      timer = window.setInterval(refreshNow, intervalMs);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };

    start();

    // Assume visible on mount: the host first renders as the popover is being
    // shown, so the only transition we must react to first is a hide.
    const unsubscribe = window.babyMenu?.popover.onVisibility(({ visible }) => {
      if (visible) {
        refreshNow();
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.id, options.viewRefreshIntervalMs]);

  return { refreshNow };
}
