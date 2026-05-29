import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Field,
  Input,
  StatusDot,
  Switch,
  cn,
} from "../../ui";
import type { BabyMenuAgentOption, BabyMenuSettings, BabyMenuSettingsSection } from "../../shared/contracts";
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
  const [agentForm, setAgentForm] = useState<AgentFormState | null>(null);
  const [agentFormError, setAgentFormError] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [agentListError, setAgentListError] = useState<string | null>(null);
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

  function applySettings(result: BabyMenuSettings) {
    setAgentName(result.agentName);
    setAgents(result.agents);
    setAgentSwitchDisabledReason(result.agentSwitchDisabledReason);
  }

  async function confirmSwitch() {
    if (!window.babyMenu?.settings || !pendingAgent) return;
    applySettings(await window.babyMenu.settings.setAgent(pendingAgent.name));
    setPendingAgent(null);
  }

  function openAddAgentForm() {
    setAgentListError(null);
    setAgentFormError(null);
    setAgentForm({ mode: "add", name: "", label: "", command: "" });
  }

  function openEditAgentForm(agent: BabyMenuAgentOption) {
    setAgentListError(null);
    setAgentFormError(null);
    setAgentForm({ mode: "edit", name: agent.name, label: agent.label, command: agent.command ?? "" });
  }

  async function submitAgentForm() {
    if (!window.babyMenu?.settings || !agentForm) return;
    setSavingAgent(true);
    setAgentFormError(null);
    try {
      const label = agentForm.label.trim() || undefined;
      const command = agentForm.command.trim();
      const result =
        agentForm.mode === "add"
          ? await window.babyMenu.settings.addAgent({ name: agentForm.name.trim(), label, command })
          : await window.babyMenu.settings.updateAgent(agentForm.name, { label, command });
      applySettings(result);
      setAgentForm(null);
    } catch (error) {
      setAgentFormError(error instanceof Error ? error.message : "Could not save the agent.");
    } finally {
      setSavingAgent(false);
    }
  }

  async function removeAgent(agent: BabyMenuAgentOption) {
    if (!window.babyMenu?.settings) return;
    setAgentListError(null);
    try {
      applySettings(await window.babyMenu.settings.removeAgent(agent.name));
    } catch (error) {
      setAgentListError(error instanceof Error ? error.message : "Could not remove the agent.");
    }
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
            <div key={agent.name} className="flex items-center gap-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!agent.available || active || switchBlocked}
                onClick={() => setPendingAgent(agent)}
                className={cn(
                  "flex flex-1 items-center justify-between gap-3 rounded-sm border px-3 py-2 text-left outline-none transition-colors",
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
              {agent.custom ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-7 px-0"
                    aria-label={`edit ${agent.label}`}
                    onClick={() => openEditAgentForm(agent)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-7 px-0 hover:text-signal-danger"
                    aria-label={`remove ${agent.label}`}
                    onClick={() => void removeAgent(agent)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              ) : null}
            </div>
          );
        })}
        {agentListError ? <span className="text-xs text-signal-danger">{agentListError}</span> : null}
        <Button variant="ghost" size="sm" className="mt-1 gap-1.5 self-start" onClick={openAddAgentForm}>
          <Plus className="size-3.5" /> add agent
        </Button>
      </section>

      <Dialog open={agentForm !== null} onOpenChange={(open) => !open && setAgentForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>{agentForm?.mode === "edit" ? "edit agent" : "add agent"}</DialogTitle>
          <DialogDescription>
            Configure a custom ACP agent. The launch command is run as the ACP server; bake any env vars or args
            into it (e.g. <code className="text-ink">env KEY=… my-acp</code>).
          </DialogDescription>
          <DialogBody className="flex flex-col gap-3">
            <Field label="name" hint="Unique id: letters, numbers, dot, dash, or underscore.">
              <Input
                value={agentForm?.name ?? ""}
                disabled={agentForm?.mode === "edit"}
                placeholder="gemini"
                onChange={(event) => setAgentForm((form) => (form ? { ...form, name: event.target.value } : form))}
              />
            </Field>
            <Field label="label" hint="Optional display name; defaults to the id.">
              <Input
                value={agentForm?.label ?? ""}
                placeholder="Gemini"
                onChange={(event) => setAgentForm((form) => (form ? { ...form, label: event.target.value } : form))}
              />
            </Field>
            <Field label="command" hint="The ACP launch command.">
              <Input
                value={agentForm?.command ?? ""}
                placeholder="gemini acp"
                onChange={(event) => setAgentForm((form) => (form ? { ...form, command: event.target.value } : form))}
              />
            </Field>
            {agentFormError ? <span className="text-xs text-signal-danger">{agentFormError}</span> : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAgentForm(null)}>
              cancel
            </Button>
            <Button variant="primary" disabled={savingAgent} onClick={() => void submitAgentForm()}>
              save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

type AgentFormState = {
  mode: "add" | "edit";
  /** Immutable in edit mode (it is the acpx registry id). */
  name: string;
  label: string;
  command: string;
};

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
