// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/App";
import type { AgentChatResult, BabyMenuApi } from "../src/shared/contracts";

function installBabyMenuApi(overrides: Partial<BabyMenuApi> = {}) {
  const baseApi: BabyMenuApi = {
    recipes: {
      list: vi.fn(async () => []),
    },
    git: {
      save: vi.fn(async () => ({ ok: true, commit: "abcdef123456" })),
      rollback: vi.fn(async () => ({ ok: true })),
    },
    agent: {
      send: vi.fn(async () => ({
        assistantText: "Added a CPU temperature widget",
        session: {
          startedClean: true,
          canSave: true,
          canRollback: true,
          head: "abc123",
          message: "Review the generated repo changes, then Save or Rollback.",
        },
      })),
      onStatus: vi.fn(() => () => undefined),
    },
    capabilities: {
      list: vi.fn(async () => []),
      invoke: vi.fn(async () => undefined) as BabyMenuApi["capabilities"]["invoke"],
    },
    widgets: {
      list: vi.fn(async () => []),
    },
    popover: {
      setContentHeight: vi.fn(async () => ({ ok: true })),
    },
    settings: {
      get: vi.fn(async () => ({ openAtLogin: false })),
      setOpenAtLogin: vi.fn(async (openAtLogin: boolean) => ({ openAtLogin })),
    },
  };

  const api: BabyMenuApi = {
    ...baseApi,
    ...overrides,
    widgets: overrides.widgets ?? baseApi.widgets,
    popover: overrides.popover ?? baseApi.popover,
    settings: overrides.settings ?? baseApi.settings,
  };

  window.babyMenu = api;
  return api;
}

describe("Monochrome Lab renderer", () => {
  afterEach(() => {
    cleanup();
    delete window.babyMenu;
    vi.restoreAllMocks();
  });

  it("renders a tray popover surface instead of a chat dashboard", () => {
    installBabyMenuApi();

    render(<App />);

    expect(screen.getByRole("main", { name: "baby_menu tray popover" })).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.classList.contains("mark") === true && element.textContent === "baby_menu"),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("ask the agent")).toBeTruthy();
    expect(screen.queryByLabelText("Agent chat")).toBeNull();
    expect(screen.queryByText("dev-mode menu bar")).toBeNull();
    expect(screen.queryByText("live repo")).toBeNull();
    expect(screen.queryByText(/Save|Rollback|git|commit|files/i)).toBeNull();
  });

  it("uses a RunStrip while the agent works and a Keep/Undo SessionBar after", async () => {
    let finishRun: (result: AgentChatResult) => void = () => undefined;
    const api = installBabyMenuApi({
      agent: {
        send: vi.fn(
          () =>
            new Promise<AgentChatResult>((resolve) => {
              finishRun = resolve;
            }),
        ),
        onStatus: vi.fn(() => () => undefined),
      },
    });

    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("ask the agent"), {
      target: { value: "add a cpu temperature widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(api.agent.send).toHaveBeenCalledWith("add a cpu temperature widget");
    expect(screen.getByText("› add a cpu temperature widget")).toBeTruthy();
    expect(screen.getByText("Working...")).toBeTruthy();
    expect(screen.queryByPlaceholderText("agent working")).toBeNull();

    finishRun({
      assistantText: "Added a CPU temperature widget",
      session: {
        startedClean: true,
        canSave: true,
        canRollback: true,
        head: "abc123",
        message: "Review the generated repo changes, then Save or Rollback.",
      },
    });

    await screen.findByText("Added a CPU temperature widget");

    expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.queryByText(/Save|Rollback|git|commit|files/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));

    await waitFor(() => expect(api.git.save).toHaveBeenCalledOnce());
  });

  it("refuses a second run until the current change is kept or undone", async () => {
    const api = installBabyMenuApi();

    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("ask the agent"), {
      target: { value: "add a battery widget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    await screen.findByText("Added a CPU temperature widget");

    fireEvent.change(screen.getByPlaceholderText("ask the agent"), {
      target: { value: "add weather" },
    });
    fireEvent.click(screen.getByRole("button", { name: "send" }));

    expect(api.agent.send).toHaveBeenCalledOnce();
    expect(screen.getByText("Finish this change first")).toBeTruthy();
    expect(screen.getByText("keep or undo before asking again")).toBeTruthy();
  });
});
