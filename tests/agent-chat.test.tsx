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
    layout: { get: vi.fn(async () => null) },
    popover: {
      setContentHeight: vi.fn(async () => ({ ok: true })),
      setContentSize: vi.fn(async () => ({ ok: true })),
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
      getUpdateStatus: vi.fn(async () => ({ currentVersion: "0.0.0", latestVersion: null, updateAvailable: false, releaseUrl: null })),
      openReleasePage: vi.fn(async () => ({ ok: true })),
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

  it("surfaces the real failure reason when a send rejects", async () => {
    installBabyMenuAgentMock();
    window.babyMenu!.agent.send = vi.fn(async () => {
      throw new Error(
        "Error invoking remote method 'baby-menu:agent:send': Error: AgentTurnFailedError: Codex CLI exited with code 127",
      );
    });
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "add a widget" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("Codex CLI exited with code 127")).toBeTruthy();
    expect(screen.queryByText("No changes were made")).toBeNull();
    expect(screen.queryByText("the agent did not edit anything")).toBeNull();
  });

  it("keeps partial failed changes reviewable alongside the failure reason", async () => {
    installBabyMenuAgentMock({
      session: {
        startedClean: true,
        canSave: true,
        canRollback: true,
        head: null,
        dirty: true,
        changes: [{ type: "extension", extensionId: "battery", kind: "updated" }],
      },
    });
    window.babyMenu!.agent.send = vi.fn(async () => {
      throw new Error("Codex authentication failed. Sign in and try again.");
    });
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "update the battery widget" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("Codex authentication failed. Sign in and try again.")).toBeTruthy();
    expect(screen.getByText("Updated the battery extension")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("labels the Keep prompt from the diff, not the agent prose (updated extension)", async () => {
    installBabyMenuAgentMock();
    // The agent claims it "added" something, but the diff says an existing
    // extension was updated. The label must follow the diff.
    window.babyMenu!.agent.send = vi.fn(async (): Promise<AgentChatResult> => ({
      assistantText: "Added a battery widget for you!",
      session: {
        startedClean: true,
        canSave: true,
        canRollback: true,
        head: null,
        dirty: true,
        changes: [{ type: "extension", extensionId: "battery", kind: "updated" }],
      },
    }));
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "make the battery widget bigger" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("Updated the battery extension")).toBeTruthy();
    expect(screen.queryByText(/Added/)).toBeNull();
    expect(screen.queryByTestId("agent-reply")).toBeNull();
  });

  it("labels a layout-only change as Updated the layout", async () => {
    installBabyMenuAgentMock();
    window.babyMenu!.agent.send = vi.fn(async (): Promise<AgentChatResult> => ({
      assistantText: "Done.",
      session: {
        startedClean: true,
        canSave: true,
        canRollback: true,
        head: null,
        dirty: true,
        changes: [{ type: "layout", kind: "updated" }],
      },
    }));
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "add a bit more margin between the two columns" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("Updated the layout")).toBeTruthy();
  });

  it("says no changes were made when the agent edited nothing and said nothing", async () => {
    installBabyMenuAgentMock();
    window.babyMenu!.agent.send = vi.fn(async (): Promise<AgentChatResult> => ({
      assistantText: "  \n ",
      session: { startedClean: true, canSave: true, canRollback: true, head: null, dirty: false, changes: [] },
    }));
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "add a bit more margin between the two columns" } });
    fireEvent.submit(composer.closest("form")!);

    expect(await screen.findByText("No changes were made")).toBeTruthy();
    expect(screen.getByText("the agent did not edit anything")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
  });

  it("shows the agent's full question when it replied without editing, and keeps the composer usable", async () => {
    installBabyMenuAgentMock();
    const question = [
      "Before I build the Cursor quota widget I need two answers:",
      "1. Should the widget show per-model usage, or one combined total for all models?",
      "2. Does \"grok bot\" mean a per-model split from Cursor, or the separate Grok credits recipe?",
    ].join("\n");
    const send = vi.fn(async (): Promise<AgentChatResult> => ({
      assistantText: `\n${question}\n`,
      session: { startedClean: true, canSave: true, canRollback: true, head: null, dirty: false, changes: [] },
    }));
    window.babyMenu!.agent.send = send;
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "add a cursor usage widget" } });
    fireEvent.submit(composer.closest("form")!);

    const reply = await screen.findByTestId("agent-reply");
    expect(reply.textContent).toBe(question);
    expect(screen.getByText("The agent replied")).toBeTruthy();
    expect(screen.queryByText("No changes were made")).toBeNull();
    expect(screen.queryByText("the agent did not edit anything")).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();

    // The user can answer in the same conversation right away.
    const followUp = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(followUp, { target: { value: "per-model, and drop grok" } });
    fireEvent.submit(followUp.closest("form")!);
    expect(send).toHaveBeenLastCalledWith("per-model, and drop grok");
  });

  it("shows a blocker explanation instead of hiding it behind the no-changes notice", async () => {
    installBabyMenuAgentMock();
    const blocker =
      "I can't build the widget yet. Cursor's usage API rejected the saved login (401 unauthenticated, ERROR_NOT_LOGGED_IN), " +
      "and the recipe forbids mock data. Sign in to Cursor again, then ask me to retry.";
    window.babyMenu!.agent.send = vi.fn(async (): Promise<AgentChatResult> => ({
      assistantText: blocker,
      session: { startedClean: true, canSave: true, canRollback: true, head: null, dirty: false, changes: [] },
    }));
    render(<AgentChat />);

    const composer = screen.getByPlaceholderText("talk to the baby");
    fireEvent.change(composer, { target: { value: "show the cursor usage" } });
    fireEvent.submit(composer.closest("form")!);

    expect((await screen.findByTestId("agent-reply")).textContent).toBe(blocker);
    expect(screen.queryByText("No changes were made")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("agent-reply")).toBeNull();
    expect(screen.getByPlaceholderText("talk to the baby")).toBeTruthy();
  });

  it("clears the session bar after Keep without a kept confirmation", async () => {
    installBabyMenuAgentMock({
      session: {
        startedClean: true,
        canSave: true,
        canRollback: true,
        head: null,
        message: "Review the generated changes, then Save or Rollback.",
      },
    });
    window.babyMenu!.git.save = vi.fn(async () => ({ ok: true }));
    render(<AgentChat />);

    const keep = await screen.findByRole("button", { name: "Keep" });
    await act(async () => {
      fireEvent.click(keep);
    });

    expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.queryByText(/Kept/)).toBeNull();
    expect(screen.getByPlaceholderText("talk to the baby")).toBeTruthy();
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
