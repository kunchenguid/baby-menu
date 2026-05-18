import { useEffect, useState } from "react";
import { AgentChat } from "./agent/AgentChat";
import { MenuSurface } from "./menu/MenuSurface";

export function App() {
  usePopoverContentHeight();

  return (
    <main className="app-shell" aria-label="baby_menu tray popover">
      <header className="pop-head">
        <span className="mark">
          baby<span className="sep">_</span>menu
        </span>
        <OpenAtLoginToggle />
      </header>
      <div className="pop-body">
        <MenuSurface />
      </div>
      <AgentChat />
    </main>
  );
}

function OpenAtLoginToggle() {
  const [openAtLogin, setOpenAtLogin] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.babyMenu?.settings?.get().then((settings) => {
      if (!cancelled) setOpenAtLogin(settings.openAtLogin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (openAtLogin === null || !window.babyMenu?.settings) return;
    const next = await window.babyMenu.settings.setOpenAtLogin(!openAtLogin);
    setOpenAtLogin(next.openAtLogin);
  }

  return (
    <button
      type="button"
      className={`settings-toggle${openAtLogin ? " enabled" : ""}`}
      aria-pressed={openAtLogin ? "true" : "false"}
      onClick={() => void toggle()}
    >
      login {openAtLogin ? "on" : "off"}
    </button>
  );
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
        const height = Math.ceil(element.getBoundingClientRect().height);
        if (!height || height === lastHeight) return;
        lastHeight = height;
        void window.babyMenu?.popover.setContentHeight(height);
      });
    };

    report();
    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
      };
    }

    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);
}
