import type {
  KimiCredentialSource,
  KimiQuotaDiagnostic,
  KimiQuotaErrorCode,
  KimiQuotaFailure,
  KimiQuotaResult,
  KimiQuotaSnapshot,
  KimiQuotaWindow,
} from "../shared/contracts";
import type { ExtensionDatabase } from "./extension-database";
import { KimiQuotaParseError, normalizeKimiUsage } from "./kimi-quota-parser";

const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const RESPONSE_LIMIT_BYTES = 262_144;
const MAX_TIMEOUT_MS = 15_000;
const SESSION_CACHE_MAX_AGE_MS = 5 * 60 * 60 * 1000;
const WEEKLY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_TABLE = "kimi_quota_cache";
const LAST_GOOD_KEY = "last_good";
const CURRENT_RESULT_KEY = "current_result";

const ERROR_DETAILS: Record<KimiQuotaErrorCode, Pick<KimiQuotaFailure, "category" | "message">> = {
  kimi_credential_unavailable: { category: "credential", message: "Kimi credential is unavailable" },
  unsupported_credential_type: { category: "credential", message: "Kimi credential type is unsupported" },
  credential_resolution_failed: { category: "credential", message: "Kimi credential could not be resolved" },
  request_timeout: { category: "transport", message: "Kimi quota request timed out" },
  network_unavailable: { category: "transport", message: "Kimi quota network is unavailable" },
  tls_failed: { category: "transport", message: "Kimi quota secure connection failed" },
  redirect_rejected: { category: "request", message: "Kimi quota redirect was rejected" },
  provider_auth_rejected: { category: "credential", message: "Kimi rejected the credential" },
  provider_timeout: { category: "transport", message: "Kimi quota service timed out" },
  provider_rate_limited: { category: "rate_limit", message: "Kimi quota is rate-limited" },
  provider_unavailable: { category: "service", message: "Kimi quota service is unavailable" },
  provider_request_rejected: { category: "request", message: "Kimi quota request was rejected" },
  unexpected_content_type: { category: "parser", message: "Kimi quota returned an unsupported content type" },
  response_too_large: { category: "parser", message: "Kimi quota response was too large" },
  response_invalid_utf8: { category: "parser", message: "Kimi quota response text was invalid" },
  malformed_json: { category: "parser", message: "Kimi quota response JSON was invalid" },
  schema_invalid: { category: "parser", message: "Kimi quota response is unsupported" },
};

const ERROR_CODES = new Set<KimiQuotaErrorCode>(Object.keys(ERROR_DETAILS) as KimiQuotaErrorCode[]);
const RESULT_STATUSES = new Set<KimiQuotaResult["status"]>(["fresh", "stale", "auth_required", "rate_limited", "error"]);
const WINDOW_KINDS = new Set<KimiQuotaWindow["kind"]>(["session", "weekly", "unknown"]);
const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "EPROTO",
]);

export type KimiCredentialResolution =
  | { status: "available"; apiKey: string; source: KimiCredentialSource }
  | { status: "unavailable" }
  | { status: "unsupported" };

export type KimiCredentialResolver = {
  resolveCredential: (signal?: AbortSignal) => Promise<KimiCredentialResolution>;
};

export type KimiQuotaLogEvent =
  | { event: "acquisition_started" }
  | { event: "credential_state"; available: boolean; source?: KimiCredentialSource }
  | { event: "request_completed"; httpStatus: number }
  | { event: "normalization_succeeded"; windowIds: string[] }
  | { event: "normalization_failed"; code: KimiQuotaErrorCode }
  | { event: "cache_used"; ageMs: number; windowIds: string[] };

export type KimiQuotaBroker = {
  acquire: (options?: { force?: boolean; maxAgeMs?: number }) => Promise<KimiQuotaResult>;
  readCached: () => KimiQuotaResult | undefined;
};

type CreateKimiQuotaBrokerOptions = {
  db: ExtensionDatabase;
  credentialResolver: KimiCredentialResolver;
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  userAgent?: string;
  logger?: (event: KimiQuotaLogEvent) => void;
};

class KimiAcquisitionFailure extends Error {
  constructor(
    readonly code: KimiQuotaErrorCode,
    readonly httpStatus?: number,
    readonly retryAt?: string,
    readonly credentialSource?: KimiCredentialSource,
  ) {
    super(code);
    this.name = "KimiAcquisitionFailure";
  }
}

class KimiDeadlineError extends Error {}

export function createKimiQuotaBroker(options: CreateKimiQuotaBrokerOptions): KimiQuotaBroker {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1, options.timeoutMs ?? MAX_TIMEOUT_MS));
  const userAgent = normalizeUserAgent(options.userAgent);
  let inFlight: Promise<KimiQuotaResult> | null = null;

  ensureCacheTable(options.db);

  const emit = (event: KimiQuotaLogEvent): void => {
    try {
      options.logger?.(event);
    } catch {
      // Observability must never change acquisition or expose richer errors.
    }
  };

  const acquire = async (acquireOptions: { force?: boolean; maxAgeMs?: number } = {}): Promise<KimiQuotaResult> => {
    if (!acquireOptions.force && isFiniteNonnegative(acquireOptions.maxAgeMs)) {
      const lastGood = readSnapshot(options.db, LAST_GOOD_KEY);
      if (lastGood && now() - Date.parse(lastGood.refreshedAt) <= acquireOptions.maxAgeMs) {
        return readResult(options.db, CURRENT_RESULT_KEY) ?? freshResult(lastGood, lastGood.refreshedAt);
      }
    }

    if (inFlight) return inFlight;
    inFlight = acquireLive().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const acquireLive = async (): Promise<KimiQuotaResult> => {
    emit({ event: "acquisition_started" });
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let deadlineReached = false;

    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        deadlineReached = true;
        controller.abort();
        reject(new KimiDeadlineError());
      }, timeoutMs);
      timeout.unref?.();
    });

    let result: KimiQuotaResult;
    try {
      result = await Promise.race([attempt(controller.signal), deadline]);
    } catch (error) {
      const failure = error instanceof KimiAcquisitionFailure
        ? error
        : new KimiAcquisitionFailure(deadlineReached || error instanceof KimiDeadlineError ? "request_timeout" : classifyTransportError(error));
      result = failureResult(failure, now());
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    return applyCachePolicy(options.db, result, now(), emit);
  };

  const attempt = async (signal: AbortSignal): Promise<KimiQuotaResult> => {
    let credential: KimiCredentialResolution;
    try {
      credential = await options.credentialResolver.resolveCredential(signal);
    } catch {
      throwIfAborted(signal);
      throw new KimiAcquisitionFailure("credential_resolution_failed");
    }
    throwIfAborted(signal);
    if (credential.status === "unsupported") {
      emit({ event: "credential_state", available: false });
      return failureResult(new KimiAcquisitionFailure("unsupported_credential_type"), now());
    }
    if (credential.status === "unavailable" || !credential.apiKey.trim()) {
      emit({ event: "credential_state", available: false });
      return failureResult(new KimiAcquisitionFailure("kimi_credential_unavailable"), now());
    }

    const apiKey = credential.apiKey;
    const credentialSource = credential.source;
    const failure = (code: KimiQuotaErrorCode, httpStatus?: number, retryAt?: string) =>
      new KimiAcquisitionFailure(code, httpStatus, retryAt, credentialSource);
    emit({ event: "credential_state", available: true, source: credentialSource });

    let response: Response;
    try {
      response = await fetchImpl(KIMI_USAGE_URL, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          "User-Agent": userAgent,
        },
      });
    } catch (error) {
      if (signal.aborted) throw failure("request_timeout");
      throw failure(classifyTransportError(error));
    }

    emit({ event: "request_completed", httpStatus: response.status });
    if (response.status >= 300 && response.status < 400) {
      throw failure("redirect_rejected", response.status);
    }
    if (response.status === 401 || response.status === 403) {
      throw failure("provider_auth_rejected", response.status);
    }
    if (response.status === 408) throw failure("provider_timeout", response.status);
    if (response.status === 429) {
      throw failure("provider_rate_limited", response.status, parseRetryAfter(response.headers.get("retry-after"), now()));
    }
    if (response.status >= 500 && response.status <= 599) {
      throw failure("provider_unavailable", response.status);
    }
    if (response.status >= 400 && response.status <= 499) {
      throw failure("provider_request_rejected", response.status);
    }
    if (response.status !== 200) throw failure("provider_request_rejected", response.status);

    const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (mediaType !== "application/json") throw failure("unexpected_content_type", response.status);
    const declaredLength = response.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength.trim()) && Number(declaredLength) > RESPONSE_LIMIT_BYTES) {
      await cancelBody(response);
      throw failure("response_too_large", response.status);
    }

    let body: Uint8Array;
    try {
      body = await readBoundedBody(response, signal);
    } catch (error) {
      if (error instanceof KimiAcquisitionFailure) {
        throw failure(error.code, error.httpStatus, error.retryAt);
      }
      if (signal.aborted) throw failure("request_timeout");
      throw failure(classifyTransportError(error));
    }

    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch {
      throw failure("response_invalid_utf8", response.status);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw failure("malformed_json", response.status);
    }

    let snapshot: KimiQuotaSnapshot;
    try {
      snapshot = normalizeKimiUsage(payload, new Date(now()).toISOString(), credentialSource);
    } catch (error) {
      emit({ event: "normalization_failed", code: error instanceof KimiQuotaParseError ? error.code : "schema_invalid" });
      throw failure("schema_invalid", response.status);
    }
    emit({ event: "normalization_succeeded", windowIds: snapshot.windows.map((window) => window.id) });
    return freshResult(snapshot, snapshot.refreshedAt);
  };

  return {
    acquire,
    readCached: () => readResult(options.db, CURRENT_RESULT_KEY),
  };
}

async function readBoundedBody(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new KimiAcquisitionFailure("response_too_large", response.status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Size rejection is authoritative even if cancelling the stream fails.
  }
}

function applyCachePolicy(
  db: ExtensionDatabase,
  current: KimiQuotaResult,
  nowMs: number,
  emit: (event: KimiQuotaLogEvent) => void,
): KimiQuotaResult {
  if (current.status === "fresh" && current.snapshot) {
    db.transaction(() => {
      writeCacheValue(db, LAST_GOOD_KEY, current.snapshot, nowMs);
      writeCacheValue(db, CURRENT_RESULT_KEY, current, nowMs);
    });
    return current;
  }

  const code = current.error?.code;
  if (code && isDefinitiveAuth(code)) {
    db.transaction(() => {
      db.run(`DELETE FROM ${CACHE_TABLE} WHERE key = ?`, [LAST_GOOD_KEY]);
      writeCacheValue(db, CURRENT_RESULT_KEY, current, nowMs);
    });
    return current;
  }

  if (code && isStaleEligible(code)) {
    const cached = readSnapshot(db, LAST_GOOD_KEY);
    if (cached) {
      const windows = eligibleStaleWindows(cached, nowMs);
      if (windows.length > 0) {
        const stale: KimiQuotaResult = {
          status: "stale",
          stale: true,
          source: "cache",
          ...(current.credentialSource ? { credentialSource: current.credentialSource } : {}),
          checkedAt: current.checkedAt,
          snapshot: { ...cached, windows },
          error: current.error,
          ...(current.retryAt ? { retryAt: current.retryAt } : {}),
        };
        writeCacheValue(db, CURRENT_RESULT_KEY, stale, nowMs);
        emit({ event: "cache_used", ageMs: Math.max(0, nowMs - Date.parse(cached.refreshedAt)), windowIds: windows.map((window) => window.id) });
        return stale;
      }
    }
  }

  writeCacheValue(db, CURRENT_RESULT_KEY, current, nowMs);
  return current;
}

function eligibleStaleWindows(snapshot: KimiQuotaSnapshot, nowMs: number): KimiQuotaWindow[] {
  const ageMs = Math.max(0, nowMs - Date.parse(snapshot.refreshedAt));
  return snapshot.windows.filter((window) => {
    if (window.resetsAt) return Date.parse(window.resetsAt) > nowMs;
    if (window.kind === "weekly") return ageMs < WEEKLY_CACHE_MAX_AGE_MS;
    return ageMs < SESSION_CACHE_MAX_AGE_MS;
  });
}

function freshResult(snapshot: KimiQuotaSnapshot, checkedAt: string): KimiQuotaResult {
  return {
    status: "fresh",
    stale: false,
    source: "api",
    credentialSource: snapshot.credentialSource,
    checkedAt,
    snapshot,
  };
}

function failureResult(failure: KimiAcquisitionFailure, nowMs: number): KimiQuotaResult {
  const error = createFailure(failure.code, failure.httpStatus);
  const status: KimiQuotaResult["status"] = isDefinitiveAuth(failure.code)
    ? "auth_required"
    : failure.code === "provider_rate_limited"
      ? "rate_limited"
      : "error";
  return {
    status,
    stale: false,
    source: "api",
    ...(failure.credentialSource ? { credentialSource: failure.credentialSource } : {}),
    checkedAt: new Date(nowMs).toISOString(),
    error,
    ...(failure.retryAt ? { retryAt: failure.retryAt } : {}),
  };
}

function createFailure(code: KimiQuotaErrorCode, httpStatus?: number): KimiQuotaFailure {
  return {
    code,
    ...ERROR_DETAILS[code],
    ...(typeof httpStatus === "number" ? { httpStatus } : {}),
  };
}

function isDefinitiveAuth(code: KimiQuotaErrorCode): boolean {
  return code === "kimi_credential_unavailable" || code === "unsupported_credential_type" || code === "provider_auth_rejected";
}

function isStaleEligible(code: KimiQuotaErrorCode): boolean {
  return [
    "credential_resolution_failed",
    "request_timeout",
    "network_unavailable",
    "tls_failed",
    "provider_timeout",
    "provider_rate_limited",
    "provider_unavailable",
    "unexpected_content_type",
    "response_too_large",
    "response_invalid_utf8",
    "malformed_json",
    "schema_invalid",
  ].includes(code);
}

function classifyTransportError(error: unknown): KimiQuotaErrorCode {
  const code = nestedErrorCode(error);
  if (code && TLS_ERROR_CODES.has(code)) return "tls_failed";
  return "network_unavailable";
}

function nestedErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === "string") return record.code;
  return nestedErrorCode(record.cause);
}

function parseRetryAfter(value: string | null, receiptMs: number): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^[+-]?\d+$/.test(trimmed)) {
    if (!/^\d+$/.test(trimmed)) return undefined;
    const seconds = Number(trimmed);
    const retryMs = receiptMs + seconds * 1000;
    return Number.isFinite(retryMs) ? new Date(retryMs).toISOString() : undefined;
  }
  const retryMs = Date.parse(trimmed);
  return Number.isFinite(retryMs) ? new Date(retryMs).toISOString() : undefined;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new KimiAcquisitionFailure("request_timeout");
}

function normalizeUserAgent(value: string | undefined): string {
  const candidate = value?.trim();
  return candidate && /^[A-Za-z][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/.test(candidate) ? candidate : "baby-menu/unknown";
}

function ensureCacheTable(db: ExtensionDatabase): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
}

function writeCacheValue(db: ExtensionDatabase, key: string, value: unknown, nowMs: number): void {
  db.run(
    `INSERT INTO ${CACHE_TABLE} (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), nowMs],
  );
}

function readSnapshot(db: ExtensionDatabase, key: string): KimiQuotaSnapshot | undefined {
  const value = readCacheJson(db, key);
  return sanitizeSnapshot(value);
}

function readResult(db: ExtensionDatabase, key: string): KimiQuotaResult | undefined {
  const value = readCacheJson(db, key);
  if (!isRecord(value) || !RESULT_STATUSES.has(value.status as KimiQuotaResult["status"]) || typeof value.stale !== "boolean") return undefined;
  if (value.source !== "api" && value.source !== "cache") return undefined;
  const checkedAt = normalizedInstant(value.checkedAt);
  if (!checkedAt) return undefined;
  const snapshot = sanitizeSnapshot(value.snapshot);
  const credentialSource = sanitizeCredentialSource(value.credentialSource) ?? snapshot?.credentialSource;
  const error = sanitizeFailure(value.error);
  const retryAt = normalizedInstant(value.retryAt);
  if (value.status === "fresh" && !snapshot) return undefined;
  if (value.status !== "fresh" && value.status !== "stale" && !error) return undefined;
  return {
    status: value.status as KimiQuotaResult["status"],
    stale: value.stale,
    source: value.source,
    ...(credentialSource ? { credentialSource } : {}),
    checkedAt,
    ...(snapshot ? { snapshot } : {}),
    ...(error ? { error } : {}),
    ...(retryAt ? { retryAt } : {}),
  };
}

function readCacheJson(db: ExtensionDatabase, key: string): unknown {
  const row = db.get<{ value: string }>(`SELECT value FROM ${CACHE_TABLE} WHERE key = ?`, [key]);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

function sanitizeSnapshot(value: unknown): KimiQuotaSnapshot | undefined {
  if (!isRecord(value) || value.provider !== "kimi" || value.label !== "Kimi" || value.source !== "api") return undefined;
  const credentialSource = sanitizeCredentialSource(value.credentialSource) ?? "pi-kimi-coding";
  const refreshedAt = normalizedInstant(value.refreshedAt);
  if (!refreshedAt || !Array.isArray(value.windows)) return undefined;
  const windows = value.windows.map(sanitizeWindow).filter((window): window is KimiQuotaWindow => Boolean(window));
  if (windows.length === 0) return undefined;
  const diagnostics: KimiQuotaDiagnostic[] = [];
  if (Array.isArray(value.diagnostics)) {
    for (const diagnostic of value.diagnostics) {
      if (!isRecord(diagnostic)) continue;
      if (diagnostic.code === "limits_invalid") diagnostics.push({ code: "limits_invalid" });
      if (diagnostic.code === "limit_detail_invalid" && Number.isInteger(diagnostic.index) && Number(diagnostic.index) >= 1) {
        diagnostics.push({ code: "limit_detail_invalid", index: Number(diagnostic.index) });
      }
    }
  }
  return {
    provider: "kimi",
    label: "Kimi",
    source: "api",
    credentialSource,
    refreshedAt,
    windows,
    ...(diagnostics.length ? { diagnostics } : {}),
  };
}

function sanitizeCredentialSource(value: unknown): KimiCredentialSource | undefined {
  return value === "pi-kimi-coding" || value === "kimi-code-cli" ? value : undefined;
}

function sanitizeWindow(value: unknown): KimiQuotaWindow | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || typeof value.label !== "string" || !value.label) return undefined;
  if (!WINDOW_KINDS.has(value.kind as KimiQuotaWindow["kind"])) return undefined;
  if (!validPercentage(value.percentUsed) || !validPercentage(value.percentRemaining)) return undefined;
  const expectedRemaining = Math.min(100, Math.max(0, 100 - value.percentUsed));
  if (Math.abs(expectedRemaining - value.percentRemaining) > Number.EPSILON * 100) return undefined;
  const resetsAt = normalizedInstant(value.resetsAt);
  const windowSeconds = typeof value.windowSeconds === "number" && Number.isFinite(value.windowSeconds) && value.windowSeconds > 0
    ? value.windowSeconds
    : undefined;
  return {
    id: value.id,
    label: value.label,
    kind: value.kind as KimiQuotaWindow["kind"],
    percentUsed: value.percentUsed,
    percentRemaining: value.percentRemaining,
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowSeconds ? { windowSeconds } : {}),
  };
}

function sanitizeFailure(value: unknown): KimiQuotaFailure | undefined {
  if (!isRecord(value) || !ERROR_CODES.has(value.code as KimiQuotaErrorCode)) return undefined;
  const code = value.code as KimiQuotaErrorCode;
  const httpStatus = typeof value.httpStatus === "number" && Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599
    ? value.httpStatus
    : undefined;
  return createFailure(code, httpStatus);
}

function normalizedInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time).toISOString();
}

function validPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isFiniteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
