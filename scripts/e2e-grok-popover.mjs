#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(rootDir, "tests", "fixtures", "grok-quota-generated");
const grokHome = process.env.GROK_HOME || join(process.env.HOME || "", ".grok");
const grokExecutable = join(grokHome, "bin", "grok");
const authPath = join(grokHome, "auth.json");
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

async function authPreflight() {
  const details = await stat(authPath);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(authPath, "utf8"));
  } catch {
    fail("Grok auth metadata could not be parsed safely");
  }
  const expiries = Object.values(parsed && typeof parsed === "object" ? parsed : {})
    .map((entry) => entry && typeof entry === "object" && typeof entry.expires_at === "string" ? Date.parse(entry.expires_at) : Number.NaN)
    .filter(Number.isFinite);
  const safelyCurrent = expiries.some((expiry) => expiry - Date.now() >= 30 * 60_000);
  return { metadata: authFileMetadata(details), safelyCurrent };
}

function authFileMetadata(details) {
  return { size: details.size, mtimeMs: details.mtimeMs, mode: details.mode & 0o777 };
}

async function cleanE2EDatabase() {
  try {
    await stat(databasePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const result = spawnSync("/usr/bin/sqlite3", [databasePath, "DROP TABLE IF EXISTS grok_quota_e2e_cache;"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`failed to clean Grok E2E database: ${result.stderr.trim() || `sqlite3 exited ${result.status}`}`);
}

async function officialBilling() {
  const child = spawn(grokExecutable, ["agent", "--no-leader", "stdio"], {
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderrBytes = 0;
  child.stderr.on("data", (chunk) => {
    stderrBytes += Buffer.byteLength(chunk);
  });
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
  const productPercent = Array.isArray(config.productUsage)
    ? config.productUsage.find((entry) => entry && typeof entry === "object" && Number.isFinite(entry.usagePercent))?.usagePercent
    : undefined;
  const rawPercentage = Number.isFinite(config.creditUsagePercent) ? config.creditUsagePercent : productPercent;
  const percentage = Number.isFinite(rawPercentage) ? Math.round(rawPercentage) : null;
  const resetText = typeof config.currentPeriod?.end === "string"
    ? config.currentPeriod.end
    : typeof config.billingPeriodEnd === "string"
      ? config.billingPeriodEnd
      : null;
  const resetAt = resetText ? Date.parse(resetText) : Number.NaN;
  const hasKnownPeriod = typeof config.currentPeriod?.end === "string" || typeof config.billingPeriodEnd === "string";
  if (percentage === null && !hasKnownPeriod) fail("official Grok billing returned no recognizable quota period");
  return {
    kind: percentage === null ? "quota_unreported" : "quota",
    percentRemaining: percentage === null ? null : Math.max(0, Math.min(100, 100 - percentage)),
    resetInHours: Number.isFinite(resetAt) ? Math.max(0, Math.ceil((resetAt - Date.now()) / 3_600_000)) : null,
    periodType: typeof config.currentPeriod?.type === "string" && config.currentPeriod.type.includes("WEEKLY")
      ? "weekly"
      : "unknown",
    stderrBytes,
  };
}

async function prepareExtensionWorkspace() {
  await mkdir(join(rootDir, ".cache", "baby-menu"), { recursive: true });
  tempRoot = await mkdtemp(join(rootDir, ".cache", "baby-menu", "grok-popover-e2e-"));
  const extensionsDir = join(tempRoot, "extensions");
  const extensionDir = join(extensionsDir, "grok-quota-e2e");
  await mkdir(extensionDir, { recursive: true });
  const server = (await readFile(join(fixtureDir, "server.ts.fixture"), "utf8"))
    .replace('const EXTENSION_ID = "grok-quota";', 'const EXTENSION_ID = "grok-quota-e2e";')
    .replace('const CACHE_TABLE = "grok_quota_cache";', 'const CACHE_TABLE = "grok_quota_e2e_cache";');
  await writeFile(join(extensionDir, "server.ts"), server);
  await copyFile(join(fixtureDir, "widget.tsx.fixture"), join(extensionDir, "widget.tsx"));
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

async function waitForCompletedRefresh(expected) {
  let lastView = null;
  try {
    return await waitFor(
      async () => {
        lastView = await evaluate(`(() => {
          const root = document.querySelector("[data-grok-e2e]");
          return root ? { state: root.getAttribute("data-grok-e2e"), text: root.textContent, failureKind: root.getAttribute("data-failure-kind") } : null;
        })()`);
        return lastView?.text?.includes(`checked ${expected}`) ? lastView : null;
      },
      20_000,
      `completed refresh ${expected}`,
    );
  } catch {
    const shell = await evaluate(`(() => ({
      hasFixtureTitle: document.body.textContent.includes("GROK QUOTA E2E"),
      fixtureRoots: document.querySelectorAll("[data-grok-e2e]").length,
      widgetRegionPresent: Boolean(document.querySelector("[aria-label='menu widgets']")),
    }))()`);
    fail(`timed out waiting for completed refresh ${expected}; renderer=${JSON.stringify({ lastView, shell })}; log=${devLogPath}`);
  }
}

function assertMatchesOfficial(view, official) {
  const text = String(view.text || "");
  if (official.kind === "quota") {
    if (view.state !== "success") fail(`expected quota success, rendered ${view.state}`);
    if (!text.includes(`${official.percentRemaining}% left`)) fail("rendered percentage does not match official Grok billing");
    if (official.resetInHours !== null) {
      const renderedReset = /reset (\d+)h/i.exec(text);
      if (!renderedReset || Math.abs(Number(renderedReset[1]) - official.resetInHours) > 1) {
        fail("rendered reset does not match official Grok billing");
      }
    }
    return;
  }
  if (view.failureKind !== "quota_unreported") fail(`expected quota_unreported, rendered ${view.failureKind || view.state}`);
  if (/monthly credits|% left|reset \d+/i.test(text)) fail("rendered a fabricated quota or reset while official Grok reported no percentage");
}

async function clickVisibleRefresh() {
  await evaluate(`(() => {
    const button = document.querySelector("button[data-grok-refresh='true']");
    if (!button) throw new Error("refresh button missing");
    window.__grokE2ETransitions = [{ text: button.textContent, disabled: button.disabled, at: performance.now() }];
    new MutationObserver(() => window.__grokE2ETransitions.push({ text: button.textContent, disabled: button.disabled, at: performance.now() }))
      .observe(button, { attributes: true, childList: true, subtree: true, characterData: true });
  })()`);
  const point = await evaluate(`(() => {
    const rect = document.querySelector("button[data-grok-refresh='true']").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
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

async function main() {
  if (process.platform !== "darwin") fail("Grok popover E2E requires macOS");
  const beforeAuth = await authPreflight();
  if (!beforeAuth.safelyCurrent) fail("Grok auth is not safely current; refusing a read-only E2E that could refresh it");
  const official = await officialBilling();
  const extensionsDir = await prepareExtensionWorkspace();
  await cleanE2EDatabase();
  await startApp(extensionsDir);

  const startupView = await waitForCompletedRefresh(1);
  assertMatchesOfficial(startupView, official);

  await clickVisibleRefresh();
  const manualView = await waitForCompletedRefresh(2);
  assertMatchesOfficial(manualView, official);
  const transitions = await evaluate("window.__grokE2ETransitions");
  if (!transitions.some((entry) => entry.text === "checking" && entry.disabled === true)) {
    fail("manual refresh control never entered its visible checking state");
  }

  await captureScreenshot();
  const afterAuthMetadata = authFileMetadata(await stat(authPath));
  if (JSON.stringify(afterAuthMetadata) !== JSON.stringify(beforeAuth.metadata)) fail("Grok auth metadata changed during read-only E2E");

  console.log(JSON.stringify({
    ok: true,
    startupRefreshes: 1,
    manualRefreshes: 1,
    officialKind: official.kind,
    officialPeriodType: official.periodType,
    officialResetInHours: official.resetInHours,
    renderedState: manualView.state,
    renderedFailureKind: manualView.failureKind,
    authMetadataChanged: false,
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
