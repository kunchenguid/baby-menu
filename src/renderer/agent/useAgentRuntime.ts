import { useCallback, useEffect, useState } from "react";
import type { GitSessionSnapshot, WorkspaceChange, WorkspaceChangeKind } from "../../shared/contracts";

const unavailableText = "open baby_menu from the tray to talk to the agent";

export type AgentRun = {
  id: string;
  title: string;
  startedAt: number;
  statusText?: string;
  // True when this run strip was restored from the main process (a turn that is
  // still running but whose original send() promise lives in an unmounted
  // instance). Recovered runs are polled until the turn ends.
  recovered?: boolean;
};

export type AgentSessionNotice =
  | {
      kind: "pending";
      summary: string;
      hint: string;
      canKeep: boolean;
      canUndo: boolean;
    }
  | {
      kind: "blocked" | "saved" | "error";
      summary: string;
      hint?: string;
    };

export function useAgentRuntime() {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [pendingChange, setPendingChange] = useState<AgentSessionNotice | null>(null);
  const [notice, setNotice] = useState<AgentSessionNotice | null>(null);

  useEffect(() => {
    return window.babyMenu?.agent.onStatus((status) => {
      setRun((current) => (current ? { ...current, statusText: status.text } : current));
    });
  }, []);

  // Reconcile renderer state from the main process. The run strip and the
  // Keep/Rollback prompt are otherwise ephemeral renderer state, so remounting the
  // popover view (returning from Settings, or an HMR/window reload) would drop a
  // turn that is still running or a change session that is still open. Main is the
  // source of truth: if a turn is running, restore the run strip; once it finishes,
  // surface the pending prompt. This is why the prompt no longer appears mid-build.
  const reconcile = useCallback(async () => {
    const api = window.babyMenu;
    if (!api) return;

    const turn = await api.agent.getActiveTurn();
    if (turn) {
      // Do not clobber a live run this instance is already driving via send().
      setRun((current) =>
        current && !current.recovered
          ? current
          : {
              id: current?.id ?? crypto.randomUUID(),
              title: turn.title,
              startedAt: turn.startedAt,
              statusText: current?.statusText ?? "Working...",
              recovered: true,
            },
      );
      return;
    }

    setRun((current) => (current?.recovered ? null : current));
    const snapshot = await api.git.status();
    if (snapshot) {
      const notice = sessionNoticeForSnapshot(snapshot);
      if (notice) setPendingChange(notice);
    }
  }, []);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  // While a restored run strip is showing (a turn whose send() promise is not in
  // this instance), poll until the turn ends so the prompt flips in at the right
  // time. Live sends resolve their own promise and never set `recovered`.
  useEffect(() => {
    if (!run?.recovered) return undefined;
    const timer = window.setInterval(() => void reconcile(), 1000);
    return () => window.clearInterval(timer);
  }, [run?.recovered, reconcile]);

  async function send(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || run) return;

    if (pendingChange?.kind === "pending") {
      setNotice({
        kind: "blocked",
        summary: "Finish this change first",
        hint: "keep or undo before asking again",
      });
      return;
    }

    const startedAt = Date.now();
    setNotice(null);
    setRun({
      id: crypto.randomUUID(),
      title: trimmed,
      startedAt,
      statusText: "Working...",
    });

    try {
      if (!window.babyMenu) throw new Error(unavailableText);
      const result = await window.babyMenu.agent.send(trimmed);
      const nextChange = sessionNoticeForResult(result.session);
      setPendingChange(nextChange.kind === "pending" ? nextChange : null);
      setNotice(nextChange.kind === "pending" ? null : nextChange);
    } catch (error) {
      setPendingChange(null);
      setNotice({
        kind: "error",
        summary: "Agent unavailable",
        hint: failureReason(error) ?? unavailableText,
      });
    } finally {
      setRun(null);
    }
  }

  async function keep() {
    if (!window.babyMenu || pendingChange?.kind !== "pending") return;

    const result = await window.babyMenu.git.save();
    if (!result.ok) {
      setNotice({ kind: "error", summary: "Could not keep this change" });
      return;
    }

    // Keep is the happy path: clear the bar and return to the composer. A
    // separate "kept" confirmation with its own Dismiss button is just noise.
    setPendingChange(null);
    setNotice(null);
  }

  async function undo() {
    if (!window.babyMenu || pendingChange?.kind !== "pending") return;

    const result = await window.babyMenu.git.rollback();
    if (!result.ok) {
      setNotice({ kind: "error", summary: "Could not undo this change" });
      return;
    }

    setPendingChange(null);
    setNotice({ kind: "saved", summary: "Undone" });
  }

  function dismissNotice() {
    setNotice(null);
  }

  return {
    run,
    session: notice ?? pendingChange,
    send,
    keep,
    undo,
    dismissNotice,
  };
}

function sessionNoticeForResult(snapshot: GitSessionSnapshot | undefined): AgentSessionNotice {
  // The agent reported back without touching any file. Say so plainly instead of
  // claiming a change and offering a Keep button with nothing behind it.
  if (snapshot && snapshot.dirty === false) {
    return { kind: "blocked", summary: "No changes were made", hint: "the agent did not edit anything" };
  }

  if (snapshot?.canSave || snapshot?.canRollback) {
    return {
      kind: "pending",
      summary: summarizeChanges(snapshot.changes) ?? "Review the changes",
      hint: "keep it, or undo",
      canKeep: snapshot.canSave,
      canUndo: snapshot.canRollback,
    };
  }

  return {
    kind: "blocked",
    summary: "Finish this change first",
    hint: "keep or undo before asking again",
  };
}

// Builds a pending notice from a re-hydrated session snapshot after a reload.
// The summary is derived from the diff, the same as the live result. Returns
// null when the session can no longer be saved/rolled back or made no change.
function sessionNoticeForSnapshot(snapshot: GitSessionSnapshot): AgentSessionNotice | null {
  if (!snapshot.canSave && !snapshot.canRollback) return null;
  if (snapshot.dirty === false) return null;
  return {
    kind: "pending",
    summary: summarizeChanges(snapshot.changes) ?? snapshot.message?.trim() ?? "Unsaved agent changes",
    hint: "keep it, or undo",
    canKeep: snapshot.canSave,
    canUndo: snapshot.canRollback,
  };
}

// Turns the diff-derived change list into a short, honest label for the
// Keep/Rollback bar. Extension changes lead (a created/updated extension is the
// headline); the root layout is described only when nothing else changed.
// Returns null when there is nothing attributable to name.
function summarizeChanges(changes: WorkspaceChange[] | undefined): string | null {
  if (!changes || changes.length === 0) return null;

  const extensions = changes.filter(
    (change): change is Extract<WorkspaceChange, { type: "extension" }> => change.type === "extension",
  );

  if (extensions.length === 1) {
    return `${verbFor(extensions[0].kind)} the ${extensions[0].extensionId} extension`;
  }
  if (extensions.length > 1) {
    const kinds = new Set(extensions.map((change) => change.kind));
    const verb = kinds.size === 1 ? verbFor(extensions[0].kind) : "Changed";
    return `${verb} ${extensions.length} extensions`;
  }

  const layout = changes.find((change) => change.type === "layout");
  if (layout) return `${verbFor(layout.kind)} the layout`;

  return null;
}

function verbFor(kind: WorkspaceChangeKind): string {
  if (kind === "created") return "Added";
  if (kind === "removed") return "Removed";
  return "Updated";
}

// Surfaces the real reason a send failed instead of a blanket "unavailable".
// Electron wraps IPC rejections as "Error invoking remote method '...': Error: <real>",
// so we keep only the trailing message the main process actually threw.
function failureReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const message = error.message.replace(/^Error invoking remote method '[^']*':\s*/, "").replace(/^Error:\s*/, "").trim();
  return message || null;
}

