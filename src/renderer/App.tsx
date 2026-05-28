import { useEffect, useRef, useState } from "react";
import { Power, Settings, X } from "lucide-react";
import { Button } from "../ui";
import { AgentChat } from "./agent/AgentChat";
import { MenuSurface } from "./menu/MenuSurface";
import { SettingsView } from "./settings/SettingsView";

type AppView = "menu" | "settings";

export function App() {
  const [view, setView] = useState<AppView>("menu");
  const shellRef = useRef<HTMLElement>(null);
  // Hold the popover at the menu's height while in settings so toggling never
  // resizes the window or shrinks the visible card to the smaller settings body.
  const [frozenHeight, setFrozenHeight] = useState<number | null>(null);
  usePopoverContentHeight();
  useDropHeaderAutoFocus();

  function openSettings() {
    setFrozenHeight(shellRef.current?.offsetHeight ?? null);
    setView("settings");
  }

  function closeSettings() {
    setFrozenHeight(null);
    setView("menu");
  }

  function quitApp() {
    void window.babyMenu?.app.quit();
  }

  return (
    <main
      ref={shellRef}
      className="app-shell"
      aria-label="baby_menu tray popover"
      style={view === "settings" && frozenHeight ? { minHeight: `${frozenHeight}px` } : undefined}
    >
      <header className="pop-head">
        {view === "settings" ? (
          <span className="mark">settings</span>
        ) : (
          <span className="mark">
            baby<span className="sep">_</span>menu
          </span>
        )}
        {view === "settings" ? (
          <Button variant="ghost" size="sm" className="w-7 px-0" aria-label="close settings" onClick={closeSettings}>
            <X className="size-4" />
          </Button>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="w-7 px-0" aria-label="open settings" onClick={openSettings}>
              <Settings className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-7 px-0 hover:text-signal-danger"
              aria-label="quit baby_menu"
              onClick={quitApp}
            >
              <Power className="size-4" />
            </Button>
          </div>
        )}
      </header>
      {view === "settings" ? (
        <div className="pop-body">
          <SettingsView />
        </div>
      ) : (
        <>
          <div className="pop-body">
            <MenuSurface />
          </div>
          <AgentChat />
        </>
      )}
    </main>
  );
}

// Matches MAX_POPOVER_HEIGHT in src/main/popover.ts. While a design-system
// overlay is open we ask for the full window so the overlay has room rather than
// clipping; the main process clamps to the same max, so the value is stable.
const OVERLAY_POPOVER_HEIGHT = 720;

function measurePopoverContentHeight(shell: HTMLElement): number {
  const shellHeight = Math.ceil(shell.getBoundingClientRect().height);
  const overlayOpen = document.querySelector("[data-bm-overlay]") !== null;
  return overlayOpen ? Math.max(shellHeight, OVERLAY_POPOVER_HEIGHT) : shellHeight;
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
    // body subtree to react when one opens or closes.
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(report);
    mutationObserver?.observe(document.body, { childList: true, subtree: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);
}
