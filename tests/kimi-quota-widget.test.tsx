// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { KimiQuotaResult, KimiQuotaSnapshot } from "../src/shared/contracts";
import { KimiQuotaContent } from "../extensions/kimi-code-quota/components";
import { kimiCodeQuotaWidget } from "../extensions/kimi-code-quota/widget";

const NOW = Date.parse("2026-07-19T12:00:00.000Z");

const snapshot: KimiQuotaSnapshot = {
  provider: "kimi",
  label: "Kimi",
  source: "api",
  credentialSource: "pi-kimi-coding",
  refreshedAt: "2026-07-19T11:57:00.000Z",
  windows: [
    { id: "weekly", label: "week", kind: "weekly", percentUsed: 61.25, percentRemaining: 38.75, resetsAt: "2026-07-21T12:00:00.000Z" },
    { id: "limit:3", label: "limit 3", kind: "unknown", percentUsed: 12, percentRemaining: 88, windowSeconds: 86_400 },
    { id: "five_hour", label: "session", kind: "session", percentUsed: 24.4, percentRemaining: 75.6, resetsAt: "2026-07-19T14:30:00.000Z", windowSeconds: 18_000 },
  ],
};

const fresh: KimiQuotaResult = {
  status: "fresh",
  stale: false,
  source: "api",
  credentialSource: "pi-kimi-coding",
  checkedAt: "2026-07-19T12:00:00.000Z",
  snapshot,
};

function renderState(result: KimiQuotaResult | null, refreshing = false) {
  return render(<KimiQuotaContent view={{ result, refreshing }} now={NOW} />);
}

afterEach(cleanup);

describe("Kimi Code quota widget", () => {
  it("renders five-hour, weekly, then other windows using remaining percentages", () => {
    renderState(fresh);

    const rows = screen.getAllByTestId("kimi-quota-window");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("5H")).toBeTruthy();
    expect(rows[0].textContent).toContain("76%");
    expect(within(rows[1]).getByText("7D")).toBeTruthy();
    expect(rows[1].textContent).toContain("39%");
    expect(within(rows[2]).getByText("LIMIT 3")).toBeTruthy();
    expect(rows[2].textContent).toContain("88%");
  });

  it("gives every progress indicator an accessible remaining-percentage equivalent", () => {
    renderState(fresh);

    expect(screen.getByRole("progressbar", { name: "5H 76% remaining" }).getAttribute("aria-valuenow")).toBe("75.6");
    expect(screen.getByRole("progressbar", { name: "7D 39% remaining" }).getAttribute("aria-valuenow")).toBe("38.75");
  });

  it("shows reset countdowns and a fresh source state", () => {
    renderState(fresh);

    expect(screen.getByText("fresh")).toBeTruthy();
    expect(screen.getByText("resets in 2h 30m")).toBeTruthy();
    expect(screen.getByText("resets in 2d")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
  });

  it("keeps last-good values visible while a refresh is in flight", () => {
    renderState(fresh, true);

    expect(screen.getByText("refreshing")).toBeTruthy();
    expect(screen.getAllByTestId("kimi-quota-window")[0]?.textContent).toContain("76%");
    expect(screen.getByLabelText("refreshing Kimi quota")).toBeTruthy();
  });

  it("marks stale data with last-success age and rate-limit context", () => {
    const stale: KimiQuotaResult = {
      status: "stale",
      stale: true,
      source: "cache",
      checkedAt: "2026-07-19T12:00:00.000Z",
      snapshot,
      retryAt: "2026-07-19T12:12:00.000Z",
      error: { code: "provider_rate_limited", category: "rate_limit", message: "Kimi quota is rate-limited" },
    };
    renderState(stale);

    expect(screen.getByText("rate limited · cached")).toBeTruthy();
    expect(document.body.textContent).toContain("last success 3m ago");
    expect(document.body.textContent).toContain("retry in 12m");
    expect(screen.getByText("CACHE")).toBeTruthy();
  });

  it.each([
    [
      { status: "rate_limited", stale: false, source: "api", checkedAt: "2026-07-19T12:00:00.000Z", retryAt: "2026-07-19T12:12:00.000Z", error: { code: "provider_rate_limited", category: "rate_limit", message: "Kimi quota is rate-limited" } },
      "rate limited",
      "retry in 12m",
    ],
    [
      { status: "auth_required", stale: false, source: "api", checkedAt: "2026-07-19T12:00:00.000Z", error: { code: "kimi_credential_unavailable", category: "credential", message: "Kimi credential is unavailable" } },
      "credential needed",
      "sign in with Pi or Kimi CLI",
    ],
    [
      { status: "auth_required", stale: false, source: "api", credentialSource: "pi-kimi-coding", checkedAt: "2026-07-19T12:00:00.000Z", error: { code: "provider_auth_rejected", category: "credential", message: "Kimi rejected the credential" } },
      "credential rejected",
      "check kimi-coding in Pi",
    ],
    [
      { status: "auth_required", stale: false, source: "api", credentialSource: "kimi-code-cli", checkedAt: "2026-07-19T12:00:00.000Z", error: { code: "provider_auth_rejected", category: "credential", message: "Kimi rejected the credential" } },
      "credential rejected",
      "sign in again with Kimi CLI",
    ],
    [
      { status: "error", stale: false, source: "api", checkedAt: "2026-07-19T12:00:00.000Z", error: { code: "provider_unavailable", category: "service", message: "Kimi quota service is unavailable" } },
      "service unavailable",
      "Kimi quota could not refresh",
    ],
    [
      { status: "error", stale: false, source: "api", checkedAt: "2026-07-19T12:00:00.000Z", error: { code: "network_unavailable", category: "transport", message: "Kimi quota network is unavailable" } },
      "network unavailable",
      "Kimi quota could not refresh",
    ],
    [
      { status: "error", stale: false, source: "api", checkedAt: "2026-07-19T12:00:00.000Z", error: { code: "schema_invalid", category: "parser", message: "Kimi quota response is unsupported" } },
      "response changed",
      "Kimi quota could not refresh",
    ],
  ] as const)("renders a distinct %s failure state", (result, title, detail) => {
    renderState(result as KimiQuotaResult);
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(detail)).toBeTruthy();
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("does not fabricate an absent five-hour window", () => {
    renderState({ ...fresh, snapshot: { ...snapshot, windows: snapshot.windows.filter((window) => window.id === "weekly") } });

    expect(screen.queryByText("5H")).toBeNull();
    expect(screen.getAllByTestId("kimi-quota-window")).toHaveLength(1);
    expect(screen.queryByText("0%" )).toBeNull();
  });

  it("renders an unambiguous initial loading state", () => {
    renderState(null, true);

    expect(screen.getByText("checking quota")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("checking Kimi quota");
  });

  it("declares host-owned open refresh without a renderer interval", () => {
    expect(kimiCodeQuotaWidget.refreshView).toBeTypeOf("function");
    expect(kimiCodeQuotaWidget.viewRefreshIntervalMs).toBeUndefined();
  });
});
