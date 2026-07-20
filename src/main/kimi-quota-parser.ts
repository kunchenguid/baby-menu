import type { KimiQuotaDiagnostic, KimiQuotaSnapshot, KimiQuotaWindow } from "../shared/contracts";

const JSON_DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const RFC3339_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
const FIVE_HOURS_SECONDS = 18_000;
const RESET_FIELDS = ["resetTime", "resetAt", "reset_time", "reset_at"] as const;
const TIME_UNIT_SECONDS: Record<string, number> = {
  TIME_UNIT_SECOND: 1,
  TIME_UNIT_MINUTE: 60,
  TIME_UNIT_HOUR: 3_600,
  TIME_UNIT_DAY: 86_400,
};

export class KimiQuotaParseError extends Error {
  readonly code = "schema_invalid" as const;

  constructor() {
    super("Kimi quota response schema is invalid");
    this.name = "KimiQuotaParseError";
  }
}

type NormalizedDetail = Pick<KimiQuotaWindow, "percentUsed" | "percentRemaining" | "resetsAt">;

export function normalizeKimiUsage(payload: unknown, refreshedAt: string): KimiQuotaSnapshot {
  if (!isRecord(payload)) throw new KimiQuotaParseError();

  const weeklyDetail = normalizeDetail(payload.usage);
  if (!weeklyDetail) throw new KimiQuotaParseError();

  const windows: KimiQuotaWindow[] = [
    compactWindow({
      id: "weekly",
      label: "week",
      kind: "weekly",
      ...weeklyDetail,
    }),
  ];
  const diagnostics: KimiQuotaDiagnostic[] = [];
  let fiveHourAssigned = false;

  let limits: unknown[] = [];
  if (payload.limits !== undefined && payload.limits !== null) {
    if (Array.isArray(payload.limits)) limits = payload.limits;
    else diagnostics.push({ code: "limits_invalid" });
  }

  limits.forEach((entry, zeroBasedIndex) => {
    const index = zeroBasedIndex + 1;
    const detail = isRecord(entry) ? normalizeDetail(entry.detail) : null;
    if (!detail) {
      diagnostics.push({ code: "limit_detail_invalid", index });
      return;
    }

    const windowSeconds = normalizeWindowSeconds(isRecord(entry) ? entry.window : undefined);
    if (windowSeconds === FIVE_HOURS_SECONDS && !fiveHourAssigned) {
      fiveHourAssigned = true;
      windows.push(
        compactWindow({
          id: "five_hour",
          label: "session",
          kind: "session",
          windowSeconds,
          ...detail,
        }),
      );
      return;
    }

    windows.push(
      compactWindow({
        id: `limit:${index}`,
        label: `limit ${index}`,
        kind: "unknown",
        windowSeconds,
        ...detail,
      }),
    );
  });

  return {
    provider: "kimi",
    label: "Kimi",
    source: "api",
    refreshedAt,
    windows,
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

function normalizeDetail(value: unknown): NormalizedDetail | null {
  if (!isRecord(value)) return null;
  const limit = nonnegativeNumber(value.limit);
  if (limit === null || limit <= 0) return null;

  const explicitUsed = nonnegativeNumber(value.used);
  const remaining = nonnegativeNumber(value.remaining);
  let used: number;
  if (explicitUsed !== null) used = explicitUsed;
  else if (remaining !== null) used = Math.max(0, limit - remaining);
  else return null;

  const percentUsed = clamp((used / limit) * 100);
  const percentRemaining = clamp(100 - percentUsed);
  const resetsAt = normalizeReset(value);
  return {
    percentUsed,
    percentRemaining,
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function normalizeWindowSeconds(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const duration = numericScalar(value.duration);
  if (duration === null || duration <= 0 || typeof value.timeUnit !== "string") return undefined;
  const multiplier = TIME_UNIT_SECONDS[value.timeUnit];
  if (!multiplier) return undefined;
  const seconds = duration * multiplier;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function normalizeReset(detail: Record<string, unknown>): string | undefined {
  for (const field of RESET_FIELDS) {
    const normalized = rfc3339ToUtc(detail[field]);
    if (normalized) return normalized;
  }
  return undefined;
}

function rfc3339ToUtc(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const match = RFC3339_PATTERN.exec(value);
  if (!match) return undefined;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = Number(offsetHourText ?? 0);
  const offsetMinute = Number(offsetMinuteText ?? 0);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 60 || offsetHour > 23 || offsetMinute > 59) {
    return undefined;
  }

  // Date.UTC treats years 0-99 as 1900-1999, so set the full year explicitly.
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, Math.min(second, 59), Number(fraction.slice(0, 3).padEnd(3, "0")));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute
  ) {
    return undefined;
  }

  const offset = zone === "Z" ? 0 : (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute) * 60_000;
  const utcMs = local.getTime() - offset + (second === 60 ? 1_000 : 0);
  if (!Number.isFinite(utcMs)) return undefined;
  try {
    return new Date(utcMs).toISOString();
  } catch {
    return undefined;
  }
}

function numericScalar(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
  if (!JSON_DECIMAL_PATTERN.test(trimmed)) return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function nonnegativeNumber(value: unknown): number | null {
  const number = numericScalar(value);
  return number !== null && number >= 0 ? number : null;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function compactWindow(window: KimiQuotaWindow): KimiQuotaWindow {
  return Object.fromEntries(Object.entries(window).filter(([, value]) => value !== undefined)) as KimiQuotaWindow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
