/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChat } from "../src/renderer/agent/AgentChat";
import type { AgentActiveTurn, AgentChatResult, AgentRuntimeStatus, GitSessionSnapshot } from "../src/shared/contracts";

function installBabyMenuAgentMock({
  session = null,
  activeTurn = null,
}: { session?: GitSessionSnapshot | null; activeTurn?: AgentActiveTurn | null } = {}) {
  let statusListener: ((status: AgentRuntimeStatus) => void) | null = null;
  window.babyMenu = {
    recipes: {
      list: vi.fn(),
    },
    git: {
      save: vi.fn(),
      rollback: vi.fn(),
      status: vi.fn(async () => session),
    },
    agent: {
      send: vi.fn(() => new Promise<AgentChatResult>(() => undefined)),
      onStatus: vi.fn((listener: (status: AgentRuntimeStatus) => void) => {
        statusListener = listener;
        return () => {
          statusListener = null;
        };
      }),
      getActiveTurn: vi.fn(async () => activeTurn),
    },
    capabilities: {
      list: vi.fn(),
      invoke: vi.fn(),
    },
    db: {
      query: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      run: vi.fn(async () => ({ changes: 0, lastInsertRowid: 0 })),
      exec: vi.fn(async () => undefined),
    },
    widgets: {
      list: vi.fn(async () => []),
    },
    background: { onUpdate: vi.fn(() => () => undefined) },
    popover: {
      setContentHeight: vi.fn(async () => ({ ok: true })),
      getVisibility: vi.fn(async () => ({ visible: true })),
      onVisibility: vi.fn(() => () => undefined),
    },
    settings: {
      get: vi.fn(async () => ({ openAtLogin: false, agentName: "claude", agents: [] })),
      setOpenAtLogin: vi.fn(async (openAtLogin: boolean) => ({ openAtLogin, agentName: "claude", agents: [] })),
      setAgent: vi.fn(async (agentName: string) => ({ openAtLogin: false, agentName, agents: [] })),
      addAgent: vi.fn(async () => ({ openAtLogin: false, agentName: "claude", agents: [] })),
      updateAgent: vi.fn(async () => ({ openAtLogin: false, agentName: "claude", agents: [] })),
      removeAgent: vi.fn(async () => ({ openAtLogin: false, agentName: "claude", agents: [] })),
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

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "add a CPU temperature widget" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("› add a CPU temperature widget")).toBeTruthy();
    expect(screen.getByText("Working...")).toBeTruthy();
    expect(screen.queryByPlaceholderText("agent working")).toBeNull();
    expect(screen.queryByPlaceholderText("talk to the baby")).toBeNull();
    expect(screen.queryByRole("button", { name: "send" })).toBeNull();
  });

  it("shows assistant output status text and no synthetic status", async () => {
    const agent = installBabyMenuAgentMock();
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
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

  it("restores the in-progress run strip (not a Keep/Undo prompt) when a turn is still running on mount", async () => {
    // Mid-build, the popover view can remount (returning from Settings). Main is
    // the source of truth: it reports an active turn, so the run strip comes back
    // and the Keep/Undo prompt must NOT appear yet.
    installBabyMenuAgentMock({
      activeTurn: { title: "add a codex widget", startedAt: Date.now() - 3_000 },
      // git.status would return null mid-turn, but assert independently of it.
      session: { startedClean: true, canSave: true, canRollback: true, head: null },
    });
    render(<AgentChat />);

    expect(await screen.findByText("› add a codex widget")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("re-hydrates a pending Keep/Undo prompt from an outstanding session on mount", async () => {
    installBabyMenuAgentMock({
      session: {
        startedClean: true,
        canSave: true,
        canRollback: true,
        head: null,
        message: "Review the generated changes, then Save or Rollback.",
      },
    });
    render(<AgentChat />);

    expect(await screen.findByRole("button", { name: "Keep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    expect(screen.getByText("Review the generated changes, then Save or Rollback.")).toBeTruthy();
  });

  it("does not show a prompt when no change session is open on mount", async () => {
    const agent = installBabyMenuAgentMock({ session: null });
    render(<AgentChat />);

    // Let the mount-time git.status() resolve before asserting absence.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.getByPlaceholderText("talk to the baby")).toBeTruthy();
    void agent;
  });
});
