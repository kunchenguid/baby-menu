import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "../../ui";
import { useAgentRuntime, type AgentRun, type AgentSessionNotice } from "./useAgentRuntime";

export function AgentChat() {
  const { run, session, pendingChange, notice, assistantReply, send, keep, undo, dismissNotice } = useAgentRuntime();

  if (run) return <RunStrip run={run} />;

  return (
    <>
      <AssistantReply text={assistantReply} />
      <SessionBar session={session} onKeep={keep} onUndo={undo} onDismiss={dismissNotice} />
      {notice && pendingChange ? (
        <SessionBar session={pendingChange} onKeep={keep} onUndo={undo} onDismiss={dismissNotice} />
      ) : null}
      <Composer onSend={send} />
    </>
  );
}

function AssistantReply({ text }: { text: string | null }) {
  if (!text) return null;

  return (
    <section className="assistant-reply" role="status" aria-label="MANA response">
      <div className="assistant-reply-label">MANA</div>
      <div className="assistant-reply-body"><AssistantBlocks text={text} /></div>
    </section>
  );
}

function AssistantBlocks({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = assistantHeading(line);
    if (heading) {
      blocks.push(<h3 key={`heading-${index}`}>{heading}</h3>);
      index += 1;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)/);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^[-*]\s+(.+)/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(<ul key={`list-${index}`}>{items.map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}</ul>);
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)/);
    if (numbered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].trim().match(/^\d+[.)]\s+(.+)/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push(<ol key={`steps-${index}`}>{items.map((item, itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (!candidate || assistantHeading(candidate) || /^[-*]\s+/.test(candidate) || /^\d+[.)]\s+/.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`}>{paragraph.join(" ")}</p>);
  }

  return <>{blocks}</>;
}

function assistantHeading(line: string): string | null {
  const markdown = line.match(/^#{1,3}\s+(.+)$/)?.[1];
  const emphasized = line.match(/^\*\*(.+?)\*\*:?$/)?.[1];
  const candidate = (markdown ?? emphasized ?? line).replace(/:$/, "").trim();
  if (markdown || emphasized) return candidate;
  return /^(?:outcome|result|status|what (?:changed|i changed|i found|i learned|i verified|happens next)|why it matters|verification|verified|next)$/i.test(candidate)
    ? candidate
    : null;
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
          placeholder="ask MANA anything"
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
