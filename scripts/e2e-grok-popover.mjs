#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureGrokAuthIntegrity, grokAuthIntegrityEqual, resolveGrokAuthPath } from "./grok-auth-integrity.mjs";
import { refreshLifecycleStatus } from "./grok-popover-lifecycle.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(rootDir, "tests", "fixtures", "grok-quota-generated");
const grokHome = process.env.GROK_HOME || join(process.env.HOME || "", ".grok");
const consumerQuotaUrl = "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig";
const consumerOperation = "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig";
const responseLimitBytes = 64 * 1024;
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
let fakeGrokCliPath;
let fakeGrokCliCountPath;

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

function readSanitizedCacheStatus(expectedAccountBinding) {
  if (!/^[a-f0-9]{64}$/.test(expectedAccountBinding)) fail("Grok E2E oracle has no stable principal binding");
  const output = runSqlite(`SELECT
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.schemaVersion'), '') ELSE 'malformed' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.source'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.sourceVersion'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.operation'), '') ELSE '' END,
    CASE WHEN json_valid(value) AND json_extract(value, '$.accountBinding') = '${expectedAccountBinding}' THEN '1' ELSE '0' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.period.type'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.windows[0].provenance.percentageField'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.windows[0].provenance.resetField'), '') ELSE '' END,
    CASE WHEN json_valid(value) THEN COALESCE(json_extract(value, '$.credits.sourceField'), '') ELSE '' END
    FROM grok_quota_e2e_cache WHERE key = 'grok-quota-e2e';`);
  if (!output) return { present: false, identityScopeEqual: false };
  const [schemaVersion, source, sourceVersion, operation, identityScopeEqual, periodType, percentageField, resetField, creditsSourceField] = output.split("|");
  return {
    present: true,
    schemaVersion: Number(schemaVersion),
    source,
    sourceVersion: Number(sourceVersion),
    operation,
    identityScopeEqual: identityScopeEqual === "1",
    periodType,
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

function oracleReadVarint(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let index = start;
  while (index < bytes.length && shift <= 63n) {
    const byte = bytes[index++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, index };
    shift += 7n;
  }
  fail("consumerOracle rejected malformed protobuf");
}

function oracleFields(bytes) {
  const fields = [];
  let index = 0;
  while (index < bytes.length) {
    const key = oracleReadVarint(bytes, index);
    index = key.index;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (field <= 0) fail("consumerOracle rejected malformed protobuf");
    if (wire === 0) {
      const scalar = oracleReadVarint(bytes, index);
      fields.push({ field, wire, value: scalar.value });
      index = scalar.index;
      continue;
    }
    if (wire === 2) {
      const length = oracleReadVarint(bytes, index);
      index = length.index;
      const end = index + Number(length.value);
      if (!Number.isSafeInteger(end) || end > bytes.length) fail("consumerOracle rejected truncated protobuf");
      fields.push({ field, wire, value: bytes.slice(index, end) });
      index = end;
      continue;
    }
    if (wire === 5) {
      if (index + 4 > bytes.length) fail("consumerOracle rejected truncated protobuf");
      fields.push({ field, wire, value: bytes.slice(index, index + 4) });
      index += 4;
      continue;
    }
    if (wire === 1) {
      if (index + 8 > bytes.length) fail("consumerOracle rejected truncated protobuf");
      index += 8;
      continue;
    }
    fail("consumerOracle rejected unsupported protobuf wire type");
  }
  return fields;
}

function oracleAt(fields, number, wire) {
  return fields.filter((field) => field.field === number && field.wire === wire);
}

function oracleMessage(fields, number) {
  const field = oracleAt(fields, number, 2)[0];
  return field ? oracleFields(field.value) : undefined;
}

function oracleScalar(fields, number) {
  return oracleAt(fields, number, 0)[0]?.value;
}

function oracleFloat(fields, number) {
  const field = oracleAt(fields, number, 5)[0];
  if (!field) return undefined;
  const value = new DataView(field.value.buffer, field.value.byteOffset, 4).getFloat32(0, true);
  if (!Number.isFinite(value)) fail("consumerOracle rejected non-finite percentage");
  return value;
}

function oracleTimestamp(fields, number) {
  const timestamp = oracleMessage(fields, number);
  const seconds = timestamp ? oracleScalar(timestamp, 1) : undefined;
  if (seconds === undefined || seconds > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  const date = new Date(Number(seconds) * 1_000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function oracleGrpcPayload(bytes) {
  let index = 0;
  const frames = [];
  let framed = bytes.length >= 5;
  let grpcStatus = 0;
  while (framed && index < bytes.length) {
    if (index + 5 > bytes.length) {
      framed = false;
      break;
    }
    const flags = bytes[index];
    const length = new DataView(bytes.buffer, bytes.byteOffset + index + 1, 4).getUint32(0);
    const start = index + 5;
    const end = start + length;
    if (end > bytes.length || (flags & 0x7f) !== 0) {
      framed = false;
      break;
    }
    if ((flags & 0x80) !== 0) {
      const trailer = new TextDecoder().decode(bytes.slice(start, end));
      const match = /(?:^|\r?\n)grpc-status:\s*(\d+)/i.exec(trailer);
      grpcStatus = match ? Number(match[1]) : grpcStatus;
    } else {
      frames.push(bytes.slice(start, end));
    }
    index = end;
  }
  if (!framed || index !== bytes.length) return bytes;
  if (grpcStatus !== 0) fail(`consumerOracle received gRPC status ${grpcStatus}`);
  if (frames.length !== 1) fail("consumerOracle expected one data frame");
  return frames[0];
}

function oracleAccountBinding(kind, entry) {
  const userId = typeof entry.user_id === "string" && entry.user_id ? entry.user_id : undefined;
  if (!userId) fail("consumerOracle could not form a stable principal binding");
  const teamId = typeof entry.team_id === "string" ? entry.team_id : "";
  return createHash("sha256").update(JSON.stringify({ kind, userId, teamId })).digest("hex");
}

async function selectOracleAuth() {
  let root;
  if (process.env.GROK_AUTH_JSON) {
    root = JSON.parse(process.env.GROK_AUTH_JSON);
  } else {
    const authPath = resolveGrokAuthPath({ grokHome, authPath: process.env.GROK_AUTH_PATH });
    root = JSON.parse(await readFile(authPath, "utf8"));
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) fail("consumerOracle auth source is incompatible");
  const now = Date.now();
  const candidates = [];
  for (const [scopeKey, value] of Object.entries(root)) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.key !== "string" || !value.key) continue;
    const kind = scopeKey.startsWith("https://auth.x.ai::")
      ? "oidc"
      : (scopeKey === "https://accounts.x.ai/sign-in" || scopeKey.includes("/sign-in")) ? "legacy" : undefined;
    if (!kind) continue;
    const expiresAt = typeof value.expires_at === "string" ? Date.parse(value.expires_at) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= now) continue;
    candidates.push({ scopeKey, kind, key: value.key, accountBinding: oracleAccountBinding(kind, value) });
  }
  const oidc = candidates.filter((candidate) => candidate.kind === "oidc");
  const winning = oidc.length > 0 ? oidc : candidates.filter((candidate) => candidate.kind === "legacy");
  if (winning.length === 0) fail("consumerOracle found no current supported auth entry");
  if (new Set(winning.map((candidate) => candidate.accountBinding)).size !== 1) fail("consumerOracle refused ambiguous principals");
  winning.sort((left, right) => left.scopeKey.localeCompare(right.scopeKey));
  return winning[0];
}

async function oracleResponseBytes(response) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > responseLimitBytes) {
      await reader.cancel();
      fail("consumerOracle response exceeded 64 KiB");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function normalizeOraclePayload(payload, accountBinding) {
  const response = oracleFields(payload);
  const config = oracleMessage(response, 1);
  if (!config) fail("consumerOracle response has no config");
  const period = oracleMessage(config, 8);
  const rawPeriodType = period ? oracleScalar(period, 1) : undefined;
  const periodType = rawPeriodType === 2n ? "weekly" : rawPeriodType === 1n ? "monthly" : "unspecified";
  const startAt = period ? oracleTimestamp(period, 2) : undefined;
  const endAt = period ? oracleTimestamp(period, 3) : undefined;
  const validPeriod = (periodType === "weekly" || periodType === "monthly") && Boolean(startAt && endAt);
  const explicitPercent = oracleFloat(config, 1);
  if (explicitPercent === undefined && !validPeriod) fail("consumerOracle found no official percentage or proto3-zero evidence");
  const percentUsed = Math.min(100, Math.max(0, explicitPercent ?? 0));
  const productNames = ["unspecified", "api", "grok-build", "grok-plugins", "grok-chat", "grok-imagine", "grok-voice"];
  const products = oracleAt(config, 7, 2).map((field) => {
    const entry = oracleFields(field.value);
    const product = Number(oracleScalar(entry, 1));
    const usage = oracleFloat(entry, 2) ?? 0;
    return { id: `product:${productNames[product] ?? `unknown-${product}`}`, percentUsed: Math.min(100, Math.max(0, usage)) };
  });
  const prepaid = oracleMessage(config, 12);
  const credits = prepaid ? Number(oracleScalar(prepaid, 1) ?? 0n) : null;
  return {
    operation: consumerOperation,
    accountBinding,
    periodType,
    startAt: startAt ?? null,
    resetAt: endAt ?? null,
    percentUsed,
    percentRemaining: 100 - percentUsed,
    percentageField: "config.creditUsagePercent",
    percentageOmitted: explicitPercent === undefined,
    resetField: endAt ? "config.currentPeriod.end" : null,
    products,
    credits,
  };
}

async function consumerOracle() {
  const auth = await selectOracleAuth();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(consumerQuotaUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.key}`,
        Accept: "*/*",
        "Content-Type": "application/grpc-web+proto",
        Origin: "https://grok.com",
        Referer: "https://grok.com/?_s=usage",
        "x-grpc-web": "1",
        "x-user-agent": "connect-es/2.1.1",
      },
      body: Uint8Array.from([0, 0, 0, 0, 0]),
      signal: controller.signal,
    });
    if (!response.ok) fail(`consumerOracle received HTTP ${response.status}`);
    const headerStatus = Number(response.headers.get("grpc-status") ?? 0);
    if (headerStatus !== 0) fail(`consumerOracle received gRPC status ${headerStatus}`);
    return normalizeOraclePayload(oracleGrpcPayload(await oracleResponseBytes(response)), auth.accountBinding);
  } finally {
    clearTimeout(timer);
  }
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
  fakeGrokCliPath = join(tempRoot, "grok-refresh-sentinel");
  fakeGrokCliCountPath = join(tempRoot, "grok-refresh-count.txt");
  await writeFile(fakeGrokCliCountPath, "");
  await writeFile(fakeGrokCliPath, '#!/bin/sh\nprintf x >> "$BABY_MENU_GROK_E2E_CLI_COUNT"\nexit 7\n');
  await chmod(fakeGrokCliPath, 0o755);
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
      GROK_CLI_PATH: fakeGrokCliPath,
      BABY_MENU_GROK_E2E_CLI_COUNT: fakeGrokCliCountPath,
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
              operation: root.getAttribute("data-operation"),
              source: root.getAttribute("data-source"),
              sourceVersion: root.getAttribute("data-source-version"),
              periodType: root.getAttribute("data-period"),
              percentUsed: root.getAttribute("data-percent-used"),
              percentRemaining: root.getAttribute("data-percent-remaining"),
              percentageField: root.getAttribute("data-percentage-field"),
              resetAt: root.getAttribute("data-reset-at"),
              resetField: root.getAttribute("data-reset-field"),
              products: root.getAttribute("data-products"),
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
            operation: region.querySelector("[data-grok-operation]")?.getAttribute("data-grok-operation") || null,
            source: region.querySelector("[data-grok-source]")?.getAttribute("data-grok-source") || null,
            sourceVersion: region.querySelector("[data-grok-source-version]")?.getAttribute("data-grok-source-version") || null,
            periodType: region.querySelector("[data-grok-period]")?.getAttribute("data-grok-period") || null,
            percentUsed: region.querySelector("[data-grok-percent-used]")?.getAttribute("data-grok-percent-used") || null,
            percentRemaining: region.querySelector("[data-grok-percent-remaining]")?.getAttribute("data-grok-percent-remaining") || null,
            percentageField: region.querySelector("[data-grok-percentage-field]")?.getAttribute("data-grok-percentage-field") || null,
            resetAt: region.querySelector("[data-grok-reset-at]")?.getAttribute("data-grok-reset-at") || null,
            resetField: region.querySelector("[data-grok-reset-field]")?.getAttribute("data-grok-reset-field") || null,
            products: region.querySelector("[data-grok-products]")?.getAttribute("data-grok-products") || null,
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
  if (view.failureKind === "quota_unreported") {
    fail("Baby Menu rendered quota_unreported while official Grok consumer quota is usable");
  }
  if (view.state !== "success") fail(`expected consumer quota success, rendered ${view.state}`);
  if (view.operation !== official.operation || view.operation !== consumerOperation) {
    fail("rendered operation does not match official Grok consumer quota");
  }
  if (view.source !== "grok-credits-grpc-web" || view.sourceVersion !== "1" || view.cacheSchema !== "2") {
    fail("rendered exact-source schema does not match official Grok consumer quota");
  }
  if (view.periodType !== official.periodType) fail("rendered period does not match official Grok consumer quota");
  if (Number(view.percentUsed) !== official.percentUsed || Number(view.percentRemaining) !== official.percentRemaining) {
    fail("rendered percentage does not match official Grok consumer quota");
  }
  if (view.percentageField !== official.percentageField) {
    fail("rendered percentage provenance does not match official Grok consumer quota");
  }
  let products;
  try {
    products = JSON.parse(view.products || "[]");
  } catch {
    fail("rendered product usage does not match official Grok consumer quota");
  }
  if (JSON.stringify(products) !== JSON.stringify(official.products)) {
    fail("rendered product usage does not match official Grok consumer quota");
  }
  if ((view.resetAt || null) !== official.resetAt || (view.resetField || null) !== official.resetField) {
    fail("rendered reset does not match official Grok consumer quota");
  }
  if (view.stale !== "false" || view.warningKind !== "none") {
    fail("rendered freshness does not match official Grok consumer quota");
  }
  if (!text.includes(`${Math.round(official.percentUsed)}% used`) ||
      !text.includes(`${Math.round(official.percentRemaining)}% left`)) {
    fail("rendered display rounding does not match official Grok consumer quota");
  }
  if (official.credits !== null) {
    if (!text.includes(`${official.credits} credits`)) fail("rendered credits do not match official Grok consumer quota");
  } else if (/\b\d+(?:\.\d+)? credits\b/i.test(text)) {
    fail("rendered credits do not match official Grok consumer quota");
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
  const failures = [];
  try {
    cdp?.socket.close();
  } catch (error) {
    failures.push(error);
  }
  for (const operation of [
    () => stopDevProcess(),
    () => cleanE2EDatabase(),
    () => rm(join(rootDir, ".cache", "baby-menu", "server-actions", "grok-quota-e2e"), { recursive: true, force: true }),
    () => tempRoot ? rm(tempRoot, { recursive: true, force: true }) : Promise.resolve(),
  ]) {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) throw failures[0];
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

function hasOwnedProcessGroupMember(pgid) {
  const result = spawnSync("/bin/ps", ["-axo", "pgid=,uid="], { encoding: "utf8" });
  if (result.error || result.status !== 0) return true;
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  return result.stdout.split("\n").some((line) => {
    const [rawPgid, rawUid] = line.trim().split(/\s+/);
    return Number(rawPgid) === pgid && (uid === undefined || Number(rawUid) === uid);
  });
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      if (error?.code === "EPERM" && !hasOwnedProcessGroupMember(pid)) return true;
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
  if (!status.present || status.schemaVersion !== 2) fail("cache migration did not produce schema version 2");
  if (status.source !== "grok-credits-grpc-web" || status.sourceVersion !== 1) {
    fail("cache source does not match official Grok consumer quota");
  }
  if (status.operation !== official.operation) fail("cache operation does not match official Grok consumer quota");
  if (!status.identityScopeEqual) fail("cache identity/scope does not equal the consumerOracle principal");
  if (status.periodType !== official.periodType) fail("cache period does not match official Grok consumer quota");
  if (status.percentageField !== official.percentageField) {
    fail("cache percentage provenance does not match official Grok consumer quota");
  }
  if ((status.resetField || null) !== official.resetField) {
    fail("cache reset provenance does not match official Grok consumer quota");
  }
  const expectedCreditsSource = official.credits === null ? "" : "config.prepaidBalance.val";
  if (status.creditsSourceField !== expectedCreditsSource) {
    fail("cache credit provenance does not match official Grok consumer quota");
  }
}

async function main() {
  if (process.platform !== "darwin") fail("Grok popover E2E requires macOS");
  const healthyAuthBefore = await captureGrokAuthIntegrity({
    grokHome,
    authPath: process.env.GROK_AUTH_PATH,
    inlineAuthJson: process.env.GROK_AUTH_JSON,
  });
  const startupOfficial = await consumerOracle();
  const extensionsDir = await prepareExtensionWorkspace();
  await cleanE2EDatabase();
  seedLegacyCache();
  await startApp(extensionsDir);

  const startupView = await waitForCompletedRefresh(1, null);
  const startupLifecycle = assertLifecycleCount(1, "startup");
  assertMatchesOfficial(startupView, startupOfficial);
  const startupCacheStatus = readSanitizedCacheStatus(startupOfficial.accountBinding);
  assertCacheMigration(startupCacheStatus, startupOfficial);
  if (!Number.isFinite(Date.parse(startupView.checkedAt))) {
    fail("startup acquisition did not visibly settle with a safe checkedAt timestamp");
  }

  let intervalView;
  let intervalOfficial = startupOfficial;
  if (!installedSourceMode) {
    intervalView = await waitForCompletedRefresh(2, startupView.checkedAt);
    intervalOfficial = await consumerOracle();
    if (intervalOfficial.accountBinding !== startupOfficial.accountBinding) fail("consumerOracle principal changed during E2E");
    assertLifecycleCount(2, "interval");
    assertMatchesOfficial(intervalView, intervalOfficial);
    if (!Number.isFinite(Date.parse(intervalView.checkedAt)) || intervalView.checkedAt === startupView.checkedAt) {
      fail("interval acquisition did not visibly settle with a new safe checkedAt timestamp");
    }
  }

  const manualOfficial = await consumerOracle();
  if (manualOfficial.accountBinding !== startupOfficial.accountBinding) fail("consumerOracle principal changed during E2E");
  const beforeClickLifecycle = await clickVisibleRefresh();
  const expectedManualLifecycle = beforeClickLifecycle.started + 1;
  const priorView = installedSourceMode ? startupView : intervalView;
  const manualView = await waitForCompletedRefresh(expectedManualLifecycle, priorView.checkedAt);
  const manualLifecycle = assertManualLifecycle(beforeClickLifecycle, readSanitizedLifecycle());
  assertMatchesOfficial(manualView, manualOfficial);
  const transitions = await evaluate("window.__grokE2ETransitions");
  if (!transitions.some((entry) => entry.text === "checking" && entry.disabled === true)) {
    fail("manual refresh control never entered its visible checking state");
  }
  if (!Number.isFinite(Date.parse(manualView.checkedAt)) || manualView.checkedAt === priorView.checkedAt) {
    fail("manual acquisition did not visibly settle with a new safe checkedAt timestamp");
  }
  const manualCacheStatus = readSanitizedCacheStatus(manualOfficial.accountBinding);
  assertCacheMigration(manualCacheStatus, manualOfficial);
  if (await readFile(fakeGrokCliCountPath, "utf8")) {
    fail("healthy exact-source E2E unexpectedly launched the conditional refresh command");
  }
  const healthyAuthUnchanged = await grokAuthIntegrityEqual(healthyAuthBefore);
  if (!healthyAuthUnchanged) fail("healthy exact-source E2E modified provider auth");

  await captureScreenshot();

  console.log(JSON.stringify({
    ok: true,
    sourceMode: installedSourceMode ? "installed-widget-copy" : "generated-install",
    oracle: "consumerOracle",
    operationEqual: manualView.operation === manualOfficial.operation,
    identityScopeEqual: manualCacheStatus.identityScopeEqual,
    periodEqual: manualView.periodType === manualOfficial.periodType,
    globalPercentageEqual: Number(manualView.percentUsed) === manualOfficial.percentUsed,
    productUsageEqual: manualView.products === JSON.stringify(manualOfficial.products),
    resetEqual: (manualView.resetAt || null) === manualOfficial.resetAt,
    startupRefreshes: 1,
    intervalRefreshes: installedSourceMode ? "not-shortened" : 1,
    manualRefreshes: 1,
    startupAcquisitionSettled: startupLifecycle.stage === "action-resolved",
    intervalAcquisitionSettled: !installedSourceMode,
    manualAcquisitionSettled: manualLifecycle.stage === "action-resolved",
    renderedState: manualView.state,
    renderedFailureKind: manualView.failureKind,
    cacheStatus: "schema-v2-exact-source-principal-bound",
    healthyCliPreflightObserved: false,
    healthyAuthUnchanged,
    conditionalOfficialRefreshCoveredByFixtures: true,
    browserCookieImportAllowed: false,
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
