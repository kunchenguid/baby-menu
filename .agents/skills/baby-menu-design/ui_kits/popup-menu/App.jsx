/* global React, ReactDOM, MenuBar, Composer, RunStrip, SessionBar, WidgetHost, DEFAULT_WIDGETS, Widget */
const { useState, useEffect, useRef } = React;

// ─── App ──────────────────────────────────────────────────────────
// Top-level shell. Owns popover open/closed, widgets, the active
// Run, and the change session (renamed internally — the user never
// sees git). No more mode toggle: the composer stays on the main agent surface.
function App() {
  const [open, setOpen] = useState(true);
  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS);
  const [run, setRun] = useState(null);
  const [session, setSession] = useState(null);

  function send(prompt) {
    if (session && session.kind === "pending") {
      setSession({ kind: "refused" });
      return;
    }

    const id = Date.now();
    const title = inferTitle(prompt);
    const steps = inferSteps(prompt);
    setRun({ id, title, steps, activeIndex: 0, startedAt: Date.now(), done: false });

    let i = 0;
    function advance() {
      if (i >= steps.length) {
        setRun((r) => r ? { ...r, done: true, activeIndex: steps.length } : r);
        setSession({
          kind: "pending",
          summary: summarizeFor(prompt),
          // we stash a "build hint" for use when the user keeps it
          buildHint: buildHintFor(prompt),
        });
        setTimeout(() => setRun(null), 350);
        return;
      }
      const dur = 0.5 + Math.random() * 0.7;
      const myI = i;
      setRun((r) => r ? { ...r, activeIndex: myI } : r);
      i++;
      setTimeout(advance, dur * 1000);
    }
    setTimeout(advance, 250);
  }

  function save() {
    // Build the widget the agent "added" and slot it in.
    const hint = (session && session.buildHint) || { keyLabel: "new widget", value: 0, unit: "" };
    const summary = (session && session.summary) || "Kept";

    setWidgets((ws) => ws.length >= 6 ? ws : ws.concat([
      { id: "new-" + Date.now(), render: () => (
        <Widget
          keyLabel={hint.keyLabel}
          value={hint.value}
          unit={hint.unit}
          progress={typeof hint.value === "number" ? hint.value : undefined}
          foot="last sync just now"
          source="mock"
        />
      )},
    ]));

    setSession({ kind: "saved", summary: "Kept · " + summary.replace(/^Added /, "") });
    // auto-dismiss after a moment
    setTimeout(() => setSession((s) => s && s.kind === "saved" ? null : s), 2200);
  }
  function rollback() {
    setSession({ kind: "saved", summary: "Undone" });
    setTimeout(() => setSession((s) => s && s.kind === "saved" ? null : s), 1600);
  }
  function dismissSession() {
    setSession(null);
  }

  return (
    <div className="desktop">
      <MenuBar open={open} onToggle={() => setOpen((v) => !v)} />
      <div className="wallpaper-hint">› click the tray icon (top-right) to toggle the popover</div>

      <div className={"popover-positioner" + (open ? " shown" : "")}>
        <div className="popover">
          <div className="pop-head">
            <span className="mark">baby<span className="sep">_</span>menu</span>
          </div>

          <div className="pop-body">
            <WidgetHost widgets={widgets} />
          </div>

          {run ? (
            <RunStrip run={run} />
          ) : (
            <>
              <SessionBar
                session={session}
                onSave={save}
                onRollback={rollback}
                onDismiss={dismissSession}
              />

              <Composer running={false} onSend={send} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Mock content helpers ────────────────────────────────────────
// These shape the "what did the agent do" copy. In production the
// agent itself supplies this summary. We never expose files, commits
// or the word "git" through this surface.

function inferTitle(prompt) {
  const t = prompt.toLowerCase();
  if (t.includes("cpu"))      return "adding a CPU temperature widget";
  if (t.includes("battery"))  return "adding a battery widget";
  if (t.includes("weather"))  return "adding a weather widget";
  if (t.includes("calendar")) return "adding a calendar widget";
  if (t.includes("memory") || t.includes("ram")) return "adding a memory widget";
  return prompt.length > 40 ? prompt.slice(0, 38).toLowerCase() + "…" : prompt.toLowerCase();
}

function inferSteps(prompt) {
  return [
    { label: "reading your menu setup" },
    { label: "designing the widget" },
    { label: "wiring it into your menu" },
    { label: "trying it once" },
  ];
}

function summarizeFor(prompt) {
  const t = prompt.toLowerCase();
  if (t.includes("cpu"))      return "Added a CPU temperature widget";
  if (t.includes("battery"))  return "Added a battery widget";
  if (t.includes("weather"))  return "Added a weather widget";
  if (t.includes("calendar")) return "Added a calendar widget";
  if (t.includes("memory") || t.includes("ram")) return "Added a memory widget";
  return "Added a new widget";
}

function buildHintFor(prompt) {
  const t = prompt.toLowerCase();
  if (t.includes("cpu"))      return { keyLabel: "cpu · temp",    value: 62, unit: "°c" };
  if (t.includes("battery"))  return { keyLabel: "battery",        value: 76, unit: "%" };
  if (t.includes("weather"))  return { keyLabel: "weather · sf",  value: 64, unit: "°f" };
  if (t.includes("memory") || t.includes("ram"))
                              return { keyLabel: "memory · used", value: 42, unit: "%" };
  return { keyLabel: "new widget", value: 50, unit: "" };
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
