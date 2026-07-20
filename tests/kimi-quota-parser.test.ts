import { describe, expect, it } from "vitest";
import { KimiQuotaParseError, normalizeKimiUsage } from "../src/main/kimi-quota-parser";

const REFRESHED_AT = "2026-07-19T10:30:00.000Z";

function parse(payload: unknown) {
  return normalizeKimiUsage(payload, REFRESHED_AT);
}

describe("Kimi quota response normalization", () => {
  it("normalizes the required weekly detail without inventing optional fields", () => {
    const snapshot = parse({ usage: { limit: 137, used: 43 } });

    expect(snapshot).toEqual({
      provider: "kimi",
      label: "Kimi",
      source: "api",
      credentialSource: "pi-kimi-coding",
      refreshedAt: REFRESHED_AT,
      windows: [
        {
          id: "weekly",
          label: "week",
          kind: "weekly",
          percentUsed: (43 / 137) * 100,
          percentRemaining: 100 - (43 / 137) * 100,
        },
      ],
    });
  });

  it.each([
    [300, "TIME_UNIT_MINUTE"],
    [18_000, "TIME_UNIT_SECOND"],
    [5, "TIME_UNIT_HOUR"],
  ])("recognizes a five-hour window expressed as %s %s", (duration, timeUnit) => {
    const snapshot = parse({
      usage: { limit: "250", remaining: "175" },
      limits: [{ window: { duration, timeUnit }, detail: { limit: 80, used: 11 } }],
    });

    expect(snapshot.windows.map(({ id, kind, windowSeconds }) => ({ id, kind, windowSeconds }))).toEqual([
      { id: "weekly", kind: "weekly", windowSeconds: undefined },
      { id: "five_hour", kind: "session", windowSeconds: 18_000 },
    ]);
  });

  it("accepts finite numbers and strict JSON-decimal strings, and derives used from remaining", () => {
    const snapshot = parse({
      usage: { limit: " 2.5e2\t", remaining: "1.75e2" },
      limits: [
        {
          window: { duration: "3e2", timeUnit: "TIME_UNIT_MINUTE" },
          detail: { limit: 64, remaining: 48 },
        },
      ],
    });

    expect(snapshot.windows[0]).toMatchObject({ percentUsed: 30, percentRemaining: 70 });
    expect(snapshot.windows[1]).toMatchObject({ percentUsed: 25, percentRemaining: 75, windowSeconds: 18_000 });
  });

  it("prefers explicit used when counters disagree and clamps percentages", () => {
    const snapshot = parse({
      usage: { limit: 20, used: 31, remaining: 19 },
      limits: [{ detail: { limit: 20, used: -0, remaining: 999 } }],
    });

    expect(snapshot.windows[0]).toMatchObject({ percentUsed: 100, percentRemaining: 0 });
    expect(snapshot.windows[1]).toMatchObject({ percentUsed: 0, percentRemaining: 100 });
  });

  it.each([
    [{}, "missing limit"],
    [{ limit: 0, used: 0 }, "zero limit"],
    [{ limit: -5, used: 1 }, "negative limit"],
    [{ limit: "Infinity", used: 1 }, "nonfinite text"],
    [{ limit: "0x20", used: 1 }, "hex text"],
    [{ limit: "", used: 1 }, "empty numeric string"],
    [{ limit: true, used: 1 }, "boolean"],
    [{ limit: 10, used: "NaN" }, "missing usable counter"],
    [{ limit: 10, used: -1 }, "negative counter"],
  ])("rejects an invalid principal detail: %s (%s)", (usage, _description) => {
    expect(() => parse({ usage })).toThrowError(expect.objectContaining({ code: "schema_invalid" }));
  });

  it.each([
    ["resetTime", "2026-08-02T03:04:05.123456Z", "2026-08-02T03:04:05.123Z"],
    ["resetAt", "2026-08-02T11:34:05+08:30", "2026-08-02T03:04:05.000Z"],
    ["reset_time", "2026-08-02T01:04:05-02:00", "2026-08-02T03:04:05.000Z"],
    ["reset_at", "2026-08-02T03:04:05Z", "2026-08-02T03:04:05.000Z"],
  ])("normalizes the %s reset alias to UTC", (field, value, expected) => {
    expect(parse({ usage: { limit: 10, used: 2, [field]: value } }).windows[0]?.resetsAt).toBe(expected);
  });

  it("uses the first valid reset by priority and omits invalid resets", () => {
    const validFallback = parse({
      usage: { limit: 10, used: 2, resetTime: "not-a-date", resetAt: "2026-09-01T00:00:00Z" },
    });
    const invalid = parse({ usage: { limit: 10, used: 2, reset_at: "2026-02-30T00:00:00Z" } });

    expect(validFallback.windows[0]?.resetsAt).toBe("2026-09-01T00:00:00.000Z");
    expect(invalid.windows[0]).not.toHaveProperty("resetsAt");
  });

  it.each([undefined, null, []])("treats %s limits as empty", (limits) => {
    const payload = limits === undefined ? { usage: { limit: 10, used: 2 } } : { usage: { limit: 10, used: 2 }, limits };
    expect(parse(payload).windows.map((window) => window.id)).toEqual(["weekly"]);
  });

  it("ignores a non-array limits value with a bounded diagnostic", () => {
    const snapshot = parse({ usage: { limit: 10, used: 2 }, limits: { secretLooking: "do-not-copy" } });

    expect(snapshot.windows.map((window) => window.id)).toEqual(["weekly"]);
    expect(snapshot.diagnostics).toEqual([{ code: "limits_invalid" }]);
    expect(JSON.stringify(snapshot)).not.toContain("do-not-copy");
  });

  it("keeps unknown windows in wire order, skips malformed entries, and de-duplicates five-hour semantics", () => {
    const snapshot = parse({
      usage: { limit: 91, used: 17, ignoredAccount: "private" },
      limits: [
        { window: { duration: 2, timeUnit: "TIME_UNIT_DAY", extra: "ignored" }, detail: { limit: 41, used: 9 } },
        { detail: { limit: 0, used: 3 } },
        { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: 72, used: 12 } },
        { window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" }, detail: { limit: 66, remaining: 44 } },
        { window: { duration: 8, timeUnit: "FUTURE_UNIT" }, detail: { limit: 55, used: 5 } },
      ],
    });

    expect(snapshot.windows.map(({ id, label, kind, windowSeconds }) => ({ id, label, kind, windowSeconds }))).toEqual([
      { id: "weekly", label: "week", kind: "weekly", windowSeconds: undefined },
      { id: "limit:1", label: "limit 1", kind: "unknown", windowSeconds: 172_800 },
      { id: "five_hour", label: "session", kind: "session", windowSeconds: 18_000 },
      { id: "limit:4", label: "limit 4", kind: "unknown", windowSeconds: 18_000 },
      { id: "limit:5", label: "limit 5", kind: "unknown", windowSeconds: undefined },
    ]);
    expect(snapshot.diagnostics).toEqual([{ code: "limit_detail_invalid", index: 2 }]);
    expect(JSON.stringify(snapshot)).not.toContain("private");
  });

  it("fails when the root is not an object or the principal usage is invalid", () => {
    for (const payload of [null, [], "usage", { limits: [] }, { usage: [] }]) {
      try {
        parse(payload);
        throw new Error("expected parse failure");
      } catch (error) {
        expect(error).toBeInstanceOf(KimiQuotaParseError);
        expect((error as KimiQuotaParseError).code).toBe("schema_invalid");
      }
    }
  });
});
