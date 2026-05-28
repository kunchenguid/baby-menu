/* global React */
const { useState, useEffect } = React;

// ─── Widget shell ─────────────────────────────────────────────────
// All widgets are dashed-divided rows in the popover body. Tracked-
// caps key on top, hero value, optional 1px signal progress, foot
// row with timestamp + source tag.
function Widget({ keyLabel, value, unit, status, progress, foot, source, onRefresh, children }) {
  return (
    <article className="widget">
      <div className="w-head">
        <span className="key">{keyLabel}</span>
        {onRefresh && (
          <button type="button" className="refresh" onClick={onRefresh} title="refresh" aria-label="refresh">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
          </button>
        )}
      </div>
      {children ? (
        children
      ) : (
        <>
          <div className="value-row">
            <span className="value">
              {value}{unit && <small>{unit}</small>}
            </span>
            {status && (
              <span className={"status" + (status.kind ? " " + status.kind : "")}>{status.label}</span>
            )}
          </div>
          {typeof progress === "number" && (
            <div className="progress">
              <div className="fill" style={{ width: progress + "%" }}></div>
            </div>
          )}
          <div className="foot">
            <span>{foot}</span>
            {source && <span className="src">{source}</span>}
          </div>
        </>
      )}
    </article>
  );
}

// ─── Sample widgets ──────────────────────────────────────────────
function MockQuotaWidget() {
  const samples = [72, 68, 54, 81, 47];
  const [i, setI] = useState(0);
  const [stamp, setStamp] = useState(() => stampNow());
  const value = samples[i];
  function refresh() {
    setI((n) => (n + 1) % samples.length);
    setStamp(stampNow());
  }
  return (
    <Widget
      keyLabel="claude · weekly"
      value={value}
      unit="%"
      progress={value}
      foot={"last sync " + stamp}
      source="oauth"
      onRefresh={refresh}
    />
  );
}

function BatteryWidget() {
  const [pct, setPct] = useState(78);
  function refresh() {
    setPct((n) => Math.max(10, Math.min(99, n + (Math.random() > 0.5 ? 3 : -5))));
  }
  return (
    <Widget
      keyLabel="battery"
      value={pct}
      unit="%"
      progress={pct}
      status={{ kind: "", label: "charging" }}
      foot="1h 12m to full"
      source="iokit"
      onRefresh={refresh}
    />
  );
}

function NowPlayingWidget() {
  return (
    <Widget keyLabel="now playing">
      <div className="np">
        <div>
          <div className="t">A small, warm room</div>
          <div className="a">paper sleeve</div>
        </div>
        <div className="time">2:14 / 4:08</div>
      </div>
      <div className="progress"><div className="fill" style={{ width: "55%" }}></div></div>
      <div className="foot">
        <span>spotify</span>
        <span className="src">macos</span>
      </div>
    </Widget>
  );
}

function stampNow() {
  const d = new Date();
  return d
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: false });
}

// ─── WidgetHost ───────────────────────────────────────────────────
function WidgetHost({ widgets }) {
  if (widgets.length === 0) {
    return (
      <div className="empty">
        <span className="top">› no widgets</span>
        <p>ask the agent to add one.</p>
        <span className="ex">
          try: <strong>show my battery</strong> · <strong>cpu temp</strong> · <strong>remind me to drink water</strong>
        </span>
      </div>
    );
  }
  return (
    <div className="widget-host">
      {widgets.map((w) => React.cloneElement(w.render(), { key: w.id }))}
    </div>
  );
}

const DEFAULT_WIDGETS = [
  { id: "mock-quota-status", render: () => <MockQuotaWidget /> },
  { id: "battery",           render: () => <BatteryWidget /> },
  { id: "now-playing",       render: () => <NowPlayingWidget /> },
];

Object.assign(window, {
  Widget,
  WidgetHost,
  MockQuotaWidget,
  BatteryWidget,
  NowPlayingWidget,
  DEFAULT_WIDGETS,
});
