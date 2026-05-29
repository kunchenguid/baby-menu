import { useEffect, useRef, useState } from "react";
import { Power, Settings, X } from "lucide-react";
import { Button, Tooltip } from "../ui";
import { AgentChat } from "./agent/AgentChat";
import { MenuSurface } from "./menu/MenuSurface";
import { measurePopoverContentHeight } from "./popover-content-height";
import { SettingsView } from "./settings/SettingsView";
import { UpdateIndicator } from "./UpdateIndicator";

type AppView = "menu" | "settings";

export function App() {
  const [view, setView] = useState<AppView>("menu");
  const shellRef = useRef<HTMLElement>(null);
  usePopoverContentHeight();
  useDropHeaderAutoFocus();

  const settingsOpen = view === "settings";

  function openSettings() {
    setView("settings");
  }

  function closeSettings() {
    setView("menu");
  }

  function quitApp() {
    void window.babyMenu?.app.quit();
  }

  return (
    <main ref={shellRef} className="app-shell" aria-label="baby_menu tray popover">
      {/* The default view stays mounted underneath settings so its React state
          (agent chat, widgets) survives opening and closing settings. It is made
          inert while covered so focus and pointer events cannot reach behind the
          overlay. */}
      <div className="app-view" inert={settingsOpen}>
        <header className="pop-head">
          <span className="mark">
            baby<span className="sep">_</span>menu
          </span>
          <div className="flex items-center gap-1">
            <UpdateIndicator />
            <Tooltip content="Open settings">
              <Button variant="ghost" size="sm" className="w-7 px-0" aria-label="open settings" onClick={openSettings}>
                <Settings className="size-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Quit baby menu">
              <Button
                variant="ghost"
                size="sm"
                className="w-7 px-0 hover:text-signal-danger"
                aria-label="quit baby_menu"
                onClick={quitApp}
              >
                <Power className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </header>
        <div className="pop-body">
          <MenuSurface />
        </div>
        <AgentChat />
      </div>

      {settingsOpen ? (
        <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="settings">
          <header className="pop-head">
            <span className="mark">settings</span>
            <Tooltip content="Close settings">
              <Button variant="ghost" size="sm" className="w-7 px-0" aria-label="close settings" onClick={closeSettings}>
                <X className="size-4" />
              </Button>
            </Tooltip>
          </header>
          <div className="pop-body">
            <SettingsView />
          </div>
        </div>
      ) : null}
    </main>
  );
}

// The popover opens focused (main calls window.focus()); if that focus lands on a
// header control it gets ring-highlighted before the user does anything. Clear
// that auto-focus without touching genuine keyboard focus elsewhere.
function useDropHeaderAutoFocus() {
  useEffect(() => {
    const drop = () => {
      requestAnimationFrame(() => {
        const active = document.activeElement as HTMLElement | null;
        if (active && active.closest(".pop-head")) active.blur();
      });
    };
    drop();
    window.addEventListener("focus", drop);
    return () => window.removeEventListener("focus", drop);
  }, []);
}

function usePopoverContentHeight() {
  useEffect(() => {
    const element = document.querySelector<HTMLElement>(".app-shell");
    if (!element || !window.babyMenu?.popover) return undefined;

    let animationFrame = 0;
    let lastHeight = 0;
    const report = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const height = measurePopoverContentHeight(element);
        if (!height || height === lastHeight) return;
        lastHeight = height;
        void window.babyMenu?.popover.setContentHeight(height);
      });
    };

    report();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    resizeObserver?.observe(element);

    // Overlays (Dialog/Select/Dropdown) portal outside .app-shell, so watch the
    // body subtree to react when one opens or closes. Also observe the overlay
    // itself: a tall overlay can be max-h-clamped while the window is small, then
    // expand once the window grows, so we need to re-measure until it settles.
    let observedOverlay: Element | null = null;
    const syncOverlayObservation = () => {
      const overlay = document.querySelector("[data-bm-overlay]");
      if (overlay === observedOverlay) return;
      if (observedOverlay) resizeObserver?.unobserve(observedOverlay);
      observedOverlay = overlay;
      if (overlay) resizeObserver?.observe(overlay);
    };
    syncOverlayObservation();
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            syncOverlayObservation();
            report();
          });
    mutationObserver?.observe(document.body, { childList: true, subtree: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);
}
