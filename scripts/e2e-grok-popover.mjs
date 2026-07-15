#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshLifecycleStatus } from "./grok-popover-lifecycle.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(rootDir, "tests", "fixtures", "grok-quota-generated");
const grokHome = process.env.GROK_HOME || join(process.env.HOME || "", ".grok");
const grokExecutable = join(grokHome, "bin", "grok");
const installedSourceMode = process.env.BABY_MENU_GROK_E2E_INSTALLED_SOURCE === "1";
const installedSourceDir = process.env.BABY_MENU_GROK_E2E_INSTALLED_SOURCE_DIR ||
  join(process.env.HOME || "", ".baby-menu", "extensions", "grok-quota");
const port = 19_300 + (process.pid % 500);
const browserUrl = `http://127.0.0.1:${port}`;
const screenshotPath = process.env.BABY_MENU_GROK_E2E_SCREENSHOT || join(tmpdir(), "baby-menu-grok-popover-e2e.png");
const databasePath = join(rootDir, ".cache", "baby-menu", "baby-menu.db");
const devLogPath = process.env.BABY_MENU_GROK_E2E_LOG || join(tmpdir(), "baby-menu-grok-popover-e2e.log");
let devProcess;
let cdp;
let tempRoot;

function fail(message) {
  throw new Error(message);
}

function runSqlite(sql) {
  const result = spawnSync("/usr/bin/sqlite3", [databasePath], {
    encoding: "utf8",
    input: sql,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Grok E2E database command failed: ${result.stderr.trim() || `sqlite3 exited ${result.status}`}`);
  return result.stdout.trim();
}

async function cleanE2EDatabase() {
  try {
    await stat(databasePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const result = spawnSync("/usr/bin/sqlite3", [databasePath], {
    encoding: "utf8",
    input: "DROP TABLE IF EXISTS grok_quota_e2e_cache; DROP TABLE IF EXISTS grok_quota_e2e_lifecycle;",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`failed to clean Grok E2E database: ${result.stderr.trim() || `sqlite3 exited ${result.status}`}`);
}

function seedLegacyCache() {
  const legacy = {
    source: "api",
    windows: [
      {
        id: "credits",
        label: "credits",
        kind: "credits",
        percentUsed: 99,
        percentRemaining: 1,
        resetAt: "2026-07-01T00:00:00.000Z",
      },
      {
        id: "product:grokbuild",
        label: "GrokBuild",
        kind: "credits",
        percentUsed: 99,
        percentRemaining: 1,
        resetAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    credits: { remaining: 0, unit: "credits" },
    refreshedAt: "2026-07-15T00:00:00.000Z",
    stale: false,
  };
  const escaped = JSON.stringify(legacy).replaceAll("'", "''");
  runSqlite(`CREATE TABLE IF NOT EXISTS grok_quota_e2e_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS grok_quota_e2e_lifecycle (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    observed_at INTEGER NOT NULL
  );
  DELETE FROM grok_quota_e2e_lifecycle;
  INSERT INTO grok_quota_e2e_cache (key, value, updated_at)
  VALUES ('grok-quota-e2e', '${escaped}', 0)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
}

function readSanitizedCacheStatus() {
  const output = runSqlite(`SELECT
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.schemaVersion'), '') ELSE 'malformed' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.windows[0].provenance.percentageField'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.windows[0].provenance.resetField'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.credits.sourceField'), '') ELSE '' END
    FROM grok_quota_e2e_cache WHERE key = 'grok-quota-e2e';`);
  if (!output) return { present: false };
  const [schemaVersion, percentageField, resetField, creditsSourceField] = output.split("|");
  return {
    present: true,
    schemaVersion: Number(schemaVersion),
    percentageField,
    resetField,
    creditsSourceField,
  };
}

function readSanitizedLifecycle() {
  const output = runSqlite(`SELECT
    COALESCE(SUM(stage = 'action-started'), 0),
    COALESCE(SUM(stage = 'action-resolved'), 0),
    COALESCE(SUM(stage = 'action-rejected'), 0),
    COALESCE((SELECT stage FROM grok_quota_e2e_lifecycle ORDER BY sequence DESC LIMIT 1), 'none')
    FROM grok_quota_e2e_lifecycle;`);
  const [started, resolved, rejected, stage] = output.split("|");
  const lifecycle = {
    started: Number(started),
    resolved: Number(resolved),
    rejected: Number(rejected),
    stage,
  };
  if ([lifecycle.started, lifecycle.resolved, lifecycle.rejected].some((count) => !Number.isInteger(count) || count < 0 || count > 16)) {
    fail("Grok E2E lifecycle instrumentation exceeded its safe bound");
  }
  return lifecycle;
}

async function officialBilling() {
  const child = spawn(grokExecutable, ["agent", "--no-leader", "stdio"], {
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const result = await new Promise((resolveResult, rejectResult) => {
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      rejectResult(new Error("official Grok billing ACP timed out"));
    }, 20_000);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > 1024 * 1024) {
        clearTimeout(timer);
        child.kill("SIGTERM");
        rejectResult(new Error("official Grok billing ACP exceeded the safe output bound"));
        return;
      }
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && message.result) {
          send({ jsonrpc: "2.0", id: 2, method: "_x.ai/billing", params: {} });
        }
        if (message.id === 2) {
          clearTimeout(timer);
          if (message.error) {
            rejectResult(new Error(`official Grok billing ACP failed with code ${message.error.code ?? "unknown"}`));
          } else {
            resolveResult(message.result);
          }
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectResult(error);
    });
    child.once("close", (code) => {
      if (code && code !== 0) {
        clearTimeout(timer);
        rejectResult(new Error(`official Grok billing ACP exited ${code}`));
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: 1, clientCapabilities: {} },
    });
  }).finally(() => {
    child.kill("SIGTERM");
  });

  const config = result && typeof result === "object" && result.config && typeof result.config === "object"
    ? result.config
    : {};
  const productUsage = Array.isArray(config.productUsage) ? config.productUsage : [];
  const productIndex = productUsage.findIndex(
    (entry) => entry && typeof entry === "object" && Number.isFinite(entry.usagePercent),
  );
  const productPercent = productIndex >= 0 ? productUsage[productIndex].usagePercent : undefined;
  const hasGlobalPercentage = Number.isFinite(config.creditUsagePercent);
  const rawPercentage = hasGlobalPercentage ? config.creditUsagePercent : productPercent;
  const percentage = Number.isFinite(rawPercentage) ? Math.max(0, Math.min(100, rawPercentage)) : null;
  const currentPeriodReset = typeof config.currentPeriod?.end === "string" ? config.currentPeriod.end : null;
  const billingPeriodReset = typeof config.billingPeriodEnd === "string" ? config.billingPeriodEnd : null;
  const resetText = currentPeriodReset || billingPeriodReset;
  const resetAt = resetText ? Date.parse(resetText) : Number.NaN;
  const hasKnownPeriod = Boolean(currentPeriodReset || billingPeriodReset);
  const prepaidBalance = config.prepaidBalance && typeof config.prepaidBalance === "object" &&
    Number.isFinite(config.prepaidBalance.val)
    ? config.prepaidBalance.val
    : null;
  if (percentage === null && !hasKnownPeriod) fail("official Grok billing returned no recognizable quota period");
  return {
    kind: percentage === null ? "quota_unreported" : "quota",
    percentRemaining: percentage === null ? null : 100 - percentage,
    percentageField: percentage === null
      ? null
      : hasGlobalPercentage
        ? "config.creditUsagePercent"
        : `config.productUsage[${productIndex}].usagePercent`,
    resetField: currentPeriodReset
      ? "config.currentPeriod.end"
      : billingPeriodReset
        ? "config.billingPeriodEnd"
        : null,
    resetInHours: Number.isFinite(resetAt) ? Math.max(0, Math.ceil((resetAt - Date.now()) / 3_600_000)) : null,
    credits: percentage === null ? null : prepaidBalance,
    periodType: typeof config.currentPeriod?.type === "string" && config.currentPeriod.type.includes("WEEKLY")
      ? "weekly"
      : "unknown",
  };
}

async function installActionInstrumentation(extensionDir) {
  const implementationPath = join(extensionDir, "quota-implementation.ts");
  await rename(join(extensionDir, "server.ts"), implementationPath);
  await writeFile(
    join(extensionDir, "server.ts"),
    `import { actions as installedActions } from "./quota-implementation";

function recordLifecycle(context, stage) {
  context.db.exec(\`CREATE TABLE IF NOT EXISTS grok_quota_e2e_lifecycle (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    stage TEXT NOT NULL,
    observed_at INTEGER NOT NULL
  )\`);
  context.db.run(
    "INSERT INTO grok_quota_e2e_lifecycle (stage, observed_at) VALUES (?, ?)",
    [stage, Date.now()],
  );
}

async function boundedDelay() {
  const requested = Number(process.env.BABY_MENU_GROK_E2E_ACTION_DELAY_MS || 0);
  if (!Number.isFinite(requested) || requested <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, requested)));
}

export const actions = {
  async getQuota(input, context) {
    recordLifecycle(context, "action-started");
    await boundedDelay();
    try {
      const result = await installedActions.getQuota(input, context);
      recordLifecycle(context, "action-resolved");
      return result;
    } catch {
      recordLifecycle(context, "action-rejected");
      throw new Error("Grok E2E action rejected");
    }
  },
};
`,
  );
}

async function rewriteInstalledSource(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteInstalledSource(path);
      continue;
    }
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const source = await readFile(path, "utf8");
    await writeFile(
      path,
      source
        .replaceAll('"grok-quota"', '"grok-quota-e2e"')
        .replace('const CACHE_TABLE = "grok_quota_cache";', 'const CACHE_TABLE = "grok_quota_e2e_cache";'),
    );
  }
}

async function prepareExtensionWorkspace() {
  await mkdir(join(rootDir, ".cache", "baby-menu"), { recursive: true });
  await mkdir(join(rootDir, "extensions-dev"), { recursive: true });
  tempRoot = await mkdtemp(join(rootDir, "extensions-dev", "grok-popover-e2e-"));
  const extensionsDir = join(tempRoot, "extensions");
  const extensionDir = join(extensionsDir, "grok-quota-e2e");
  await mkdir(extensionDir, { recursive: true });
  if (installedSourceMode) {
    await cp(installedSourceDir, extensionDir, { recursive: true, force: true });
    await rewriteInstalledSource(extensionDir);
  } else {
    const server = (await readFile(join(fixtureDir, "server.ts.fixture"), "utf8"))
      .replace('const EXTENSION_ID = "grok-quota";', 'const EXTENSION_ID = "grok-quota-e2e";')
      .replace('const CACHE_TABLE = "grok_quota_cache";', 'const CACHE_TABLE = "grok_quota_e2e_cache";');
    await writeFile(join(extensionDir, "server.ts"), server);
    const widget = (await readFile(join(fixtureDir, "widget.tsx.fixture"), "utf8"))
      .replace("viewRefreshIntervalMs: 300_000", "viewRefreshIntervalMs: 2_000");
    await writeFile(join(extensionDir, "widget.tsx"), widget);
  }
  await installActionInstrumentation(extensionDir);
  return extensionsDir;
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await check().catch(() => null);
    if (result) return result;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  fail(`timed out waiting for ${label}`);
}

async function startApp(extensionsDir) {
  const log = await import("node:fs").then(({ openSync }) => openSync(devLogPath, "w"));
  devProcess = spawn("pnpm", ["dev"], {
    cwd: rootDir,
    detached: true,
    env: {
      ...process.env,
      BABY_MENU_DEV_EXTENSIONS_DIR: extensionsDir,
      BABY_MENU_OPEN_POPOVER_ON_START: "1",
      BABY_MENU_KEEP_POPOVER_OPEN: "1",
      BABY_MENU_REMOTE_DEBUGGING_PORT: String(port),
      BABY_MENU_TELEMETRY: "0",
      GROK_HOME: grokHome,
    },
    stdio: ["ignore", log, log],
  });
  await waitFor(async () => {
    const response = await fetch(`${browserUrl}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  }, 60_000, "Baby Menu renderer target").then((target) => connectCdp(target.webSocketDebuggerUrl));
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolveRequest, reject: rejectRequest } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) rejectRequest(new Error(`CDP ${message.error.code}: ${message.error.message}`));
    else resolveRequest(message.result);
  });
  cdp = {
    socket,
    send(method, params = {}) {
      const requestId = ++id;
      return new Promise((resolveRequest, rejectRequest) => {
        pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
  };
}

async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) fail("renderer evaluation failed");
  return response.result?.value;
}

async function waitForCompletedRefresh(expected, previousCheckedAt) {
  let lastView = null;
  let lastLifecycle = { started: 0, resolved: 0, rejected: 0, stage: "none" };
  let lastStatus = { settled: false, stage: "not-observed" };
  try {
    return await waitFor(
      async () => {
        lastView = await evaluate(`(() => {
          const root = document.querySelector("[data-grok-e2e]");
          if (root) {
            return {
              state: root.getAttribute("data-grok-e2e"),
              text: root.textContent,
              failureKind: root.getAttribute("data-failure-kind"),
              checkedAt: root.getAttribute("data-checked-at"),
              stale: root.getAttribute("data-stale"),
              warningKind: root.getAttribute("data-warning-kind"),
              cacheSchema: root.getAttribute("data-cache-schema"),
              completed: Number([...String(root.textContent || "").matchAll(/checked (\\d+)/ig)].at(-1)?.[1] || 0),
              terminal: root.getAttribute("data-grok-e2e") !== "waiting" &&
                !String(root.textContent || "").toLowerCase().includes("checking"),
            };
          }
          const region = document.querySelector("[aria-label='menu widgets']");
          const text = region?.textContent || "";
          const button = [...(region?.querySelectorAll("button") || [])].find((node) => /^(?:refresh|check again|checking)$/i.test(node.textContent?.trim() || ""));
          const lower = text.toLowerCase();
          return region && button ? {
            state: lower.includes("quota unreported") && !lower.includes("stale") ? "failure" : "success",
            text,
            failureKind: lower.includes("quota unreported") ? "quota_unreported" : null,
            checkedAt: region.querySelector("[data-grok-checked-at]")?.getAttribute("data-grok-checked-at") || null,
            stale: String(lower.includes("stale")),
            warningKind: lower.includes("stale") && lower.includes("quota unreported") ? "quota_unreported" : "none",
            cacheSchema: region.querySelector("[data-grok-cache-schema]")?.getAttribute("data-grok-cache-schema") || null,
            completed: 0,
            terminal: !button.disabled && button.textContent?.trim().toLowerCase() !== "checking" && !lower.includes("reading"),
          } : null;
        })()`);
        lastLifecycle = readSanitizedLifecycle();
        lastStatus = refreshLifecycleStatus({ expected, lifecycle: lastLifecycle, view: lastView, previousCheckedAt });
        return lastStatus.settled ? lastView : null;
      },
      25_000,
      `completed refresh ${expected}`,
    );
  } catch {
    const shell = await evaluate(`(() => ({
      hasFixtureTitle: document.body.textContent.includes("GROK QUOTA E2E"),
      fixtureRoots: document.querySelectorAll("[data-grok-e2e]").length,
      widgetRegionPresent: Boolean(document.querySelector("[aria-label='menu widgets']")),
    }))()`);
    fail(`timed out waiting for completed refresh ${expected}; lifecycle=${JSON.stringify({ ...lastLifecycle, observedStage: lastStatus.stage })}; renderer=${JSON.stringify({ lastView, shell })}; log=${devLogPath}`);
  }
}

function assertMatchesOfficial(view, official) {
  const text = String(view.text || "");
  if (official.kind === "quota") {
    if (view.state !== "success") fail(`expected quota success, rendered ${view.state}`);
    if (!text.includes(`${official.percentRemaining}% left`)) fail("rendered percentage does not match official Grok billing");
    if (view.stale !== "false") fail("rendered stale state does not match official Grok billing");
    if (view.warningKind !== "none") fail("rendered warning does not match official Grok billing");
    if (!installedSourceMode && view.cacheSchema !== "1") fail("rendered cache schema does not match the trusted contract");
    if (official.resetInHours !== null) {
      const renderedReset = /reset (\d+)h/i.exec(text);
      if (!renderedReset || Math.abs(Number(renderedReset[1]) - official.resetInHours) > 1) {
        fail("rendered reset does not match official Grok billing");
      }
    } else if (/reset \d+h/i.test(text)) {
      fail("rendered reset does not match official Grok billing");
    }
    if (official.credits !== null) {
      if (!text.includes(`${official.credits} credits`)) fail("rendered credits do not match official Grok billing");
    } else if (/\b\d+(?:\.\d+)? credits\b/i.test(text)) {
      fail("rendered credits do not match official Grok billing");
    }
    return;
  }
  if (view.failureKind !== "quota_unreported") fail(`expected quota_unreported, rendered ${view.failureKind || view.state}`);
  if (view.stale !== "false") fail("rendered stale state does not match official Grok billing");
  if (view.warningKind !== "none") fail("rendered warning does not match official Grok billing");
  if (/monthly credits|% left|reset \d+|\b\d+(?:\.\d+)? credits\b/i.test(text)) {
    fail("rendered a fabricated quota, reset, or credit balance while official Grok reported no percentage");
  }
}

async function clickVisibleRefresh() {
  const point = await waitFor(
    () => evaluate(`(() => {
      const button = document.querySelector("button[data-grok-refresh='true']") ||
        [...document.querySelectorAll("[aria-label='menu widgets'] button")].find((node) => /^(?:refresh|check again)$/i.test(node.textContent?.trim() || ""));
      if (!button || button.disabled) return null;
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit !== button && !button.contains(hit)) return null;
      window.__grokE2ETransitionObserver?.disconnect();
      window.__grokE2ETransitionObserver = new MutationObserver(() => {
        window.__grokE2ETransitions.push({ text: button.textContent, disabled: button.disabled, at: performance.now() });
      });
      window.__grokE2ETransitions = [{ text: button.textContent, disabled: button.disabled, at: performance.now() }];
      window.__grokE2ETransitionObserver.observe(button, { attributes: true, childList: true, subtree: true, characterData: true });
      window.__grokE2EClick = { count: 0, disabled: null, trusted: null };
      button.addEventListener("click", (event) => {
        window.__grokE2EClick = { count: window.__grokE2EClick.count + 1, disabled: button.disabled, trusted: event.isTrusted };
      }, { once: true });
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`),
    10_000,
    "enabled refresh button",
  );
  const beforeClickLifecycle = readSanitizedLifecycle();
  if (beforeClickLifecycle.started !== beforeClickLifecycle.resolved || beforeClickLifecycle.rejected !== 0) {
    fail("manual refresh baseline was not settled immediately before the click");
  }
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  const click = await waitFor(
    () => evaluate("window.__grokE2EClick?.count === 1 ? window.__grokE2EClick : null"),
    2_000,
    "trusted refresh click",
  );
  if (click.disabled || click.trusted !== true) fail("refresh click was not delivered to the enabled visible control");
  return beforeClickLifecycle;
}

async function captureScreenshot() {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(result.data, "base64"));
}

async function cleanup() {
  cdp?.socket.close();
  await stopDevProcess();
  await cleanE2EDatabase();
  await rm(join(rootDir, ".cache", "baby-menu", "server-actions", "grok-quota-e2e"), { recursive: true, force: true });
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

async function stopDevProcess() {
  const pid = devProcess?.pid;
  if (!pid) return;
  signalProcessGroup(pid, "SIGTERM");
  if (!(await waitForProcessGroupExit(pid, 10_000))) {
    signalProcessGroup(pid, "SIGKILL");
    if (!(await waitForProcessGroupExit(pid, 5_000))) fail("Baby Menu dev process group did not exit during cleanup");
  }
  devProcess = undefined;
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  return false;
}

function assertLifecycleCount(expected, label) {
  const lifecycle = readSanitizedLifecycle();
  if (lifecycle.started !== expected || lifecycle.resolved !== expected || lifecycle.rejected !== 0) {
    fail(`${label} acquisition lifecycle did not start and settle exactly once`);
  }
  return lifecycle;
}

function assertManualLifecycle(before, after) {
  if (after.started !== before.started + 1 ||
      after.resolved !== before.resolved + 1 ||
      after.rejected !== before.rejected) {
    fail("manual click did not cause exactly one acquisition lifecycle");
  }
  return after;
}

function assertCacheMigration(status, official) {
  if (official.kind === "quota_unreported") {
    if (status.present) fail("legacy fabricated cache survived migration after quota_unreported");
    return;
  }
  if (!status.present || status.schemaVersion !== 1) fail("cache migration did not produce the current trusted schema");
  if (status.percentageField !== official.percentageField) fail("cache percentage provenance does not match official Grok billing");
  if ((status.resetField || null) !== official.resetField) fail("cache reset provenance does not match official Grok billing");
  const expectedCreditsSource = official.credits === null ? "" : "config.prepaidBalance.val";
  if (status.creditsSourceField !== expectedCreditsSource) fail("cache credit provenance does not match official Grok billing");
}

async function main() {
  if (process.platform !== "darwin") fail("Grok popover E2E requires macOS");
  const official = await officialBilling();
  const extensionsDir = await prepareExtensionWorkspace();
  await cleanE2EDatabase();
  seedLegacyCache();
  await startApp(extensionsDir);

  const startupView = await waitForCompletedRefresh(1, null);
  const startupLifecycle = assertLifecycleCount(1, "startup");
  assertMatchesOfficial(startupView, official);
  const startupCacheStatus = readSanitizedCacheStatus();
  assertCacheMigration(startupCacheStatus, official);
  if (!Number.isFinite(Date.parse(startupView.checkedAt))) {
    fail("startup acquisition did not visibly settle with a safe checkedAt timestamp");
  }

  let intervalView;
  if (!installedSourceMode) {
    intervalView = await waitForCompletedRefresh(2, startupView.checkedAt);
    assertLifecycleCount(2, "interval");
    assertMatchesOfficial(intervalView, official);
    if (!Number.isFinite(Date.parse(intervalView.checkedAt)) || intervalView.checkedAt === startupView.checkedAt) {
      fail("interval acquisition did not visibly settle with a new safe checkedAt timestamp");
    }
  }

  const beforeClickLifecycle = await clickVisibleRefresh();
  const expectedManualLifecycle = beforeClickLifecycle.started + 1;
  const priorView = installedSourceMode ? startupView : intervalView;
  const manualView = await waitForCompletedRefresh(expectedManualLifecycle, priorView.checkedAt);
  const manualLifecycle = assertManualLifecycle(beforeClickLifecycle, readSanitizedLifecycle());
  assertMatchesOfficial(manualView, official);
  const transitions = await evaluate("window.__grokE2ETransitions");
  if (!transitions.some((entry) => entry.text === "checking" && entry.disabled === true)) {
    fail("manual refresh control never entered its visible checking state");
  }
  if (!Number.isFinite(Date.parse(manualView.checkedAt)) || manualView.checkedAt === priorView.checkedAt) {
    fail("manual acquisition did not visibly settle with a new safe checkedAt timestamp");
  }
  const manualCacheStatus = readSanitizedCacheStatus();
  assertCacheMigration(manualCacheStatus, official);

  await captureScreenshot();

  console.log(JSON.stringify({
    ok: true,
    sourceMode: installedSourceMode ? "installed-widget-copy" : "generated-install",
    startupRefreshes: 1,
    intervalRefreshes: installedSourceMode ? "not-shortened" : 1,
    manualRefreshes: 1,
    startupAcquisitionSettled: startupLifecycle.stage === "action-resolved",
    intervalAcquisitionSettled: !installedSourceMode,
    manualAcquisitionSettled: manualLifecycle.stage === "action-resolved",
    officialKind: official.kind,
    officialPeriodType: official.periodType,
    officialResetInHours: official.resetInHours,
    renderedState: manualView.state,
    renderedFailureKind: manualView.failureKind,
    cacheStatus: manualCacheStatus.present ? "current-schema-official-provenance" : "legacy-rejected-no-cache",
    credentialRefreshAllowed: true,
    screenshot: screenshotPath,
    devLog: devLogPath,
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(cleanup);
