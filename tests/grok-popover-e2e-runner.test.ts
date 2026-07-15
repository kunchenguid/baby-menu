import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureGrokAuthIntegrity, grokAuthIntegrityEqual } from "../scripts/grok-auth-integrity.mjs";
import { refreshLifecycleStatus } from "../scripts/grok-popover-lifecycle.mjs";

const scriptUrl = new URL("../scripts/e2e-grok-popover.mjs", import.meta.url);
const docsUrl = new URL("../docs/grok-quota-e2e.md", import.meta.url);
const widgetFixtureUrl = new URL("./fixtures/grok-quota-generated/widget.tsx.fixture", import.meta.url);
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
    })).toEqual({ settled: true, stage: "renderer-settled" });
    expect(refreshLifecycleStatus({
      expected: 1,
      lifecycle: { started: 1, resolved: 1, rejected: 0 },
      view: { state: "success", terminal: true, completed: 0, checkedAt: "2026-07-14T20:00:00.000Z" },
      previousCheckedAt: null,
    })).toEqual({ settled: true, stage: "renderer-settled" });
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
    expect(script).toContain('root.getAttribute("data-grok-e2e") !== "waiting"');
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

    expect(fixture).toContain('data-percent-used={primary ? String(primary.percentUsed) : ""}');
    expect(fixture).toContain('data-percent-remaining={remaining === undefined ? "" : String(remaining)}');
    expect(fixture).toContain('`${Math.round(primary.percentUsed)}% used`');
    expect(fixture).toContain('`${Math.round(remaining)}% left`');
    expect(fixture).toContain('data-products={JSON.stringify(products)}');
    expect(fixture).toContain('view.result.data.period.type === "unspecified" ? "Credits" : view.result.data.period.type');
    expect(fixture).toContain('productWindows.filter((window) => window.percentUsed > 0).map');
    expect(fixture).toContain('{Math.round(window.percentUsed)}% used');
    expect(fixture).not.toContain("useEffect");
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
