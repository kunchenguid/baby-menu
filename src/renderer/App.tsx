import { useEffect, useRef, useState } from "react";
import { Power, RotateCw, Settings, X } from "lucide-react";
import { Button, Tooltip } from "../ui";
import { AgentChat } from "./agent/AgentChat";
import { MenuSurface } from "./menu/MenuSurface";
import { measurePopoverContentSize } from "./popover-content-height";
import { SettingsView } from "./settings/SettingsView";
import { UpdateIndicator } from "./UpdateIndicator";

type AppView = "menu" | "settings";

export function App() {
  const [view, setView] = useState<AppView>("menu");
  // Bumping this remounts the menu surface, forcing widget + layout discovery to
  // re-run and resetting all widget React state - a manual full layout reload.
  const [reloadNonce, setReloadNonce] = useState(0);
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

  function reloadLayout() {
    setReloadNonce((nonce) => nonce + 1);
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
            <Tooltip content="Reload layout">
              <Button
                variant="ghost"
                size="sm"
                className="w-7 px-0"
                aria-label="reload layout"
                onClick={reloadLayout}
              >
                <RotateCw className="size-4" />
              </Button>
            </Tooltip>
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
          <MenuSurface key={reloadNonce} />
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
    let lastWidth = 0;
    let lastHeight = 0;
    const report = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const { width, height } = measurePopoverContentSize(element);
        if (!height || (width === lastWidth && height === lastHeight)) return;
        lastWidth = width;
        lastHeight = height;
        void window.babyMenu?.popover.setContentSize({ width, height });
      });
    };

    report();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    resizeObserver?.observe(element);

    // Overlays (Dialog/Select/Dropdown) portal outside .app-shell, so watch the
    // body subtree to react when one opens or closes. Also observe the overlay
    // itself: a tall overlay can be max-h-clamped while the window is small, then
    // expand once the window grows, so we need to re-measure until it settles.
    // Observe the overlay and the layout canvas directly. The shell width is
    // 100% of the window, so a custom layout that changes only its own width (the
    // canvas overflows the shell) does not resize .app-shell and would otherwise
    // be missed; observing the canvas catches it so the window keeps adapting.
    const observed = new Map<string, Element>();
    const syncExtraObservations = () => {
      for (const selector of ["[data-bm-overlay]", "[data-bm-canvas]"]) {
        const next = document.querySelector(selector);
        const current = observed.get(selector) ?? null;
        if (next === current) continue;
        if (current) resizeObserver?.unobserve(current);
        if (next) {
          observed.set(selector, next);
          resizeObserver?.observe(next);
        } else {
          observed.delete(selector);
        }
      }
    };
    syncExtraObservations();
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            syncExtraObservations();
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
