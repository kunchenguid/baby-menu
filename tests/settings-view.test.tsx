// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { SettingsView } from "../src/renderer/settings/SettingsView";
import type { BabyMenuApi, BabyMenuCustomAgentInput, BabyMenuSettings, PopoverVisibilityState } from "../src/shared/contracts";

function installBabyMenuApi(settings?: Partial<BabyMenuSettings>): BabyMenuApi {
  const base: BabyMenuSettings = {
    openAtLogin: false,
    agentName: "claude",
    agents: [{ name: "claude", label: "Claude Code", available: true }],
    ...settings,
  };
  let current = base;
  const api: BabyMenuApi = {
    recipes: { list: vi.fn(async () => []) },
    git: { save: vi.fn(async () => ({ ok: true })), rollback: vi.fn(async () => ({ ok: true })), status: vi.fn(async () => null) },
    agent: { send: vi.fn(async () => ({ assistantText: "" })), onStatus: vi.fn(() => () => undefined), getActiveTurn: vi.fn(async () => null) },
    capabilities: { list: vi.fn(async () => []), invoke: vi.fn(async () => undefined) as BabyMenuApi["capabilities"]["invoke"] },
    db: {
      query: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      run: vi.fn(async () => ({ changes: 0, lastInsertRowid: 0 })),
      exec: vi.fn(async () => undefined),
    },
    widgets: { list: vi.fn(async () => []) },
    background: { onUpdate: vi.fn(() => () => undefined) },
    layout: { get: vi.fn(async () => null) },
    popover: {
      setContentHeight: vi.fn(async () => ({ ok: true })),
      setContentSize: vi.fn(async () => ({ ok: true })),
      getVisibility: vi.fn(async () => ({ visible: true })),
      onVisibility: vi.fn(() => () => undefined),
    },
    settings: {
      get: vi.fn(async () => current),
      setOpenAtLogin: vi.fn(async (openAtLogin: boolean) => {
        current = { ...current, openAtLogin };
        return current;
      }),
      setAgent: vi.fn(async (agentName: string) => {
        current = { ...current, agentName };
        return current;
      }),
      addAgent: vi.fn(async (input: BabyMenuCustomAgentInput) => {
        current = {
          ...current,
          agents: [
            ...current.agents,
            { name: input.name, label: input.label ?? input.name, available: true, custom: true, command: input.command },
          ],
        };
        return current;
      }),
      updateAgent: vi.fn(async (name: string, input: { label?: string; command: string }) => {
        current = {
          ...current,
          agents: current.agents.map((agent) =>
            agent.name === name ? { ...agent, label: input.label ?? agent.label, command: input.command } : agent,
          ),
        };
        return current;
      }),
      removeAgent: vi.fn(async (name: string) => {
        current = { ...current, agents: current.agents.filter((agent) => agent.name !== name) };
        return current;
      }),
    },
    app: {
      quit: vi.fn(async () => ({ ok: true })),
      getUpdateStatus: vi.fn(async () => ({ currentVersion: "0.0.0", latestVersion: null, updateAvailable: false, releaseUrl: null })),
      openReleasePage: vi.fn(async () => ({ ok: true })),
    },
  };
  window.babyMenu = api;
  return api;
}

afterEach(() => {
  cleanup();
  delete window.babyMenu;
});

describe("settings view", () => {
  it("opens settings from the header gear, toggles open-at-login, and returns to the menu", async () => {
    const api = installBabyMenuApi();
    render(<App />);

    // Menu view: composer present, no settings controls.
    expect(screen.getByPlaceholderText("talk to the baby")).toBeTruthy();
    expect(screen.queryByText("launch at system start")).toBeNull();

    // Open settings.
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));
    expect(await screen.findByText("launch at system start")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "launch at system start" });
    expect(toggle).toBeTruthy();
    // Settings is an overlay: the agent composer stays mounted underneath (so its
    // state survives), but the covered default view is made inert.
    expect(screen.getByPlaceholderText("talk to the baby")).toBeTruthy();
    expect(document.querySelector(".app-view")?.hasAttribute("inert")).toBe(true);

    // Toggle the setting.
    fireEvent.click(toggle);
    await waitFor(() => expect(api.settings.setOpenAtLogin).toHaveBeenCalledWith(true));

    // Return to the menu.
    fireEvent.click(screen.getByRole("button", { name: "close settings" }));
    expect(await screen.findByPlaceholderText("talk to the baby")).toBeTruthy();
    expect(screen.queryByText("launch at system start")).toBeNull();
  });

  it("shows unavailable agents disabled with an install hint", async () => {
    installBabyMenuApi({
      agentName: "claude",
      agents: [
        { name: "claude", label: "Claude Code", available: true },
        { name: "codex", label: "Codex", available: false, installHint: "Install the Codex CLI." },
      ],
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));

    const codex = await screen.findByRole("radio", { name: /Codex/ });
    expect((codex as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Install the Codex CLI.")).toBeTruthy();
  });

  it("confirms before switching agents and calls setAgent on confirm", async () => {
    const api = installBabyMenuApi({
      agentName: "claude",
      agents: [
        { name: "claude", label: "Claude Code", available: true },
        { name: "codex", label: "Codex", available: true },
      ],
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));

    fireEvent.click(await screen.findByRole("radio", { name: /Codex/ }));

    // Confirmation must make the conversation-reset consequence clear.
    expect(await screen.findByText(/will reset the current conversation/i)).toBeTruthy();
    expect(api.settings.setAgent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /switch and reset/i }));
    await waitFor(() => expect(api.settings.setAgent).toHaveBeenCalledWith("codex"));
  });

  it("does not switch agents when the confirmation is cancelled", async () => {
    const api = installBabyMenuApi({
      agentName: "claude",
      agents: [
        { name: "claude", label: "Claude Code", available: true },
        { name: "codex", label: "Codex", available: true },
      ],
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));

    fireEvent.click(await screen.findByRole("radio", { name: /Codex/ }));
    fireEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    await waitFor(() => expect(screen.queryByText(/will reset/i)).toBeNull());
    expect(api.settings.setAgent).not.toHaveBeenCalled();
  });

  it("disables agent switching with a visible reason when switching is blocked", async () => {
    const api = installBabyMenuApi({
      agentName: "claude",
      agentSwitchDisabledReason: "Save or Rollback the current agent changes before switching agents.",
      agents: [
        { name: "claude", label: "Claude Code", available: true },
        { name: "codex", label: "Codex", available: true },
      ],
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));

    const codex = await screen.findByRole("radio", { name: /Codex/ });

    expect((codex as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Save or Rollback the current agent changes before switching agents.")).toBeTruthy();
    fireEvent.click(codex);
    expect(screen.queryByText(/will reset the current conversation/i)).toBeNull();
    expect(api.settings.setAgent).not.toHaveBeenCalled();
  });

  it("renders a discovered extension settings section below app preferences", async () => {
    installBabyMenuApi();
    window.babyMenu!.widgets.list = vi.fn(async () => [
      { id: "calendar.widget", extensionId: "calendar", moduleUrl: "/@fs/calendar/widget.tsx" },
    ]);

    render(
      <SettingsView
        runtimeImporter={async () => ({
          calendarSettings: {
            extensionId: "calendar",
            title: "CALENDAR",
            render: () => <span>which calendar</span>,
          },
        })}
      />,
    );

    // App preference still renders first.
    expect(await screen.findByText("launch at system start")).toBeTruthy();
    // The extension's section title (host-drawn frame) and body both appear.
    expect(await screen.findByText("CALENDAR")).toBeTruthy();
    expect(screen.getByText("which calendar")).toBeTruthy();
  });

  async function openSettings() {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));
    await screen.findByText("launch at system start");
  }

  it("adds a custom ACP agent through the dialog", async () => {
    const api = installBabyMenuApi({ agents: [{ name: "claude", label: "Claude Code", available: true }] });
    await openSettings();

    fireEvent.click(screen.getByRole("button", { name: /add agent/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "gemini" } });
    fireEvent.change(screen.getByLabelText(/^command$/i), { target: { value: "gemini acp" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(api.settings.addAgent).toHaveBeenCalledWith({ name: "gemini", label: undefined, command: "gemini acp" }),
    );
    expect(await screen.findByRole("radio", { name: /Gemini/i })).toBeTruthy();
  });

  it("shows edit/remove controls only for custom agents", async () => {
    installBabyMenuApi({
      agents: [
        { name: "claude", label: "Claude Code", available: true },
        { name: "gemini", label: "Gemini", available: true, custom: true, command: "gemini acp" },
      ],
    });
    await openSettings();

    expect(screen.queryByRole("button", { name: /remove Claude Code/i })).toBeNull();
    expect(await screen.findByRole("button", { name: /remove Gemini/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit Gemini/i })).toBeTruthy();
  });

  it("removes a custom agent", async () => {
    const api = installBabyMenuApi({
      agents: [
        { name: "claude", label: "Claude Code", available: true },
        { name: "gemini", label: "Gemini", available: true, custom: true, command: "gemini acp" },
      ],
    });
    await openSettings();

    fireEvent.click(await screen.findByRole("button", { name: /remove Gemini/i }));
    await waitFor(() => expect(api.settings.removeAgent).toHaveBeenCalledWith("gemini"));
    await waitFor(() => expect(screen.queryByRole("radio", { name: /Gemini/i })).toBeNull());
  });

  it("surfaces the error when adding an invalid agent and keeps the dialog open", async () => {
    const api = installBabyMenuApi({ agents: [{ name: "claude", label: "Claude Code", available: true }] });
    api.settings.addAgent = vi.fn(async () => {
      throw new Error('"claude" is a built-in agent name. Choose a different name.');
    });
    await openSettings();

    fireEvent.click(screen.getByRole("button", { name: /add agent/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "claude" } });
    fireEvent.change(screen.getByLabelText(/^command$/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/built-in agent name/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeTruthy();
  });

  it("rediscovers extension settings sections when the popover reopens", async () => {
    const api = installBabyMenuApi();
    const visibilityListeners: Array<(state: PopoverVisibilityState) => void> = [];
    api.popover.onVisibility = vi.fn((listener) => {
      visibilityListeners.push(listener);
      return () => undefined;
    });
    window.babyMenu!.widgets.list = vi.fn(async () => [
      { id: "calendar.widget", extensionId: "calendar", moduleUrl: "/@fs/calendar/widget.tsx" },
    ]);
    let sectionLabel = "before reopen";
    const runtimeImporter = vi.fn(async () => ({
      calendarSettings: {
        extensionId: "calendar",
        title: "CALENDAR",
        render: () => <span>{sectionLabel}</span>,
      },
    }));

    render(<SettingsView runtimeImporter={runtimeImporter} />);
    expect(await screen.findByText("before reopen")).toBeTruthy();

    sectionLabel = "after reopen";
    visibilityListeners.forEach((listener) => listener({ visible: false }));
    visibilityListeners.forEach((listener) => listener({ visible: true }));

    expect(await screen.findByText("after reopen")).toBeTruthy();
    expect(runtimeImporter).toHaveBeenCalledTimes(2);
  });
});
