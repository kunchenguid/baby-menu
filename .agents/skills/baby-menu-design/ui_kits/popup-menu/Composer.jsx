/* global React */
const { useState, useRef, useEffect } = React;

// ─── Composer ─────────────────────────────────────────────────────
// Slim bar pinned on the main idle surface. Auto-grows to a second line
// as the user keeps typing, but never reserves extra vertical space ahead
// of time. Submitting fires a single Run, which temporarily replaces it.
function Composer({ running, onSend }) {
  const [draft, setDraft] = useState("");
  const ref = useRef(null);

  // Auto-resize: clip to scrollHeight, capped at 4 rows of text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!draft) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 96) + "px";
  }, [draft]);

  function submit(e) {
    if (e) e.preventDefault();
    const text = draft.trim();
    if (!text || running) return;
    onSend(text);
    setDraft("");
  }
  function onKey(e) {
    // Enter sends. Shift+Enter inserts newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const hasText = draft.length > 0;

  return (
    <div className="composer-wrap">
      <form
        className={
          "composer" +
          (hasText ? " has-text" : " empty") +
          (running ? " running" : "")
        }
        onSubmit={submit}
      >
        <span className="prompt">›</span>
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={running ? "agent working" : "ask the agent"}
          rows={1}
          disabled={running}
        />
        <button
          type="submit"
          className="send"
          aria-disabled={running || !hasText ? "true" : "false"}
          disabled={running || !hasText}
        >
          send
        </button>
      </form>
    </div>
  );
}

window.Composer = Composer;
