// @vitest-environment jsdom
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { captureGrokAuthIntegrity, grokAuthIntegrityEqual } from "../scripts/grok-auth-integrity.mjs";
import {
  grokPopoverObservationExpression,
  observeGrokPopover,
  type GrokPopoverObservation,
} from "../scripts/grok-popover-observability.mjs";
import { refreshLifecycleStatus } from "../scripts/grok-popover-lifecycle.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(testDir, "../scripts/e2e-grok-popover.mjs");
const docsPath = join(testDir, "../docs/grok-quota-e2e.md");
const widgetFixturePath = join(testDir, "./fixtures/grok-quota-generated/widget.tsx.fixture");
const packagePath = join(testDir, "../package.json");

/** Sanitized exact-source shape from merged dotfiles-private PR 48 (head 73babe6 / merge d2f49b3)
 *  components.tsx root attributes only. Values are synthetic; no private content. */
function installedPr48RootHtml(options: {
  state?: "waiting" | "success" | "failure";
  completed?: number;
  refreshing?: boolean;
  failureKind?: string;
} = {}): string {
  const state = options.state ?? "success";
  const completed = options.completed ?? (state === "waiting" ? 0 : 1);
  const refreshing = options.refreshing ?? false;
  const checkedAt = state === "waiting" ? "" : "2026-07-14T20:00:00.000Z";
  const failureKind = state === "failure" ? (options.failureKind ?? "connectivity") : "";
  const successAttrs = state === "success"
    ? `
      data-cache-schema="2"
      data-grok-cache-schema="2"
      data-stale="false"
      data-warning-kind="none"
      data-failure-kind=""
      data-operation="grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig"
      data-source="grok-credits-grpc-web"
      data-source-version="1"
      data-period="weekly"
      data-percent-used="22"
      data-percent-remaining="78"
      data-percentage-field="config.creditUsagePercent"
      data-products='[{"id":"product:grok-build","percentUsed":14}]'
      data-reset-at="2026-07-21T20:00:00.000Z"
      data-reset-field="config.currentPeriod.end"
      data-grok-operation="grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig"
      data-grok-source="grok-credits-grpc-web"
      data-grok-source-version="1"
      data-grok-period="weekly"
      data-grok-percent-used="22"
      data-grok-percent-remaining="78"
      data-grok-percentage-field="config.creditUsagePercent"
      data-grok-products='[{"id":"product:grok-build","percentUsed":14}]'
      data-grok-reset-at="2026-07-21T20:00:00.000Z"
      data-grok-reset-field="config.currentPeriod.end"
    `
    : state === "failure"
      ? `
      data-cache-schema=""
      data-stale="false"
      data-warning-kind="none"
      data-failure-kind="${failureKind}"
      data-operation=""
      data-source=""
      data-source-version=""
    `
      : `
      data-stale="false"
      data-warning-kind="none"
      data-failure-kind=""
    `;

  return `
    <section aria-label="menu widgets">
      <div
        data-grok-quota-root="true"
        data-grok-e2e="${state}"
        data-grok-result-code="${state === "success" ? "ok" : state}"
        data-grok-refreshing="${String(refreshing)}"
        data-grok-completed-refreshes="${completed}"
        data-checked-at="${checkedAt}"
        data-grok-checked-at="${checkedAt}"
        ${successAttrs}
      >
        <p>${state === "success" ? "22% used 78% left" : state === "failure" ? "unavailable" : "pending"}</p>
        <p>checked ${completed}</p>
        <button type="button"${refreshing ? " disabled" : ""}>${refreshing ? "checking" : "refresh"}</button>
      </div>
    </section>
  `;
}

function completeRootAttributes(state: "waiting" | "success" | "failure", overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    "data-grok-e2e": state,
    "data-grok-checked-at": state === "waiting" ? "" : "2026-07-14T20:00:00.000Z",
    "data-grok-stale": "false",
    "data-grok-warning-kind": "none",
    "data-grok-failure-kind": state === "failure" ? "connectivity" : "none",
    "data-grok-cache-schema": state === "success" ? "2" : "",
    "data-grok-source": state === "success" ? "grok-credits-grpc-web" : "",
    "data-grok-source-version": state === "success" ? "1" : "",
    "data-grok-operation": state === "success" ? "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig" : "",
    "data-grok-period": state === "success" ? "weekly" : "",
    "data-grok-percent-used": state === "success" ? "22" : "",
    "data-grok-percent-remaining": state === "success" ? "78" : "",
    "data-grok-percentage-field": state === "success" ? "config.creditUsagePercent" : "",
    "data-grok-reset-at": state === "success" ? "2026-07-21T20:00:00.000Z" : "",
    "data-grok-reset-field": state === "success" ? "config.currentPeriod.end" : "",
    "data-grok-products": state === "success" ? '[{"id":"product:grok-build","percentUsed":14}]' : "[]",
    "data-grok-completed-acquisitions": state === "waiting" ? "0" : "1",
    ...overrides,
  };
  return Object.entries(base).map(([name, value]) => `${name}="${value.replaceAll('"', "&quot;")}"`).join(" ");
}

function observeHtml(html: string): GrokPopoverObservation | null {
  document.body.innerHTML = html;
  return observeGrokPopover(document);
}

function observeExpression(html: string): GrokPopoverObservation | null {
  document.body.innerHTML = html;
  return (0, eval)(grokPopoverObservationExpression()) as GrokPopoverObservation | null;
}

/** Mirrors the generated fixture's complete-root attribute bindings for one view state. */
function renderGeneratedRootHtml(kind: "waiting" | "success" | "failure", view: {
  completedRefreshes: number;
  result?: {
    checkedAt: string;
    ok: boolean;
    failure?: { kind: string; message: string };
    data?: {
      schemaVersion: number;
      source: string;
      sourceVersion: number;
      operation: string;
      period: { type: string };
      stale: boolean;
      windows: Array<{
        id: string;
        percentUsed: number;
        percentRemaining?: number;
        resetAt?: string;
        provenance: { percentageField: string; resetField?: string };
      }>;
      warning?: { kind: string };
    };
  } | null;
}): string {
  if (kind === "waiting" || !view.result) {
    return `<div ${completeRootAttributes("waiting", {
      "data-grok-completed-acquisitions": String(view.completedRefreshes),
    })}>checked ${view.completedRefreshes}</div>`;
  }
  if (!view.result.ok || kind === "failure") {
    return `<div ${completeRootAttributes("failure", {
      "data-grok-checked-at": view.result.checkedAt,
      "data-grok-failure-kind": view.result.failure?.kind ?? "unknown",
      "data-grok-completed-acquisitions": String(view.completedRefreshes),
    })}>checked ${view.completedRefreshes}</div>`;
  }
  const data = view.result.data!;
  const primary = data.windows.find((window) => window.id === "credits") ?? data.windows[0];
  const remaining = primary?.percentRemaining ?? (primary ? Math.max(0, 100 - primary.percentUsed) : undefined);
  const products = data.windows
    .filter((window) => window.id.startsWith("product:"))
    .map((window) => ({ id: window.id, percentUsed: window.percentUsed }));
  return `<div ${completeRootAttributes("success", {
    "data-grok-checked-at": view.result.checkedAt,
    "data-grok-stale": String(data.stale),
    "data-grok-warning-kind": data.warning?.kind ?? "none",
    "data-grok-cache-schema": String(data.schemaVersion),
    "data-grok-source": data.source,
    "data-grok-source-version": String(data.sourceVersion),
    "data-grok-operation": data.operation,
    "data-grok-period": data.period.type,
    "data-grok-percent-used": primary ? String(primary.percentUsed) : "",
    "data-grok-percent-remaining": remaining === undefined ? "" : String(remaining),
    "data-grok-percentage-field": primary?.provenance.percentageField ?? "",
    "data-grok-reset-at": primary?.resetAt ?? "",
    "data-grok-reset-field": primary?.provenance.resetField ?? "",
    "data-grok-products": JSON.stringify(products),
    "data-grok-completed-acquisitions": String(view.completedRefreshes),
  })}>${primary ? `${Math.round(primary.percentUsed)}% used` : "--"} checked ${view.completedRefreshes}</div>`;
}

describe("unattended Grok popover E2E runner", () => {
  it("compares provider auth bytes and modification time without exposing either", async () => {
    const root = await mkdtemp(join(tmpdir(), "baby-menu-grok-auth-integrity-"));
    const authPath = join(root, "auth.json");
    try {
      await writeFile(authPath, "original");
      const original = await captureGrokAuthIntegrity({ grokHome: root, authPath });

      expect(await grokAuthIntegrityEqual(original)).toBe(true);
      await writeFile(authPath, "changed");
      expect(await grokAuthIntegrityEqual(original)).toBe(false);

      await writeFile(authPath, "original");
      const restored = await captureGrokAuthIntegrity({ grokHome: root, authPath });
      const changedTime = new Date(Date.now() + 60_000);
      await utimes(authPath, changedTime, changedTime);
      expect(await grokAuthIntegrityEqual(restored)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats delayed startup waiting as intermediate until the action and renderer settle", () => {
    const waitingView = { state: "waiting", terminal: false, completed: 0 };

    expect(refreshLifecycleStatus({
      expected: 1,
      lifecycle: { started: 0, resolved: 0, rejected: 0 },
      view: waitingView,
    })).toEqual({ settled: false, stage: "bridge-pending" });
    expect(refreshLifecycleStatus({
      expected: 1,
      lifecycle: { started: 1, resolved: 0, rejected: 0 },
      view: waitingView,
    })).toEqual({ settled: false, stage: "action-running" });
    expect(refreshLifecycleStatus({
      expected: 1,
      lifecycle: { started: 1, resolved: 1, rejected: 0 },
      view: waitingView,
    })).toEqual({ settled: false, stage: "renderer-waiting" });
    expect(refreshLifecycleStatus({
      expected: 1,
      lifecycle: { started: 1, resolved: 1, rejected: 0 },
      view: { state: "failure", terminal: true, completed: 1 },
    })).toEqual({ settled: true, stage: "renderer-settled" });
  });

  it("requires a new safe renderer completion marker after the action settles", () => {
    const lifecycle = { started: 2, resolved: 2, rejected: 0 };

    expect(refreshLifecycleStatus({
      expected: 2,
      lifecycle,
      view: { state: "success", terminal: true, completed: 0, checkedAt: null },
      previousCheckedAt: "2026-07-14T20:00:00.000Z",
    })).toEqual({ settled: false, stage: "renderer-missing-completion-marker" });
    expect(refreshLifecycleStatus({
      expected: 2,
      lifecycle,
      view: { state: "success", terminal: true, completed: 0, checkedAt: "2026-07-14T20:00:00.000Z" },
      previousCheckedAt: "2026-07-14T20:00:00.000Z",
    })).toEqual({ settled: false, stage: "renderer-previous-result" });
    expect(refreshLifecycleStatus({
      expected: 2,
      lifecycle,
      view: { state: "success", terminal: true, completed: 0, checkedAt: "2026-07-14T20:00:01.000Z" },
      previousCheckedAt: "2026-07-14T20:00:00.000Z",
    })).toEqual({ settled: false, stage: "renderer-previous-result" });
    expect(refreshLifecycleStatus({
      expected: 1,
      lifecycle: { started: 1, resolved: 1, rejected: 0 },
      view: { state: "success", terminal: true, completed: 0, checkedAt: "2026-07-14T20:00:00.000Z" },
      previousCheckedAt: null,
    })).toEqual({ settled: false, stage: "renderer-previous-result" });
  });

  it("accepts the exact installed PR 48 root shape", () => {
    // Mutation killed: rejecting unprefixed+aliased installed roots as contract-invalid.
    const view = observeHtml(installedPr48RootHtml());
    expect(view).toMatchObject({
      observabilityMode: "installed-root",
      state: "success",
      checkedAt: "2026-07-14T20:00:00.000Z",
      cacheSchema: "2",
      source: "grok-credits-grpc-web",
      sourceVersion: "1",
      operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
      periodType: "weekly",
      percentUsed: "22",
      percentRemaining: "78",
      percentageField: "config.creditUsagePercent",
      resetAt: "2026-07-21T20:00:00.000Z",
      resetField: "config.currentPeriod.end",
      completed: 1,
      terminal: true,
    });
    // CDP expression path must match direct observation.
    expect(observeExpression(installedPr48RootHtml())).toMatchObject({
      observabilityMode: "installed-root",
      completed: 1,
      operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
    });
    // Retained terminal state while a later refresh is pending.
    expect(observeHtml(installedPr48RootHtml({ refreshing: true }))).toMatchObject({
      observabilityMode: "installed-root",
      state: "success",
      completed: 1,
      terminal: false,
    });
    expect(observeHtml(installedPr48RootHtml({ state: "waiting" }))).toMatchObject({
      observabilityMode: "installed-root",
      state: "waiting",
      completed: 0,
      terminal: false,
    });
  });

  it.each([
    {
      name: "missing installed completion attribute",
      html: installedPr48RootHtml().replace(/data-grok-completed-refreshes="\d+"/, ""),
    },
    {
      name: "waiting installed root with terminal warning",
      html: installedPr48RootHtml({ state: "waiting" }).replace('data-warning-kind="none"', 'data-warning-kind="connectivity"'),
    },
    {
      name: "waiting installed root with terminal checked timestamp",
      html: installedPr48RootHtml({ state: "waiting" }).replace('data-checked-at=""', 'data-checked-at="2026-07-14T20:00:00.000Z"'),
    },
    {
      name: "waiting installed root with terminal operation",
      html: installedPr48RootHtml({ state: "waiting" }).replace('data-failure-kind=""', 'data-failure-kind="" data-operation="grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig"'),
    },
    {
      name: "waiting installed root with terminal source",
      html: installedPr48RootHtml({ state: "waiting" }).replace('data-failure-kind=""', 'data-failure-kind="" data-source="grok-credits-grpc-web"'),
    },
    {
      name: "waiting installed root with terminal percentage",
      html: installedPr48RootHtml({ state: "waiting" }).replace('data-failure-kind=""', 'data-failure-kind="" data-percent-used="22"'),
    },
    {
      name: "waiting installed root with terminal reset",
      html: installedPr48RootHtml({ state: "waiting" }).replace('data-failure-kind=""', 'data-failure-kind="" data-reset-at="2026-07-21T20:00:00.000Z"'),
    },
    {
      name: "success installed root with terminal failure kind",
      html: installedPr48RootHtml().replace('data-failure-kind=""', 'data-failure-kind="connectivity"'),
    },
    {
      name: "failure installed root with terminal success source",
      html: installedPr48RootHtml({ state: "failure" }).replace('data-source=""', 'data-source="grok-credits-grpc-web"'),
    },
  ] as const)("rejects unsupported installed-root shape: $name", ({ html }) => {
    const view = observeHtml(html);
    expect(view).toMatchObject({
      observabilityMode: "invalid",
      state: "contract-invalid",
      terminal: true,
    });
    expect(view?.observabilityError).toContain("root with terminal evidence");
  });

  it.each([
    {
      name: "complete waiting",
      html: `<div ${completeRootAttributes("waiting")}></div>`,
      expected: { observabilityMode: "root-contract", state: "waiting", completed: 0, terminal: false },
    },
    {
      name: "complete success",
      html: `<div ${completeRootAttributes("success")}>22% used</div>`,
      expected: {
        observabilityMode: "root-contract",
        state: "success",
        completed: 1,
        terminal: true,
        source: "grok-credits-grpc-web",
        operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
      },
    },
    {
      name: "complete failure",
      html: `<div ${completeRootAttributes("failure")}></div>`,
      expected: {
        observabilityMode: "root-contract",
        state: "failure",
        failureKind: "connectivity",
        completed: 1,
        terminal: true,
      },
    },
    {
      name: "malformed terminal partial root",
      html: '<section aria-label="menu widgets"><div data-grok-e2e="success"></div></section>',
      expected: { observabilityMode: "invalid", state: "contract-invalid", terminal: true },
    },
    {
      name: "terminal success with completion count zero",
      html: `<div ${completeRootAttributes("success", { "data-grok-completed-acquisitions": "0" })}></div>`,
      expected: { observabilityMode: "invalid", state: "contract-invalid", terminal: true },
    },
    {
      name: "waiting root with terminal completion count",
      html: `<div ${completeRootAttributes("waiting", { "data-grok-completed-acquisitions": "1" })}></div>`,
      expected: { observabilityMode: "invalid", state: "contract-invalid", terminal: true },
    },
  ] as const)("observer table: $name", ({ html, expected }) => {
    // Mutations killed: wrong operation/source validation, permissive partial roots,
    // completed:0 settlement, and waiting carrying terminal evidence.
    const view = observeHtml(html);
    expect(view).toMatchObject(expected);
    if (expected.observabilityMode === "invalid") {
      expect(view?.observabilityError).toContain("root with terminal evidence");
    }
  });

  it("opens the real popover and drives startup and manual refresh without accessibility input", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain('mkdtemp(join(rootDir, "extensions-dev", "grok-popover-e2e-"))');
    expect(script).toContain('BABY_MENU_OPEN_POPOVER_ON_START: "1"');
    expect(script).toContain("BABY_MENU_REMOTE_DEBUGGING_PORT");
    expect(script).toContain("waitForCompletedRefresh(1, null)");
    expect(script).toContain("waitForCompletedRefresh(2, startupView.checkedAt)");
    expect(script).toContain("readSanitizedLifecycle");
    expect(script).toContain("refreshLifecycleStatus");
    expect(script).toContain("observedStage: lastStatus.stage");
    expect(script).toContain("waitForCompletedRefresh(expectedManualLifecycle, priorView.checkedAt)");
    expect(script).toContain("startupView.checkedAt");
    expect(script).toContain("intervalView.checkedAt");
    expect(script).toContain("manualView.checkedAt");
    expect(script).toContain('button[data-grok-refresh=\'true\']');
    expect(script).toContain("if (!button || button.disabled) return null");
    expect(script).toContain("const beforeClickLifecycle = readSanitizedLifecycle()");
    expect(script).toContain('Input.dispatchMouseEvent", { type: "mousePressed"');
    expect(script).toContain("event.isTrusted");
    expect(script).toContain("after.started !== before.started + 1");
    expect(script).toContain("after.resolved !== before.resolved + 1");
    expect(script).toContain('entry.text === "checking" && entry.disabled === true');
    expect(script).toContain("grok-refresh-sentinel");
    expect(script).toContain("healthy exact-source E2E unexpectedly launched the conditional refresh command");
    expect(script).toContain("healthyCliPreflightObserved: false");
    expect(script).toContain("healthyAuthUnchanged");
    expect(script).not.toContain("System Events");
    expect(script).not.toContain("AXPress");
  });

  it("compares both surfaces to the same-window exact consumer quota operation without exposing auth", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain("grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig");
    expect(script).toContain("https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig");
    expect(script).toContain("application/grpc-web+proto");
    expect(script).toContain("consumerOracle");
    expect(script).toContain("identityScopeEqual");
    expect(script).toContain("rendered percentage does not match official Grok consumer quota");
    expect(script).toContain("rendered product usage does not match official Grok consumer quota");
    expect(script).toContain("rendered reset does not match official Grok consumer quota");
    expect(script).toContain("quota_unreported while official Grok consumer quota is usable");
    expect(script).toContain("rendered credits do not match official Grok consumer quota");
    expect(script).not.toContain('method: "_x.ai/billing"');
    expect(script).not.toContain("billing?format=credits");
    expect(script).not.toContain("CODEXBAR_ALLOW_BROWSER_COOKIE_IMPORT");
    expect(script).not.toMatch(/console\.log\([^\n]*(?:authPath|rawResponse|responseBody|token)/);
  });

  it("renders generated-fixture observability values from renderer state", async () => {
    // Mutation killed: hardcoded source/version/operation (or wrong value bindings) on the success root.
    const fixture = await readFile(widgetFixturePath, "utf8");
    const successRoot = fixture.slice(fixture.indexOf('data-grok-e2e="success"'), fixture.indexOf("export const grokQuotaE2EWidget"));

    expect(successRoot).toContain("data-grok-source={view.result.data.source}");
    expect(successRoot).toContain("data-grok-source-version={String(view.result.data.sourceVersion)}");
    expect(successRoot).toContain("data-grok-operation={view.result.data.operation}");
    expect(successRoot).toContain("data-grok-percent-used={primary ? String(primary.percentUsed) : \"\"}");
    expect(successRoot).toContain("data-grok-percent-remaining={remaining === undefined ? \"\" : String(remaining)}");
    expect(successRoot).toContain("data-grok-products={JSON.stringify(products)}");
    expect(successRoot).toContain("data-grok-completed-acquisitions={String(view.completedRefreshes)}");
    expect(successRoot).not.toMatch(/data-grok-source=["']/);
    expect(successRoot).not.toMatch(/data-grok-operation=["']/);

    const successView = observeHtml(renderGeneratedRootHtml("success", {
      completedRefreshes: 1,
      result: {
        ok: true,
        checkedAt: "2026-07-14T20:00:00.000Z",
        data: {
          schemaVersion: 2,
          source: "grok-credits-grpc-web",
          sourceVersion: 1,
          operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
          period: { type: "weekly" },
          stale: false,
          windows: [
            {
              id: "credits",
              percentUsed: 22.4,
              percentRemaining: 77.6,
              resetAt: "2026-07-21T20:00:00.000Z",
              provenance: { percentageField: "config.creditUsagePercent", resetField: "config.currentPeriod.end" },
            },
            { id: "product:grok-build", percentUsed: 14, provenance: { percentageField: "config.productUsage[0].usagePercent" } },
          ],
        },
      },
    }));
    expect(successView).toMatchObject({
      observabilityMode: "root-contract",
      state: "success",
      source: "grok-credits-grpc-web",
      sourceVersion: "1",
      operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
      percentUsed: "22.4",
      percentRemaining: "77.6",
      completed: 1,
      terminal: true,
    });

    const waitingView = observeHtml(renderGeneratedRootHtml("waiting", { completedRefreshes: 0, result: null }));
    expect(waitingView).toMatchObject({ state: "waiting", completed: 0, terminal: false });

    const failureView = observeHtml(renderGeneratedRootHtml("failure", {
      completedRefreshes: 1,
      result: {
        ok: false,
        checkedAt: "2026-07-14T20:00:00.000Z",
        failure: { kind: "connectivity", message: "offline" },
      },
    }));
    expect(failureView).toMatchObject({
      state: "failure",
      failureKind: "connectivity",
      completed: 1,
      terminal: true,
    });

    // Fixture still rounds only visible copy.
    expect(fixture).toContain("`${Math.round(primary.percentUsed)}% used`");
    expect(fixture).toContain("`${Math.round(remaining)}% left`");
    expect(fixture).not.toContain("useEffect");
  });

  it("seeds and repairs an isolated installed-equivalent legacy cache", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain("seedLegacyCache");
    expect(script).toContain("percentRemaining: 1");
    expect(script).toContain('remaining: 0, unit: "credits"');
    expect(script).toContain("readSanitizedCacheStatus");
    expect(script).toContain("grok_quota_e2e_lifecycle");
    expect(script).toContain('recordLifecycle(context, "action-started")');
    expect(script).toContain('recordLifecycle(context, "action-resolved")');
    expect(script).toContain("status.schemaVersion !== 2");
    expect(script).toContain("status.operation !== official.operation");
    expect(script).toContain("!status.identityScopeEqual");
    expect(script).toContain("status.percentageField !== official.percentageField");
    expect(script).toContain("cache migration did not produce schema version 2");
    expect(script).toContain("BABY_MENU_GROK_E2E_INSTALLED_SOURCE");
  });

  it("waits for the app process group and requires successful database cleanup", async () => {
    const script = await readFile(scriptPath, "utf8");

    expect(script).toContain("const failures = []");
    expect(script).toContain("() => stopDevProcess()");
    expect(script).toContain("await waitForProcessGroupExit(pid, 10_000)");
    expect(script).toContain('signalProcessGroup(pid, "SIGKILL")');
    expect(script).toContain('error?.code === "EPERM" && !hasOwnedProcessGroupMember(pid)');
    expect(script).toContain('spawnSync("/bin/ps", ["-axo", "pgid=,uid="]');
    expect(script).toContain("if (result.status !== 0) fail(`failed to clean Grok E2E database:");
  });

  it("documents the repeatable command and cleanup contract", async () => {
    const [docs, packageText] = await Promise.all([readFile(docsPath, "utf8"), readFile(packagePath, "utf8")]);
    const packageJson = JSON.parse(packageText) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["test:e2e:grok-popover"]).toBe("node scripts/e2e-grok-popover.mjs");
    expect(docs).toContain("pnpm test:e2e:grok-popover");
    expect(docs).toContain("no accessibility click or human interaction is required");
    expect(docs).toContain("exact consumer `GetGrokCreditsConfig` gRPC-web operation");
    expect(docs).toContain("CodexBar");
    expect(docs).toContain("installed-widget source mode");
    expect(docs).toContain("documented non-prompt `grok models` capability");
    expect(docs).toContain("temporary fake executable");
    expect(docs).toContain("schema/provenance status");
    expect(docs).toContain("identity/scope equality");
    expect(docs).toContain("never imports browser cookies");
    expect(docs).toContain("The renderer's `waiting` state is intermediate");
    expect(docs).toContain("`grok_quota_e2e_cache` and `grok_quota_e2e_lifecycle` tables");
  });
});
