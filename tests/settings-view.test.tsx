// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import { SettingsView } from "../src/renderer/settings/SettingsView";
import type { BabyMenuApi, BabyMenuSettings, PopoverVisibilityState } from "../src/shared/contracts";

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
    git: { save: vi.fn(async () => ({ ok: true })), rollback: vi.fn(async () => ({ ok: true })) },
    agent: { send: vi.fn(async () => ({ assistantText: "" })), onStatus: vi.fn(() => () => undefined) },
    capabilities: { list: vi.fn(async () => []), invoke: vi.fn(async () => undefined) as BabyMenuApi["capabilities"]["invoke"] },
    db: {
      query: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      run: vi.fn(async () => ({ changes: 0, lastInsertRowid: 0 })),
      exec: vi.fn(async () => undefined),
    },
    widgets: { list: vi.fn(async () => []) },
    background: { onUpdate: vi.fn(() => () => undefined) },
    popover: {
      setContentHeight: vi.fn(async () => ({ ok: true })),
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
    },
    app: { quit: vi.fn(async () => ({ ok: true })) },
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
    expect(screen.getByPlaceholderText("ask the agent")).toBeTruthy();
    expect(screen.queryByText("launch at system start")).toBeNull();

    // Open settings.
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));
    expect(await screen.findByText("launch at system start")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "launch at system start" });
    expect(toggle).toBeTruthy();
    // The agent composer is hidden in the settings context.
    expect(screen.queryByPlaceholderText("ask the agent")).toBeNull();

    // Toggle the setting.
    fireEvent.click(toggle);
    await waitFor(() => expect(api.settings.setOpenAtLogin).toHaveBeenCalledWith(true));

    // Return to the menu.
    fireEvent.click(screen.getByRole("button", { name: "close settings" }));
    expect(await screen.findByPlaceholderText("ask the agent")).toBeTruthy();
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
