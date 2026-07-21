import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKimiCredentialResolverChain } from "../src/main/kimi-code-cli-credential-resolver";
import { createExtensionDatabase, type ExtensionDatabase } from "../src/main/extension-database";
import {
  createKimiQuotaBroker,
  type KimiCredentialResolver,
  type KimiQuotaLogEvent,
} from "../src/main/kimi-quota-broker";

const SYNTHETIC_KEY = "kimi-sentinel-credential-c11f28";
const START_MS = Date.parse("2026-07-19T12:00:00.000Z");

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    usage: { limit: 211, used: 59, resetTime: "2026-07-26T12:00:00Z" },
    limits: [
      {
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: { limit: 97, used: 23, resetAt: "2026-07-19T17:00:00Z" },
      },
    ],
    ...overrides,
  };
}

function jsonResponse(payload: unknown = validPayload(), init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", ...Object.fromEntries(new Headers(init.headers)) },
  });
}

function resolver(overrides: Partial<KimiCredentialResolver> = {}): KimiCredentialResolver {
  return {
    resolveCredential: vi.fn(async () => ({
      status: "available" as const,
      source: "pi-kimi-coding" as const,
      apiKey: SYNTHETIC_KEY,
    })),
    ...overrides,
  };
}

function allCacheBytes(db: ExtensionDatabase): string {
  return JSON.stringify(db.query("SELECT key, value, updated_at FROM kimi_quota_cache ORDER BY key"));
}

type LoopbackResponse = {
  status?: number;
  headers?: Record<string, string>;
  chunks?: ReadonlyArray<string | Uint8Array>;
  keepOpen?: boolean;
};

async function throughLoopback<T>(
  response: LoopbackResponse,
  run: (fetchImpl: typeof fetch) => Promise<T>,
): Promise<{
  value: T;
  requestedUrl: string;
  activeResponsesAtCompletion: number;
  liveSocketsAtCompletion: number;
}> {
  const sockets = new Set<Socket>();
  const activeResponses = new Set<ServerResponse>();
  const transportClosedWaiters = new Set<() => void>();
  let requestedUrl = "";
  const settleTransportClosed = (): void => {
    if (sockets.size > 0 || activeResponses.size > 0) return;
    for (const resolve of transportClosedWaiters) resolve();
    transportClosedWaiters.clear();
  };
  const waitForTransportClosed = (): Promise<void> => {
    if (sockets.size === 0 && activeResponses.size === 0) return Promise.resolve();
    return new Promise((resolve) => transportClosedWaiters.add(resolve));
  };
  const server = createServer((_request, serverResponse) => {
    activeResponses.add(serverResponse);
    serverResponse.once("close", () => {
      activeResponses.delete(serverResponse);
      settleTransportClosed();
    });
    serverResponse.writeHead(response.status ?? 200, {
      connection: "close",
      ...response.headers,
    });
    serverResponse.flushHeaders();
    for (const chunk of response.chunks ?? []) serverResponse.write(chunk);
    if (!response.keepOpen) serverResponse.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
      settleTransportClosed();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  try {
    const address = server.address() as AddressInfo;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      const { signal: _signal, ...upstreamInit } = init ?? {};
      const upstream = await fetch(`http://127.0.0.1:${address.port}/coding/v1/usages`, upstreamInit);
      if (!upstream.body) return upstream;
      const reader = upstream.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await reader.read();
          if (chunk.done) {
            await waitForTransportClosed();
            controller.close();
          } else {
            controller.enqueue(chunk.value);
          }
        },
        async cancel(reason) {
          try {
            await reader.cancel(reason);
          } finally {
            await waitForTransportClosed();
          }
        },
      });
      return new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: upstream.headers,
      });
    };
    let activeResponsesAtCompletion = -1;
    let liveSocketsAtCompletion = -1;
    const value = await run(fetchImpl).then((completed) => {
      activeResponsesAtCompletion = activeResponses.size;
      liveSocketsAtCompletion = sockets.size;
      return completed;
    });
    return { value, requestedUrl, activeResponsesAtCompletion, liveSocketsAtCompletion };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("Kimi quota broker transport and privacy", () => {
  let db: ExtensionDatabase;
  let nowMs: number;

  beforeEach(() => {
    db = createExtensionDatabase(":memory:");
    nowMs = START_MS;
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function broker(options: {
    credentialResolver?: KimiCredentialResolver;
    fetch?: typeof fetch;
    timeoutMs?: number;
    logger?: (event: KimiQuotaLogEvent) => void;
  } = {}) {
    return createKimiQuotaBroker({
      db,
      credentialResolver: options.credentialResolver ?? resolver(),
      fetch: options.fetch ?? vi.fn(async () => jsonResponse()),
      now: () => nowMs,
      timeoutMs: options.timeoutMs,
      userAgent: "baby-menu-test/9.7.3",
      logger: options.logger,
    });
  }

  it("makes one exact fixed-origin request with only the required non-device headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse());
    const result = await broker({ fetch: fetchMock }).acquire({ force: true });

    expect(result).toMatchObject({ status: "fresh", stale: false, source: "api" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(input).toBe("https://api.kimi.com/coding/v1/usages");
    expect(new URL(input)).toMatchObject({ protocol: "https:", hostname: "api.kimi.com", port: "", pathname: "/coding/v1/usages", search: "", hash: "" });
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("omit");
    expect(new Headers(init.headers)).toEqual(
      new Headers({
        authorization: `Bearer ${SYNTHETIC_KEY}`,
        accept: "application/json",
        "user-agent": "baby-menu-test/9.7.3",
      }),
    );
    const headers = [...new Headers(init.headers).keys()];
    expect(headers).not.toContain("cookie");
    expect(headers.some((name) => /device|identity|session/i.test(name))).toBe(false);
  });

  it("does not request quota when the credential is missing or has an unsupported stored type", async () => {
    for (const credentialResolver of [
      resolver({ resolveCredential: vi.fn(async () => ({ status: "unavailable" as const })) }),
      resolver({ resolveCredential: vi.fn(async () => ({ status: "unsupported" as const })) }),
    ]) {
      const fetchMock = vi.fn(async () => jsonResponse());
      const result = await broker({ credentialResolver, fetch: fetchMock }).acquire({ force: true });

      expect(result.status).toBe("auth_required");
      expect(result.error?.code).toMatch(/kimi_credential_unavailable|unsupported_credential_type/);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it.each([
    ["transport", vi.fn(async () => Promise.reject(new TypeError("offline"))), "network_unavailable"],
    ["decoding", vi.fn(async () => new Response("not json", { headers: { "content-type": "text/plain" } })), "unexpected_content_type"],
    ["server", vi.fn(async () => new Response("", { status: 503 })), "provider_unavailable"],
  ])("does not switch credentials after a %s failure", async (_kind, fetchMock, errorCode) => {
    const primary = resolver();
    const cliFallback = resolver({
      resolveCredential: vi.fn(async () => ({
        status: "available" as const,
        source: "kimi-code-cli" as const,
        apiKey: "unused-cli-fallback",
      })),
    });
    const credentialResolver = createKimiCredentialResolverChain([primary, cliFallback]);

    const result = await broker({ credentialResolver, fetch: fetchMock }).acquire({ force: true });

    expect(result.error?.code).toBe(errorCode);
    expect(result.credentialSource).toBe("pi-kimi-coding");
    expect(cliFallback.resolveCredential).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds unexpected resolver failures without exposing their message", async () => {
    const credentialResolver = resolver({
      resolveCredential: vi.fn(async () => {
        throw new Error(`resolver leaked ${SYNTHETIC_KEY} /private/path`);
      }),
    });
    const result = await broker({ credentialResolver }).acquire({ force: true });

    expect(result).toMatchObject({ status: "error", error: { code: "credential_resolution_failed", category: "credential" } });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_KEY);
    expect(JSON.stringify(result)).not.toContain("/private/path");
  });

  it.each([301, 302, 307, 308])("rejects HTTP %s redirects without following up", async (status) => {
    const fetchMock = vi.fn(async () => new Response("follow me", { status, headers: { location: "https://elsewhere.invalid/" } }));
    const result = await broker({ fetch: fetchMock }).acquire({ force: true });

    expect(result).toMatchObject({ status: "error", error: { code: "redirect_rejected", httpStatus: status } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("enforces the total deadline without switching credentials after cancellation", async () => {
    let finishPrimary: ((resolution: { status: "unavailable" }) => void) | undefined;
    const primary: KimiCredentialResolver = {
      resolveCredential: vi.fn(() => new Promise<{ status: "unavailable" }>((resolve) => {
        finishPrimary = resolve;
      })),
    };
    const cliFallback = resolver({
      resolveCredential: vi.fn(async () => ({
        status: "available" as const,
        source: "kimi-code-cli" as const,
        apiKey: "unused-cli-fallback",
      })),
    });
    const credentialResolver = createKimiCredentialResolverChain([primary, cliFallback]);
    const fetchMock = vi.fn<typeof fetch>();
    const acquisition = broker({ credentialResolver, fetch: fetchMock, timeoutMs: 20 }).acquire({ force: true });
    const result = await acquisition;

    finishPrimary?.({ status: "unavailable" });
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toMatchObject({ status: "error", error: { code: "request_timeout", category: "transport" } });
    expect(cliFallback.resolveCredential).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects declared and streamed bodies over 262144 bytes", async () => {
    const declared = await broker({
      fetch: vi.fn(async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "262145" } })),
    }).acquire({ force: true });
    expect(declared.error?.code).toBe("response_too_large");

    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(180_000));
        controller.enqueue(new Uint8Array(100_000));
      },
      cancel,
    });
    const streamed = await broker({
      fetch: vi.fn(async () => new Response(stream, { headers: { "content-type": "application/json" } })),
    }).acquire({ force: true });
    expect(streamed.error?.code).toBe("response_too_large");
    expect(cancel).toHaveBeenCalled();
  });

  it.each([
    [new Response("{}", { headers: { "content-type": "text/plain" } }), "unexpected_content_type"],
    [new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }), "response_invalid_utf8"],
    [new Response("{broken", { headers: { "content-type": "application/json" } }), "malformed_json"],
    [jsonResponse({ usage: { limit: 0, used: 1 } }), "schema_invalid"],
  ])("maps a 200 decoding failure to %s", async (response, code) => {
    const result = await broker({ fetch: vi.fn(async () => response) }).acquire({ force: true });
    expect(result).toMatchObject({ status: "error", error: { code, category: "parser" } });
  });

  it.each([
    [401, "auth_required", "provider_auth_rejected"],
    [403, "auth_required", "provider_auth_rejected"],
    [408, "error", "provider_timeout"],
    [429, "rate_limited", "provider_rate_limited"],
    [502, "error", "provider_unavailable"],
    [418, "error", "provider_request_rejected"],
  ])("maps HTTP %s to %s/%s without reading the body", async (httpStatus, status, code) => {
    const body = new ReadableStream({
      pull() {
        throw new Error(`body should not be read ${SYNTHETIC_KEY}`);
      },
    });
    const result = await broker({ fetch: vi.fn(async () => new Response(body, { status: httpStatus })) }).acquire({ force: true });

    expect(result).toMatchObject({ status, error: { code, httpStatus } });
    expect(JSON.stringify(result)).not.toContain(SYNTHETIC_KEY);
  });

  it.each([
    [301, "redirect_rejected", "error", { location: "https://elsewhere.invalid/" }],
    [302, "redirect_rejected", "error", { location: "https://elsewhere.invalid/" }],
    [307, "redirect_rejected", "error", { location: "https://elsewhere.invalid/" }],
    [308, "redirect_rejected", "error", { location: "https://elsewhere.invalid/" }],
    [401, "provider_auth_rejected", "auth_required", {}],
    [403, "provider_auth_rejected", "auth_required", {}],
    [408, "provider_timeout", "error", {}],
    [429, "provider_rate_limited", "rate_limited", { "retry-after": "12" }],
    [418, "provider_request_rejected", "error", {}],
    [422, "provider_request_rejected", "error", {}],
    [500, "provider_unavailable", "error", {}],
    [503, "provider_unavailable", "error", {}],
  ] as const)(
    "closes an indefinitely streaming HTTP %s response before acquire completes",
    async (httpStatus, code, status, headers) => {
      const transport = await throughLoopback(
        { status: httpStatus, headers, chunks: ["still streaming"], keepOpen: true },
        (fetchImpl) => broker({ fetch: fetchImpl }).acquire({ force: true }),
      );

      expect(transport.value).toMatchObject({ status, error: { code, httpStatus } });
      expect(transport.requestedUrl).toBe("https://api.kimi.com/coding/v1/usages");
      expect(transport.activeResponsesAtCompletion).toBe(0);
      expect(transport.liveSocketsAtCompletion).toBe(0);
    },
  );

  it.each([
    ["unexpected content type", { headers: { "content-type": "text/plain" }, chunks: ["still streaming"], keepOpen: true }, "unexpected_content_type"],
    ["declared oversized body", { headers: { "content-type": "application/json", "content-length": "262145" }, keepOpen: true }, "response_too_large"],
    ["streamed oversized body", { headers: { "content-type": "application/json" }, chunks: [new Uint8Array(262_145)], keepOpen: true }, "response_too_large"],
  ] as const)("closes the socket for an %s before acquire completes", async (_label, response, code) => {
    const transport = await throughLoopback(response, (fetchImpl) => broker({ fetch: fetchImpl }).acquire({ force: true }));

    expect(transport.value).toMatchObject({ status: "error", error: { code, httpStatus: 200 } });
    expect(transport.requestedUrl).toBe("https://api.kimi.com/coding/v1/usages");
    expect(transport.activeResponsesAtCompletion).toBe(0);
    expect(transport.liveSocketsAtCompletion).toBe(0);
  });

  it.each([
    ["malformed", "{broken", "malformed_json"],
    ["valid", JSON.stringify(validPayload()), undefined],
  ] as const)("finishes a bounded %s JSON response with no live body, socket, or deadline timer", async (_label, body, code) => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const transport = await throughLoopback(
      { headers: { "content-type": "application/json" }, chunks: [body] },
      (fetchImpl) => broker({ fetch: fetchImpl, timeoutMs: 2_000 }).acquire({ force: true }),
    );
    const deadlineCall = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 2_000);
    const deadlineTimer = setTimeoutSpy.mock.results[deadlineCall]?.value;

    if (code) expect(transport.value).toMatchObject({ status: "error", error: { code, httpStatus: 200 } });
    else expect(transport.value).toMatchObject({ status: "fresh", stale: false, source: "api" });
    expect(transport.activeResponsesAtCompletion).toBe(0);
    expect(transport.liveSocketsAtCompletion).toBe(0);
    expect(deadlineCall).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(deadlineTimer);
  });

  it("closes an indefinitely streaming success body and clears its timer when the deadline expires", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const transport = await throughLoopback(
      { headers: { "content-type": "application/json" }, chunks: ["{"], keepOpen: true },
      (fetchImpl) => broker({ fetch: fetchImpl, timeoutMs: 25 }).acquire({ force: true }),
    );
    const deadlineCall = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 25);
    const deadlineTimer = setTimeoutSpy.mock.results[deadlineCall]?.value;

    expect(transport.value).toMatchObject({ status: "error", error: { code: "request_timeout", category: "transport" } });
    expect(transport.activeResponsesAtCompletion).toBe(0);
    expect(transport.liveSocketsAtCompletion).toBe(0);
    expect(deadlineCall).toBeGreaterThanOrEqual(0);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(deadlineTimer);
  });

  it.each([
    ["73", "2026-07-19T12:01:13.000Z"],
    ["Sun, 19 Jul 2026 12:04:00 GMT", "2026-07-19T12:04:00.000Z"],
    ["nonsense", undefined],
    ["-4", undefined],
  ])("normalizes Retry-After %s without waiting", async (retryAfter, expected) => {
    const result = await broker({
      fetch: vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": retryAfter } })),
    }).acquire({ force: true });

    expect(result.retryAt).toBe(expected);
  });

  it.each([
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }), "network_unavailable"],
    [Object.assign(new TypeError("fetch failed"), { cause: { code: "CERT_HAS_EXPIRED" } }), "tls_failed"],
  ])("maps local transport failures to %s", async (failure, code) => {
    const result = await broker({ fetch: vi.fn(async () => Promise.reject(failure)) }).acquire({ force: true });
    expect(result).toMatchObject({ status: "error", error: { code, category: "transport" } });
  });

  it("keeps a sentinel credential and sensitive error body out of every observable channel", async () => {
    const logEvents: KimiQuotaLogEvent[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => new Response(`account=private ${SYNTHETIC_KEY}`, { status: 503 }));

    const result = await broker({ fetch: fetchMock, logger: (event) => logEvents.push(event) }).acquire({ force: true });
    const bridgeBytes = JSON.stringify(result);
    const cacheBytes = allCacheBytes(db);
    const observable = JSON.stringify({ bridgeBytes, cacheBytes, logEvents, stdout: stdout.mock.calls, stderr: stderr.mock.calls, consoleLog: consoleLog.mock.calls, consoleError: consoleError.mock.calls });

    expect(observable).not.toContain(SYNTHETIC_KEY);
    expect(observable).not.toContain("account=private");
    expect(bridgeBytes).not.toMatch(/authorization|bearer|account|plan|raw/i);
    expect(cacheBytes).not.toMatch(/authorization|bearer|account|plan|raw/i);
  });
});

describe("Kimi quota broker cache, freshness, and concurrency", () => {
  let db: ExtensionDatabase;
  let nowMs: number;

  beforeEach(() => {
    db = createExtensionDatabase(":memory:");
    nowMs = START_MS;
  });

  afterEach(() => db.close());

  function create(fetchMock: typeof fetch, credentialResolver = resolver()) {
    return createKimiQuotaBroker({
      db,
      credentialResolver,
      fetch: fetchMock,
      now: () => nowMs,
      userAgent: "baby-menu-test/4.2.0",
    });
  }

  it("atomically replaces normalized last-good cache and never stores wire data or credentials", async () => {
    const payload = validPayload({ account: "should-not-survive", requestCount: 984 });
    const quota = create(vi.fn(async () => jsonResponse(payload)));

    const result = await quota.acquire({ force: true });
    const rows = db.query<{ key: string; value: string }>("SELECT key, value FROM kimi_quota_cache ORDER BY key");
    const bytes = JSON.stringify(rows);

    expect(result.status).toBe("fresh");
    expect(rows.map((row) => row.key)).toEqual(["current_result", "last_good"]);
    expect(bytes).not.toContain("should-not-survive");
    expect(bytes).not.toContain("requestCount");
    expect(bytes).not.toContain(SYNTHETIC_KEY);
  });

  it("returns eligible surviving windows as stale with original refresh time", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse())
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    const quota = create(fetchMock);
    const fresh = await quota.acquire({ force: true });
    nowMs += 30 * 60 * 1000;
    const stale = await quota.acquire({ force: true });

    expect(stale).toMatchObject({
      status: "stale",
      stale: true,
      source: "cache",
      error: { code: "provider_unavailable" },
      snapshot: { refreshedAt: fresh.snapshot?.refreshedAt },
    });
    expect(stale.snapshot?.windows.map((window) => window.id)).toEqual(["weekly", "five_hour"]);
  });

  it("drops only reset-expired stale windows", async () => {
    const payload = validPayload({
      usage: { limit: 101, used: 13, resetTime: "2026-07-26T12:00:00Z" },
      limits: [
        { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: 60, used: 9, resetAt: "2026-07-19T12:01:00Z" } },
        { window: { duration: 2, timeUnit: "TIME_UNIT_DAY" }, detail: { limit: 70, used: 14, resetAt: "2026-07-20T00:00:00Z" } },
      ],
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse(payload)).mockRejectedValueOnce(new TypeError("offline"));
    const quota = create(fetchMock);
    await quota.acquire({ force: true });
    nowMs += 2 * 60 * 1000;

    const stale = await quota.acquire({ force: true });

    expect(stale.snapshot?.windows.map((window) => window.id)).toEqual(["weekly", "limit:2"]);
  });

  it("expires no-reset session/unknown windows at five hours and weekly at seven days", async () => {
    const payload = {
      usage: { limit: 111, used: 22 },
      limits: [
        { window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" }, detail: { limit: 63, used: 7 } },
        { detail: { limit: 81, used: 19 } },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(payload))
      .mockRejectedValue(new TypeError("offline"));
    const quota = create(fetchMock);
    await quota.acquire({ force: true });

    nowMs += 5 * 60 * 60 * 1000;
    const fiveHours = await quota.acquire({ force: true });
    expect(fiveHours.snapshot?.windows.map((window) => window.id)).toEqual(["weekly"]);

    nowMs = START_MS + 7 * 24 * 60 * 60 * 1000;
    const sevenDays = await quota.acquire({ force: true });
    expect(sevenDays.status).toBe("error");
    expect(sevenDays.snapshot).toBeUndefined();
  });

  it.each([
    [resolver({ resolveCredential: vi.fn(async () => ({ status: "unavailable" as const })) }), undefined],
    [resolver(), 401],
    [resolver(), 403],
  ])("retires cache after definitive auth loss or rejection", async (nextResolver, status) => {
    const initial = create(vi.fn(async () => jsonResponse()));
    await initial.acquire({ force: true });

    const fetchMock = vi.fn(async () => new Response("", { status: status ?? 200 }));
    const quota = create(fetchMock, nextResolver);
    const result = await quota.acquire({ force: true });

    expect(result.status).toBe("auth_required");
    expect(db.query("SELECT key FROM kimi_quota_cache WHERE key = 'last_good'")).toEqual([]);
    if (status === undefined) expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not use stale cache for terminal redirect or request-rejection failures", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse())
      .mockResolvedValueOnce(new Response("", { status: 307 }))
      .mockResolvedValueOnce(new Response("", { status: 422 }));
    const quota = create(fetchMock);
    await quota.acquire({ force: true });

    expect((await quota.acquire({ force: true })).status).toBe("error");
    expect((await quota.acquire({ force: true })).status).toBe("error");
  });

  it("coalesces view and background acquisition onto one in-flight request", async () => {
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const quota = create(fetchMock);

    const background = quota.acquire({ force: true });
    const popover = quota.acquire({ maxAgeMs: 60_000 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    release?.(jsonResponse());

    const [first, second] = await Promise.all([background, popover]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns the current cached result without acquiring", async () => {
    const fetchMock = vi.fn(async () => jsonResponse());
    const quota = create(fetchMock);

    expect(quota.readCached()).toBeUndefined();
    const acquired = await quota.acquire({ force: true });
    expect(quota.readCached()).toEqual(acquired);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes on view only when the last success is older than 60 seconds", async () => {
    const fetchMock = vi.fn(async () => jsonResponse());
    const quota = create(fetchMock);

    await quota.acquire({ maxAgeMs: 60_000 });
    nowMs += 59_999;
    await quota.acquire({ maxAgeMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    nowMs += 2;
    await quota.acquire({ maxAgeMs: 60_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
