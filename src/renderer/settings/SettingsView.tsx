import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  StatusDot,
  Switch,
  cn,
} from "../../ui";
import type { BabyMenuAgentOption, BabyMenuSettingsSection } from "../../shared/contracts";
import { importRuntimeModule, type RuntimeModuleImporter } from "../extension-modules";
import { loadRuntimeSettingsSections } from "./settings-sections";

type SettingsViewProps = {
  // Explicit sections short-circuit runtime discovery (used by tests and any
  // future host-provided sections). When omitted, sections are discovered from
  // the active extension workspace, mirroring WidgetHost.
  sections?: BabyMenuSettingsSection[];
  runtimeImporter?: RuntimeModuleImporter;
};

export function SettingsView({ sections, runtimeImporter }: SettingsViewProps = {}) {
  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [agents, setAgents] = useState<BabyMenuAgentOption[]>([]);
  const [agentName, setAgentName] = useState("");
  const [agentSwitchDisabledReason, setAgentSwitchDisabledReason] = useState<string | undefined>();
  const [pendingAgent, setPendingAgent] = useState<BabyMenuAgentOption | null>(null);
  const runtimeSections = useRuntimeSettingsSections({ enabled: sections === undefined, importer: runtimeImporter });
  const visibleSections = sections ?? runtimeSections;

  useEffect(() => {
    let cancelled = false;
    void window.babyMenu?.settings?.get().then((settings) => {
      if (cancelled) return;
      setOpenAtLogin(settings.openAtLogin);
      setAgents(settings.agents);
      setAgentName(settings.agentName);
      setAgentSwitchDisabledReason(settings.agentSwitchDisabledReason);
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

  async function confirmSwitch() {
    if (!window.babyMenu?.settings || !pendingAgent) return;
    const result = await window.babyMenu.settings.setAgent(pendingAgent.name);
    setAgentName(result.agentName);
    setAgents(result.agents);
    setAgentSwitchDisabledReason(result.agentSwitchDisabledReason);
    setPendingAgent(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <span className="text-xxs uppercase tracking-caps text-ink-label">preferences</span>
        <div className="flex items-center justify-between gap-4">
          <span className="flex flex-col gap-0.5">
            <span className="text-sm text-ink">launch at system start</span>
            <span className="text-xs text-ink-soft">Automatically start baby menu along with your system</span>
          </span>
          <Switch checked={openAtLogin} onCheckedChange={(next) => void toggle(next)} aria-label="launch at system start" />
        </div>
      </section>

      <section className="flex flex-col gap-2" role="radiogroup" aria-label="agent">
        <span className="text-xxs uppercase tracking-caps text-ink-label">agent</span>
        {agents.map((agent) => {
          const active = agent.name === agentName;
          const switchBlocked = Boolean(agentSwitchDisabledReason && !active);
          return (
            <button
              key={agent.name}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!agent.available || active || switchBlocked}
              onClick={() => setPendingAgent(agent)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left outline-none transition-colors",
                active ? "border-signal-live bg-elevated" : "border-line hover:bg-pressed",
                !agent.available && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm text-ink">{agent.label}</span>
                {!agent.available && agent.installHint ? (
                  <span className="text-xs text-ink-soft">{agent.installHint}</span>
                ) : null}
                {agent.available && switchBlocked ? <span className="text-xs text-ink-soft">{agentSwitchDisabledReason}</span> : null}
              </span>
              {active ? <StatusDot tone="live" /> : null}
            </button>
          );
        })}
      </section>

      <Dialog open={pendingAgent !== null} onOpenChange={(open) => !open && setPendingAgent(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>switch agent?</DialogTitle>
          <DialogDescription>
            Switching to {pendingAgent?.label} will reset the current conversation. The new agent starts fresh with no
            memory of this chat.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingAgent(null)}>
              cancel
            </Button>
            <Button variant="primary" onClick={() => void confirmSwitch()}>
              switch and reset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {visibleSections.map((section) => (
        <section key={section.extensionId} className="flex flex-col gap-3">
          <span className="text-xxs uppercase tracking-caps text-ink-label">{section.title}</span>
          <div>{section.render()}</div>
        </section>
      ))}
    </div>
  );
}

function useRuntimeSettingsSections({
  enabled,
  importer = importRuntimeModule,
}: {
  enabled: boolean;
  importer?: RuntimeModuleImporter;
}) {
  const [sections, setSections] = useState<BabyMenuSettingsSection[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let loadVersion = 0;
    const load = () => {
      const currentLoad = ++loadVersion;
      void loadRuntimeSettingsSections(importer).then((loaded) => {
        if (!cancelled && currentLoad === loadVersion) setSections(loaded);
      });
    };

    load();
    const unsubscribe = window.babyMenu?.popover.onVisibility(({ visible }) => {
      if (visible) load();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled, importer]);

  return sections;
}
