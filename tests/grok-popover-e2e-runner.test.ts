import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { captureGrokAuthIntegrity, grokAuthIntegrityEqual } from "../scripts/grok-auth-integrity.mjs";
import {
  GROK_OBSERVABILITY_ATTRIBUTES,
  grokPopoverObservationExpression,
  type GrokPopoverObservation,
} from "../scripts/grok-popover-observability.mjs";
import { refreshLifecycleStatus } from "../scripts/grok-popover-lifecycle.mjs";

const scriptUrl = new URL("../scripts/e2e-grok-popover.mjs", import.meta.url);
const docsUrl = new URL("../docs/grok-quota-e2e.md", import.meta.url);
const widgetFixtureUrl = new URL("./fixtures/grok-quota-generated/widget.tsx.fixture", import.meta.url);
const mixedRootFixtureUrl = new URL("./fixtures/grok-quota-observability/pr48-mixed-root.html", import.meta.url);
const completeRootFixtureUrl = new URL("./fixtures/grok-quota-observability/pr48-complete-root.html", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

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

  it("reproduces the PR 48 mixed root and prefixed-descendant mismatch", async () => {
    const html = await readFile(mixedRootFixtureUrl, "utf8");
    const document = new JSDOM(html).window.document;
    const partialRoot = document.querySelector("[data-grok-e2e]");

    expect(partialRoot?.getAttribute("data-grok-e2e")).toBe("success");
    expect(partialRoot?.getAttribute("data-checked-at")).toBeNull();
    expect(partialRoot?.querySelector("[data-grok-checked-at]")?.getAttribute("data-grok-checked-at"))
      .toBe("2026-07-14T20:00:00.000Z");
  });

  it("falls back deterministically instead of selecting the partial PR 48 root", async () => {
    const html = await readFile(mixedRootFixtureUrl, "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    const view = dom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;

    expect(view).toMatchObject({
      observabilityMode: "installed-fallback",
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
  });

  it("selects a complete stable root contract", () => {
    const dom = new JSDOM(`
      <div
        data-grok-e2e="success"
        data-grok-checked-at="2026-07-14T20:00:00.000Z"
        data-grok-stale="false"
        data-grok-warning-kind="none"
        data-grok-failure-kind="none"
        data-grok-cache-schema="2"
        data-grok-source="grok-credits-grpc-web"
        data-grok-source-version="1"
        data-grok-operation="grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig"
        data-grok-period="weekly"
        data-grok-percent-used="22"
        data-grok-percent-remaining="78"
        data-grok-percentage-field="config.creditUsagePercent"
        data-grok-reset-at="2026-07-21T20:00:00.000Z"
        data-grok-reset-field="config.currentPeriod.end"
        data-grok-products='[{"id":"product:grok-build","percentUsed":14}]'
        data-grok-completed-acquisitions="1"
      >22% used 78% left</div>
    `, { runScripts: "outside-only" });
    const view = dom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;

    expect(view).toMatchObject({
      observabilityMode: "root-contract",
      state: "success",
      completed: 1,
      terminal: true,
    });
  });

  it("mechanically aligns the manually managed PR 48 copy with the complete root contract", async () => {
    const [completeHtml, mixedHtml] = await Promise.all([
      readFile(completeRootFixtureUrl, "utf8"),
      readFile(mixedRootFixtureUrl, "utf8"),
    ]);
    const completeDom = new JSDOM(completeHtml, { runScripts: "outside-only" });
    const mixedDom = new JSDOM(mixedHtml, { runScripts: "outside-only" });
    const root = completeDom.window.document.querySelector("[data-grok-e2e]");

    for (const attribute of GROK_OBSERVABILITY_ATTRIBUTES) {
      expect(root?.hasAttribute(attribute), attribute).toBe(true);
      expect(root?.querySelector(`[${attribute}]`), attribute).toBeNull();
    }

    const completeView = completeDom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;
    const mixedView = mixedDom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;
    expect(completeView.observabilityMode).toBe("root-contract");
    expect(completeView).toMatchObject({
      checkedAt: mixedView.checkedAt,
      cacheSchema: mixedView.cacheSchema,
      operation: mixedView.operation,
      source: mixedView.source,
      sourceVersion: mixedView.sourceVersion,
      periodType: mixedView.periodType,
      percentUsed: mixedView.percentUsed,
      percentRemaining: mixedView.percentRemaining,
      percentageField: mixedView.percentageField,
      resetAt: mixedView.resetAt,
      resetField: mixedView.resetField,
      products: mixedView.products,
      completed: mixedView.completed,
    });

    const button = completeDom.window.document.querySelector("button");
    button?.setAttribute("disabled", "");
    if (button) button.textContent = "checking";
    const refreshingView = completeDom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;
    expect(refreshingView).toMatchObject({
      observabilityMode: "root-contract",
      state: "success",
      checkedAt: completeView.checkedAt,
      completed: completeView.completed,
    });
  });

  it("reserves waiting for the initial acquisition", () => {
    function waitingDom(completed: string): JSDOM {
      const attributes = GROK_OBSERVABILITY_ATTRIBUTES
        .filter((attribute) => attribute !== "data-grok-e2e")
        .map((attribute) => {
          const value = attribute === "data-grok-stale" ? "false"
            : attribute === "data-grok-warning-kind" || attribute === "data-grok-failure-kind" ? "none"
              : attribute === "data-grok-products" ? "[]"
                : attribute === "data-grok-completed-acquisitions" ? completed
                  : "";
          return `${attribute}='${value}'`;
        })
        .join(" ");
      return new JSDOM(`<div data-grok-e2e="waiting" ${attributes}></div>`, { runScripts: "outside-only" });
    }

    const initialView = waitingDom("0").window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;
    expect(initialView).toMatchObject({ state: "waiting", completed: 0, terminal: false });
    const invalidView = waitingDom("1").window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;
    expect(invalidView).toMatchObject({
      observabilityMode: "invalid",
      state: "contract-invalid",
      terminal: true,
    });
    expect(invalidView.observabilityError).toContain("root with terminal evidence");
  });

  it("rejects an unsupported terminal partial root without polling to an ambiguous timeout", () => {
    const dom = new JSDOM('<section aria-label="menu widgets"><div data-grok-e2e="success"></div></section>', {
      runScripts: "outside-only",
    });
    const view = dom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;

    expect(view).toMatchObject({
      observabilityMode: "invalid",
      state: "contract-invalid",
      terminal: true,
    });
    expect(view.observabilityError).toContain("root with terminal evidence does not satisfy the stable root contract");
  });

  it("rejects visible settled evidence on an incomplete waiting root", () => {
    const dom = new JSDOM(`
      <section aria-label="menu widgets">
        <div data-grok-e2e="waiting">
          <span data-grok-checked-at="2026-07-14T20:00:00.000Z">last checked 1:00 PM</span>
          <p>checked 1</p>
          <button type="button">refresh</button>
        </div>
      </section>
    `, { runScripts: "outside-only" });
    const view = dom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;

    expect(view).toMatchObject({
      observabilityMode: "invalid",
      state: "contract-invalid",
      terminal: true,
    });
  });

  it("rejects terminal root states without a completed acquisition", () => {
    const html = `
      <div
        data-grok-e2e="failure"
        data-grok-checked-at="2026-07-14T20:00:00.000Z"
        data-grok-stale="false"
        data-grok-warning-kind="none"
        data-grok-failure-kind="connectivity"
        data-grok-cache-schema=""
        data-grok-source=""
        data-grok-source-version=""
        data-grok-operation=""
        data-grok-period=""
        data-grok-percent-used=""
        data-grok-percent-remaining=""
        data-grok-percentage-field=""
        data-grok-reset-at=""
        data-grok-reset-field=""
        data-grok-products="[]"
        data-grok-completed-acquisitions="0"
      ></div>
    `;
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    const view = dom.window.eval(grokPopoverObservationExpression()) as GrokPopoverObservation;

    expect(view).toMatchObject({
      observabilityMode: "invalid",
      state: "contract-invalid",
      terminal: true,
    });
  });

  it("opens the real popover and drives startup and manual refresh without accessibility input", async () => {
    const script = await readFile(scriptUrl, "utf8");

    expect(script).toContain('mkdtemp(join(rootDir, "extensions-dev", "grok-popover-e2e-"))');
    expect(script).toContain('BABY_MENU_OPEN_POPOVER_ON_START: "1"');
    expect(script).toContain("BABY_MENU_REMOTE_DEBUGGING_PORT");
    expect(script).toContain("waitForCompletedRefresh(1, null)");
    expect(script).toContain("waitForCompletedRefresh(2, startupView.checkedAt)");
    expect(script).toContain("readSanitizedLifecycle");
    expect(script).toContain("refreshLifecycleStatus");
    expect(script).toContain("observedStage: lastStatus.stage");
    expect(script).toContain("grokPopoverObservationExpression");
    expect(script).toContain("Grok renderer observability contract invalid");
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
    const script = await readFile(scriptUrl, "utf8");

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

  it("keeps exact values in state and rounds only visible used and remaining copy", async () => {
    const fixture = await readFile(widgetFixtureUrl, "utf8");

    expect(fixture).toContain('data-grok-percent-used={primary ? String(primary.percentUsed) : ""}');
    expect(fixture).toContain('data-grok-percent-remaining={remaining === undefined ? "" : String(remaining)}');
    expect(fixture).toContain('`${Math.round(primary.percentUsed)}% used`');
    expect(fixture).toContain('`${Math.round(remaining)}% left`');
    expect(fixture).toContain('data-grok-products={JSON.stringify(products)}');
    expect(fixture).toContain('view.result.data.period.type === "unspecified" ? "Credits" : view.result.data.period.type');
    expect(fixture).toContain('productWindows.filter((window) => window.percentUsed > 0).map');
    expect(fixture).toContain('{Math.round(window.percentUsed)}% used');
    expect(fixture).not.toContain("useEffect");
  });

  it("keeps every stable observability attribute on each generated root state", async () => {
    const fixture = await readFile(widgetFixtureUrl, "utf8");

    for (const attribute of GROK_OBSERVABILITY_ATTRIBUTES) {
      expect(fixture.match(new RegExp(`${attribute}(?:=|\\s)`, "g"))?.length, attribute).toBe(3);
    }
    expect(fixture).toContain("data-grok-completed-acquisitions={String(view.completedRefreshes)}");
    expect(fixture).not.toMatch(/data-(?:checked-at|cache-schema|operation|percent-used|products)=/);
  });

  it("seeds and repairs an isolated installed-equivalent legacy cache", async () => {
    const script = await readFile(scriptUrl, "utf8");

    expect(script).toContain("seedLegacyCache");
    expect(script).toContain('percentRemaining: 1');
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
    const script = await readFile(scriptUrl, "utf8");

    expect(script).toContain("const failures = []");
    expect(script).toContain("() => stopDevProcess()");
    expect(script).toContain("await waitForProcessGroupExit(pid, 10_000)");
    expect(script).toContain('signalProcessGroup(pid, "SIGKILL")');
    expect(script).toContain('error?.code === "EPERM" && !hasOwnedProcessGroupMember(pid)');
    expect(script).toContain('spawnSync("/bin/ps", ["-axo", "pgid=,uid="]');
    expect(script).toContain('if (result.status !== 0) fail(`failed to clean Grok E2E database:');
  });

  it("documents the repeatable command and cleanup contract", async () => {
    const [docs, packageText] = await Promise.all([readFile(docsUrl, "utf8"), readFile(packageUrl, "utf8")]);
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
