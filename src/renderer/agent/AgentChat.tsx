import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import { useAgentRuntime, type AgentRun, type AgentSessionNotice } from "./useAgentRuntime";

export function AgentChat() {
  const { run, session, pendingChange, notice, send, keep, undo, dismissNotice } = useAgentRuntime();

  if (run) return <RunStrip run={run} />;

  return (
    <>
      <SessionBar session={session} onKeep={keep} onUndo={undo} onDismiss={dismissNotice} />
      {notice && pendingChange ? (
        <SessionBar session={pendingChange} onKeep={keep} onUndo={undo} onDismiss={dismissNotice} />
      ) : null}
      <Composer onSend={send} />
    </>
  );
}

function Composer({ onSend }: { onSend: (prompt: string) => void | Promise<void> }) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!draft) {
      textarea.style.height = "";
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 96)}px`;
  }, [draft]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setDraft("");
    void onSend(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    submit();
  }

  const hasText = draft.length > 0;

  return (
    <div className="composer-wrap">
      <form className={`composer${hasText ? " has-text" : " empty"}`} onSubmit={submit}>
        <span className="prompt">›</span>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="talk to the baby"
          rows={1}
        />
        <button
          type="submit"
          className="send"
          aria-disabled={!hasText ? "true" : "false"}
          disabled={!hasText}
        >
          send
        </button>
      </form>
    </div>
  );
}

function RunStrip({ run }: { run: AgentRun }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - run.startedAt) / 1000);
    }, 100);

    return () => window.clearInterval(timer);
  }, [run.id, run.startedAt]);

  return (
    <div className="runstrip">
      <span className="dot" />
      <div className="lines">
        <span className="task">› {run.title}</span>
        {run.statusText ? (
          <span className="step" key={run.statusText}>
            {run.statusText}
          </span>
        ) : null}
      </div>
      <span className="timer">{elapsed.toFixed(1)}s</span>
    </div>
  );
}

function SessionBar({
  session,
  onKeep,
  onUndo,
  onDismiss,
}: {
  session: AgentSessionNotice | null;
  onKeep: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  if (!session) return null;

  if (session.kind === "pending") {
    return (
      <div className="sessionbar pending">
        <span className="sb-dot" />
        <div className="sb-msg">
          {session.summary}
          <span className="sb-hint">{session.hint}</span>
        </div>
        <Button variant="primary" size="sm" disabled={!session.canKeep} onClick={() => void onKeep()}>
          Keep
        </Button>
        <Button variant="danger" size="sm" disabled={!session.canUndo} onClick={() => void onUndo()}>
          Undo
        </Button>
      </div>
    );
  }

  return (
    <div className={`sessionbar ${session.kind}`}>
      <span className="sb-dot" />
      <div className="sb-msg">
        {session.summary}
        {session.hint ? <span className="sb-hint">{session.hint}</span> : null}
      </div>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
      <span />
    </div>
  );
}
