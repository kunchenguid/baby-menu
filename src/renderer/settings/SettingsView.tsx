import { useEffect, useState } from "react";
import { Switch } from "../../ui";

export function SettingsView() {
  const [openAtLogin, setOpenAtLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.babyMenu?.settings?.get().then((settings) => {
      if (!cancelled) setOpenAtLogin(settings.openAtLogin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    if (!window.babyMenu?.settings) return;
    const result = await window.babyMenu.settings.setOpenAtLogin(next);
    setOpenAtLogin(result.openAtLogin);
  }

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xxs uppercase tracking-caps text-ink-label">preferences</span>
      <div className="flex items-center justify-between gap-4">
        <span className="flex flex-col gap-0.5">
          <span className="text-sm text-ink">open at login</span>
          <span className="text-xs text-ink-soft">launch baby_menu when you sign in</span>
        </span>
        <Switch checked={openAtLogin} onCheckedChange={(next) => void toggle(next)} aria-label="open at login" />
      </div>
    </div>
  );
}
