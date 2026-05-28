// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { BabyMenuApi } from "../src/shared/contracts";

function installBabyMenuApi(): BabyMenuApi {
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
      get: vi.fn(async () => ({ openAtLogin: false })),
      setOpenAtLogin: vi.fn(async (openAtLogin: boolean) => ({ openAtLogin })),
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
    expect(screen.queryByText("open at login")).toBeNull();

    // Open settings.
    fireEvent.click(screen.getByRole("button", { name: "open settings" }));
    expect(await screen.findByText("open at login")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "open at login" });
    expect(toggle).toBeTruthy();
    // The agent composer is hidden in the settings context.
    expect(screen.queryByPlaceholderText("ask the agent")).toBeNull();

    // Toggle the setting.
    fireEvent.click(toggle);
    await waitFor(() => expect(api.settings.setOpenAtLogin).toHaveBeenCalledWith(true));

    // Return to the menu.
    fireEvent.click(screen.getByRole("button", { name: "close settings" }));
    expect(await screen.findByPlaceholderText("ask the agent")).toBeTruthy();
    expect(screen.queryByText("open at login")).toBeNull();
  });
});
