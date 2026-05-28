/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src/renderer/agent/AgentChat";
import type { AgentChatResult, AgentRuntimeStatus } from "../src/shared/contracts";

function installBabyMenuAgentMock() {
  let statusListener: ((status: AgentRuntimeStatus) => void) | null = null;
  window.babyMenu = {
    recipes: {
      list: vi.fn(),
    },
    git: {
      save: vi.fn(),
      rollback: vi.fn(),
    },
    agent: {
      send: vi.fn(() => new Promise<AgentChatResult>(() => undefined)),
      onStatus: vi.fn((listener: (status: AgentRuntimeStatus) => void) => {
        statusListener = listener;
        return () => {
          statusListener = null;
        };
      }),
    },
    capabilities: {
      list: vi.fn(),
      invoke: vi.fn(),
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
    app: {
      quit: vi.fn(async () => ({ ok: true })),
    },
  };

  return {
    emitStatus(status: AgentRuntimeStatus) {
      statusListener?.(status);
    },
  };
}

afterEach(() => {
  cleanup();
  delete window.babyMenu;
});

describe("AgentChat", () => {
  it("replaces the composer with the run strip while the agent is working", async () => {
    installBabyMenuAgentMock();
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("ask the agent");
    fireEvent.change(composer, { target: { value: "add a CPU temperature widget" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("› add a CPU temperature widget")).toBeTruthy();
    expect(screen.getByText("Working...")).toBeTruthy();
    expect(screen.queryByPlaceholderText("agent working")).toBeNull();
    expect(screen.queryByPlaceholderText("ask the agent")).toBeNull();
    expect(screen.queryByRole("button", { name: "send" })).toBeNull();
  });

  it("shows assistant output status text and no synthetic status", async () => {
    const agent = installBabyMenuAgentMock();
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("ask the agent");
    fireEvent.change(composer, { target: { value: "summarize my pull requests" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("› summarize my pull requests")).toBeTruthy();
    expect(screen.queryByText("starting agent")).toBeNull();
    expect(screen.getByText("Working...")).toBeTruthy();

    act(() => {
      agent.emitStatus({ text: "I found two pull requests", eventType: "text_delta" });
    });

    expect(screen.getByText("I found two pull requests")).toBeTruthy();
  });
});
