import React from "react";
import { createRoot } from "react-dom/client";
import "/Users/kunchen/.no-mistakes/worktrees/dfc47b02954f/01KY0WJ5RPD12HC0CA2G4N1DHK/src/ui/styles.css";
import { KimiQuotaContent } from "/Users/kunchen/.no-mistakes/worktrees/dfc47b02954f/01KY0WJ5RPD12HC0CA2G4N1DHK/extensions/kimi-code-quota/components";
import type { KimiQuotaResult, KimiQuotaSnapshot } from "/Users/kunchen/.no-mistakes/worktrees/dfc47b02954f/01KY0WJ5RPD12HC0CA2G4N1DHK/src/shared/contracts";

const NOW = Date.parse("2026-07-20T23:15:00.000Z");
const snapshot: KimiQuotaSnapshot = {
  provider: "kimi",
  label: "Kimi",
  source: "api",
  refreshedAt: "2026-07-20T23:12:00.000Z",
  windows: [
    { id: "weekly", label: "week", kind: "weekly", percentUsed: 61.25, percentRemaining: 38.75, resetsAt: "2026-07-23T12:00:00.000Z" },
    { id: "five_hour", label: "session", kind: "session", percentUsed: 24.4, percentRemaining: 75.6, resetsAt: "2026-07-21T01:45:00.000Z", windowSeconds: 18_000 },
  ],
};

const fresh: KimiQuotaResult = {
  status: "fresh",
  stale: false,
  source: "api",
  checkedAt: "2026-07-20T23:15:00.000Z",
  snapshot,
};

const cases: Array<{ label: string; result: KimiQuotaResult | null; refreshing?: boolean }> = [
  { label: "loading", result: null, refreshing: true },
  { label: "fresh", result: fresh },
  { label: "refreshing with last-good", result: fresh, refreshing: true },
  {
    label: "stale and rate-limited",
    result: {
      status: "stale", stale: true, source: "cache", checkedAt: "2026-07-20T23:15:00.000Z", snapshot,
      retryAt: "2026-07-20T23:27:00.000Z",
      error: { code: "provider_rate_limited", category: "rate_limit", message: "Kimi quota is rate-limited" },
    },
  },
  {
    label: "credential missing",
    result: { status: "auth_required", stale: false, source: "api", checkedAt: "2026-07-20T23:15:00.000Z", error: { code: "kimi_credential_unavailable", category: "credential", message: "Kimi credential is unavailable" } },
  },
  {
    label: "credential rejected",
    result: { status: "auth_required", stale: false, source: "api", checkedAt: "2026-07-20T23:15:00.000Z", error: { code: "provider_auth_rejected", category: "credential", message: "Kimi rejected the credential" } },
  },
  {
    label: "service unavailable",
    result: { status: "error", stale: false, source: "api", checkedAt: "2026-07-20T23:15:00.000Z", error: { code: "provider_unavailable", category: "service", message: "Kimi quota service is unavailable" } },
  },
  {
    label: "transport failure",
    result: { status: "error", stale: false, source: "api", checkedAt: "2026-07-20T23:15:00.000Z", error: { code: "network_unavailable", category: "transport", message: "Kimi quota network is unavailable" } },
  },
  {
    label: "parser failure",
    result: { status: "error", stale: false, source: "api", checkedAt: "2026-07-20T23:15:00.000Z", error: { code: "schema_invalid", category: "parser", message: "Kimi quota response is unsupported" } },
  },
];

function Gallery() {
  return (
    <main className="gallery-main font-mono text-ink">
      <header className="gallery-header">
        <div className="gallery-kicker">Baby Menu · Kimi Code</div>
        <h1 className="gallery-title">production component state gallery</h1>
        <p className="gallery-copy">The exact shipped widget component and shared UI kit, rendered at the 504px popover width.</p>
      </header>
      <section className="gallery-grid">
        {cases.map((item) => (
          <article key={item.label} className="min-w-0 overflow-hidden rounded-xl border border-line bg-stage shadow-[0_24px_80px_rgba(0,0,0,0.65)]">
            <div className="border-b border-line px-4 py-3 text-xxs uppercase tracking-caps text-ink-label">{item.label}</div>
            <div className="min-h-[172px] p-4">
              <KimiQuotaContent view={{ result: item.result, refreshing: Boolean(item.refreshing) }} now={NOW} />
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Gallery />);
