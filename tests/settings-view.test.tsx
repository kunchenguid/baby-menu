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
    widgets: { list: vi.fn(async () => []) },
    popover: { setContentHeight: vi.fn(async () => ({ ok: true })) },
    settings: {
      get: vi.fn(async () => ({ openAtLogin: false })),
      setOpenAtLogin: vi.fn(async (openAtLogin: boolean) => ({ openAtLogin })),
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
