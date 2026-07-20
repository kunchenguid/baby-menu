import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionDatabase, type ExtensionDatabase } from "../src/main/extension-database";
import { createServerActionRegistry, type ServerActionRegistry } from "../src/main/server-action-registry";

type QuotaFailure = {
  kind: string;
  message: string;
  sourcesTried: string[];
  diagnostic?: string;
};

type QuotaWindow = {
  id: "credits" | `product:${string}`;
  label: string;
  percentUsed: number;
  percentRemaining: number;
  resetAt?: string;
  provenance: {
    percentageField: "config.creditUsagePercent" | `config.productUsage[${number}].usagePercent`;
    resetField?: "config.currentPeriod.end";
    omittedProto3Default?: true;
  };
};

type QuotaSnapshot = {
  schemaVersion: number;
  source: "grok-credits-grpc-web";
  sourceVersion: 1;
  operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig";
  period: {
    type: "weekly" | "monthly" | "unspecified";
    startAt?: string;
    endAt?: string;
    provenance: "config.currentPeriod";
  };
  windows: QuotaWindow[];
  credits?: { remaining: number; unit: "credits"; sourceField: "config.prepaidBalance.val" };
  refreshedAt: string;
  stale: boolean;
};

type QuotaResult =
  | {
      ok: true;
      checkedAt: string;
      data: QuotaSnapshot;
      warning?: QuotaFailure;
    }
  | { ok: false; checkedAt: string; failure: QuotaFailure };

type InstalledFixture = {
  rootDir: string;
  grokHome: string;
  database: ExtensionDatabase;
  registry: ServerActionRegistry;
};

const fixtureUrl = new URL("./fixtures/grok-quota-generated/server.ts.fixture", import.meta.url);
const originalEnv = { ...process.env };

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Uint8Array.from(bytes);
}

function scalar(field: number, value: number): Uint8Array {
  return concat(varint(field << 3), varint(value));
}

function fixed32(field: number, value: number): Uint8Array {
  const bytes = new Uint8Array(5);
  bytes[0] = (field << 3) | 5;
  new DataView(bytes.buffer).setFloat32(1, value, true);
  return bytes;
}

function message(field: number, value: Uint8Array): Uint8Array {
  return concat(varint((field << 3) | 2), varint(value.length), value);
}

function timestamp(epochSeconds: number): Uint8Array {
  return scalar(1, epochSeconds);
}

function grpcFrame(payload: Uint8Array, flags = 0): Uint8Array {
  const frame = new Uint8Array(payload.length + 5);
  frame[0] = flags;
  new DataView(frame.buffer).setUint32(1, payload.length);
  frame.set(payload, 5);
  return frame;
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function consumerQuotaResponse(options: {
  percentUsed?: number;
  products?: Array<{ product?: number; usagePercent?: number }>;
  periodType?: 1 | 2;
  resetEpoch?: number;
  billingResetEpoch?: number;
  prepaidCents?: number;
} = {}): Response {
  const percentUsed = Object.hasOwn(options, "percentUsed") ? options.percentUsed : 22;
  const products = options.products ?? [{ product: 2, usagePercent: percentUsed }];
  const periodType = options.periodType ?? 2;
  const resetEpoch = options.resetEpoch ?? Date.parse("2026-07-20T00:00:00Z") / 1000;
  const billingResetEpoch = options.billingResetEpoch ?? resetEpoch;
  const prepaidCents = options.prepaidCents ?? 450;
  const startEpoch = resetEpoch - (periodType === 2 ? 7 * 86_400 : 30 * 86_400);
  const configParts: Uint8Array[] = [];
  if (percentUsed !== undefined) configParts.push(fixed32(1, percentUsed));
  configParts.push(message(2, new Uint8Array()));
  configParts.push(message(3, new Uint8Array()));
  configParts.push(message(4, timestamp(startEpoch)));
  configParts.push(message(5, timestamp(billingResetEpoch)));
  for (const product of products) {
    const parts: Uint8Array[] = [];
    if (product.product !== undefined) parts.push(scalar(1, product.product));
    if (product.usagePercent !== undefined) parts.push(fixed32(2, product.usagePercent));
    configParts.push(message(7, concat(...parts)));
  }
  configParts.push(message(8, concat(
    scalar(1, periodType),
    message(2, timestamp(startEpoch)),
    message(3, timestamp(resetEpoch)),
  )));
  configParts.push(scalar(11, 1));
  configParts.push(message(12, prepaidCents === 0 ? new Uint8Array() : scalar(1, prepaidCents)));
  const payload = message(1, concat(...configParts));
  const trailers = grpcFrame(new TextEncoder().encode("grpc-status: 0\r\n"), 0x80);
  return new Response(responseBody(concat(grpcFrame(payload), trailers)), {
    status: 200,
    headers: { "content-type": "application/grpc-web+proto" },
  });
}

function monetaryBillingResponse(): Response {
  const config = concat(
    message(2, scalar(1, 100)),
    message(3, scalar(1, 22)),
    message(4, timestamp(1_772_323_200)),
    message(5, timestamp(1_775_001_600)),
  );
  return new Response(responseBody(grpcFrame(message(1, config))), {
    status: 200,
    headers: { "content-type": "application/grpc-web+proto" },
  });
}

function noReportedQuotaResponse(): Response {
  return consumerQuotaResponse({
    percentUsed: undefined,
    products: [{ product: 2, usagePercent: undefined }],
    prepaidCents: 0,
  });
}

describe("clean generated Grok quota installation", () => {
  const tempDirs: string[] = [];
  const databases: ExtensionDatabase[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const key of [
      "GROK_HOME",
      "GROK_AUTH_PATH",
      "GROK_AUTH_JSON",
      "GROK_CLI_PATH",
      "GROK_TEST_AUTH_AFTER",
      "GROK_TEST_CLI_COUNT",
      "GROK_TEST_DESCENDANT_PID",
      "GROK_QUOTA_TEST_CLI_TIMEOUT_MS",
      "GROK_QUOTA_TEST_CLI_TERMINATION_GRACE_MS",
      "GROK_QUOTA_TEST_TIMEOUT_MS",
    ]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    process.env.PATH = originalEnv.PATH;
    for (const database of databases.splice(0)) database.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  type AuthEntry = {
    key?: string;
    auth_mode?: string;
    user_id?: string;
    team_id?: string;
    expires_at?: string;
  };

  async function writeAuthEntries(path: string, entries: Record<string, AuthEntry>): Promise<void> {
    await writeFile(path, JSON.stringify(entries));
  }

  async function writeAuth(path: string, options: { key: string; expired: boolean }): Promise<void> {
    await writeAuthEntries(path, {
      "https://auth.x.ai::fixture-client": {
        key: options.key,
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: options.expired ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
      },
    });
  }

  async function configureFakeRefresh(
    installed: InstalledFixture,
    entries: Record<string, AuthEntry>,
    behavior: "refresh" | "fail" | "timeout" | "inherited-stdio-timeout" = "refresh",
  ): Promise<string> {
    const executable = join(installed.grokHome, "bin", "grok");
    const refreshedAuth = join(installed.rootDir, "refreshed-auth.json");
    const countPath = join(installed.rootDir, "cli-count.txt");
    await writeAuthEntries(refreshedAuth, entries);
    await writeFile(countPath, "");
    const script = behavior === "refresh"
      ? '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\ncp "$GROK_TEST_AUTH_AFTER" "$GROK_HOME/auth.json"\n'
      : behavior === "timeout"
        ? '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\ntrap "" TERM\nwhile :; do :; done\n'
        : behavior === "inherited-stdio-timeout"
          ? '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\ntrap "" TERM\n(trap "" TERM; while :; do sleep 1; done) &\nchild_pid=$!\nprintf "%s" "$child_pid" > "$GROK_TEST_DESCENDANT_PID"\nwait "$child_pid"\n'
        : '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\nexit 7\n';
    await writeFile(executable, script);
    await chmod(executable, 0o755);
    process.env.GROK_CLI_PATH = executable;
    process.env.GROK_TEST_AUTH_AFTER = refreshedAuth;
    process.env.GROK_TEST_CLI_COUNT = countPath;
    process.env.GROK_TEST_DESCENDANT_PID = join(installed.rootDir, "cli-descendant-pid.txt");
    return countPath;
  }

  async function install(): Promise<InstalledFixture> {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-grok-generated-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "grok-quota");
    const grokHome = join(rootDir, "grok-home");
    await mkdir(extensionDir, { recursive: true });
    await mkdir(join(grokHome, "bin"), { recursive: true });
    await copyFile(fixtureUrl, join(extensionDir, "server.ts"));

    await writeAuth(join(grokHome, "auth.json"), { key: "fake-current", expired: false });

    process.env.GROK_HOME = grokHome;
    process.env.PATH = "/usr/bin:/bin";
    delete process.env.GROK_AUTH_PATH;
    delete process.env.GROK_AUTH_JSON;
    delete process.env.GROK_CLI_PATH;

    const database = createExtensionDatabase(join(rootDir, "baby-menu.db"));
    databases.push(database);
    const registry = createServerActionRegistry({
      rootDir,
      cacheDir: join(rootDir, "cache", "server-actions"),
      db: database,
    });
    return { rootDir, grokHome, database, registry };
  }

  async function invoke(installed: InstalledFixture): Promise<QuotaResult> {
    return (await installed.registry.invoke("grok-quota", "getQuota")) as QuotaResult;
  }

  function seedCache(installed: InstalledFixture, value: unknown): void {
    installed.database.exec(`CREATE TABLE IF NOT EXISTS grok_quota_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    installed.database.run(
      `INSERT INTO grok_quota_cache (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ["grok-quota", JSON.stringify(value), 1],
    );
  }

  function cachedText(installed: InstalledFixture): string | undefined {
    return installed.database.get<{ value: string }>(
      "SELECT value FROM grok_quota_cache WHERE key = ?",
      ["grok-quota"],
    )?.value;
  }

  function cachedValue(installed: InstalledFixture): unknown {
    const value = cachedText(installed);
    return value ? JSON.parse(value) : undefined;
  }

  function fixtureAccountBinding(
    kind = "oidc",
    userId = "fixture-user",
    teamId = "fixture-team",
  ): string {
    return createHash("sha256")
      .update(JSON.stringify({ kind, userId, teamId }))
      .digest("hex");
  }

  function trustedSnapshot(): QuotaSnapshot & { accountBinding: string } {
    return {
      schemaVersion: 2,
      source: "grok-credits-grpc-web",
      sourceVersion: 1,
      operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
      accountBinding: fixtureAccountBinding(),
      period: {
        type: "weekly",
        startAt: "2026-07-13T00:00:00.000Z",
        endAt: "2026-07-20T00:00:00.000Z",
        provenance: "config.currentPeriod",
      },
      windows: [
        {
          id: "credits",
          label: "Weekly",
          percentUsed: 18.25,
          percentRemaining: 81.75,
          resetAt: "2026-07-20T00:00:00.000Z",
          provenance: {
            percentageField: "config.creditUsagePercent",
            resetField: "config.currentPeriod.end",
          },
        },
      ],
      credits: {
        remaining: 450,
        unit: "credits",
        sourceField: "config.prepaidBalance.val",
      },
      refreshedAt: "2026-07-15T01:02:03.456Z",
      stale: false,
    };
  }

  function trustedProductSnapshot(): QuotaSnapshot & { accountBinding: string } {
    const snapshot = trustedSnapshot();
    return {
      ...snapshot,
      windows: [
        ...snapshot.windows,
        {
          id: "product:grok-build",
          label: "Grok Build",
          percentUsed: 33.25,
          percentRemaining: 66.75,
          resetAt: snapshot.period.endAt,
          provenance: {
            percentageField: "config.productUsage[0].usagePercent",
            resetField: "config.currentPeriod.end",
          },
        },
        {
          id: "product:grok-chat",
          label: "Chat",
          percentUsed: 12.5,
          percentRemaining: 87.5,
          resetAt: snapshot.period.endAt,
          provenance: {
            percentageField: "config.productUsage[1].usagePercent",
            resetField: "config.currentPeriod.end",
          },
        },
      ],
    };
  }

  it("calls the exact bounded consumer gRPC-web operation without mutation headers or account data", async () => {
    const installed = await install();
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => consumerQuotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      schemaVersion: 2,
      source: "grok-credits-grpc-web",
      sourceVersion: 1,
      operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
      stale: false,
    });
    expect(result.data).not.toHaveProperty("accountBinding");
    expect(result.data).not.toHaveProperty("scope");
    expect(result.data.windows[0]).toMatchObject({ id: "credits", percentUsed: 22, percentRemaining: 78 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Origin: "https://grok.com",
      Referer: "https://grok.com/?_s=usage",
      "Content-Type": "application/grpc-web+proto",
      Accept: "*/*",
      "x-grpc-web": "1",
      "x-user-agent": "connect-es/2.1.1",
    });
    expect(headers).not.toHaveProperty("x-grok-client-mode");
    expect(headers).not.toHaveProperty("Cookie");
    expect(Array.from(fetchMock.mock.calls[0]?.[1]?.body as Uint8Array)).toEqual([0, 0, 0, 0, 0]);
    const compiledIds = await readdir(join(installed.rootDir, "cache", "server-actions", "grok-quota"));
    expect(compiledIds).toHaveLength(1);
  });

  it("refreshes a locally expired OIDC bearer once, rereads auth, and calls gRPC with the refreshed bearer", async () => {
    const installed = await install();
    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "fake-refreshed",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async () => consumerQuotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    expect(await readFile(countPath, "utf8")).toBe("x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-refreshed");
  });

  it("uses one provider request after local-expiry refresh even when it fails transiently", async () => {
    const installed = await install();
    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "fake-refreshed",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(consumerQuotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("quota_service");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-refreshed");
    expect(await readFile(countPath, "utf8")).toBe("x");
  });

  it.each([
    ["HTTP 401", () => new Response("", { status: 401 })],
    ["gRPC unauthenticated", () => new Response(responseBody(grpcFrame(
      new TextEncoder().encode("grpc-status: 16\r\ngrpc-message: expired\r\n"),
      0x80,
    )), { status: 200 })],
    ["credential-classified gRPC permission failure", () => new Response(responseBody(grpcFrame(
      new TextEncoder().encode("grpc-status: 7\r\ngrpc-message: OAuth2%20access%20token%20could%20not%20be%20validated%3A%20bad-credentials\r\n"),
      0x80,
    )), { status: 200 })],
  ])("refreshes after one %s, rereads auth, and retries gRPC exactly once", async (_label, rejectedResponse) => {
    const installed = await install();
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "fake-refreshed",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rejectedResponse())
      .mockResolvedValueOnce(consumerQuotaResponse({ percentUsed: 31 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-current");
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-refreshed");
    expect(await readFile(countPath, "utf8")).toBe("x");
  });

  it("uses one post-refresh transport attempt while ordinary transient acquisition retains one retry", async () => {
    const installed = await install();
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "fake-refreshed",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const postRefreshFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(consumerQuotaResponse());
    vi.stubGlobal("fetch", postRefreshFetch);

    const postRefreshResult = await invoke(installed);

    expect(postRefreshResult.ok).toBe(false);
    if (postRefreshResult.ok) return;
    expect(postRefreshResult.failure.kind).toBe("quota_service");
    expect(postRefreshFetch).toHaveBeenCalledTimes(2);
    expect(await readFile(countPath, "utf8")).toBe("x");

    const ordinaryInstalled = await install();
    const ordinaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(consumerQuotaResponse());
    vi.stubGlobal("fetch", ordinaryFetch);

    const ordinaryResult = await invoke(ordinaryInstalled);

    expect(ordinaryResult.ok).toBe(true);
    expect(ordinaryFetch).toHaveBeenCalledTimes(2);
  });

  it("never runs the conditional refresh for a healthy successful bearer", async () => {
    const installed = await install();
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "unused-refreshed",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => consumerQuotaResponse()));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    expect(await readFile(countPath, "utf8")).toBe("");
  });

  it("does not refresh a healthy bearer after HTTP 403", async () => {
    const installed = await install();
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "unused-refreshed",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 403 })));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("credential_rejected");
    expect(await readFile(countPath, "utf8")).toBe("");
  });

  it("contains no direct OAuth, browser-cookie, proxy, or client-mode runtime path", async () => {
    const source = await readFile(fixtureUrl, "utf8");

    expect(source).toContain('spawn(executable, ["models"]');
    expect(source).not.toContain("refresh_token");
    expect(source).not.toContain("cli-chat-proxy.grok.com");
    expect(source).not.toContain("x-grok-client-mode");
    expect(source).not.toContain("Cookie");
    expect(source).not.toContain("browser");
  });

  it("prefers a current OIDC principal and falls back from a partial OIDC entry to legacy", async () => {
    const installed = await install();
    const authPath = join(installed.grokHome, "auth.json");
    const fetchMock = vi.fn<typeof fetch>(async () => consumerQuotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    await writeAuthEntries(authPath, {
      "https://accounts.x.ai/sign-in": {
        key: "fake-legacy",
        user_id: "legacy-user",
        expires_at: "2099-01-01T00:00:00Z",
      },
      "https://auth.x.ai::fixture-client": {
        key: "fake-oidc",
        auth_mode: "oidc",
        user_id: "oidc-user",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    await invoke(installed);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-oidc");

    fetchMock.mockClear();
    await writeAuthEntries(authPath, {
      "https://auth.x.ai::partial": { auth_mode: "oidc", user_id: "partial-user" },
      "https://accounts.x.ai/sign-in": {
        key: "fake-legacy",
        user_id: "legacy-user",
        expires_at: "2099-01-01T00:00:00Z",
      },
      "https://api.x.ai::unrelated": {
        key: "fake-api-key",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    await invoke(installed);
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-legacy");
  });

  it("refuses ambiguous winning-class principals before any provider call", async () => {
    const installed = await install();
    await writeAuthEntries(join(installed.grokHome, "auth.json"), {
      "https://auth.x.ai::first": {
        key: "fake-first",
        auth_mode: "oidc",
        user_id: "first-user",
        expires_at: "2099-01-01T00:00:00Z",
      },
      "https://auth.x.ai::second": {
        key: "fake-second",
        auth_mode: "oidc",
        user_id: "second-user",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("auth_scope_ambiguous");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a refreshed principal change before a gRPC retry", async () => {
    const installed = await install();
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "fake-other-principal",
        auth_mode: "oidc",
        user_id: "other-user",
        team_id: "other-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("auth_principal_changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readFile(countPath, "utf8")).toBe("x");
  });

  it("preserves same-principal last-good cache when conditional official refresh fails", async () => {
    const installed = await install();
    const trusted = trustedSnapshot();
    const stored = JSON.stringify(trusted);
    seedCache(installed, trusted);
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "unused",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    }, "fail");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 })));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ stale: true, refreshedAt: trusted.refreshedAt });
    expect(result.warning).toMatchObject({
      kind: "cli_launch_failed",
      sourcesTried: ["local-auth", "consumer-quota-api", "grok-cli-refresh", "cache"],
    });
    expect(cachedText(installed)).toBe(stored);
    expect(await readFile(countPath, "utf8")).toBe("x");
  });

  it("bounds refresh termination when a descendant keeps inherited stdio open", async () => {
    const installed = await install();
    process.env.GROK_QUOTA_TEST_CLI_TIMEOUT_MS = "500";
    process.env.GROK_QUOTA_TEST_CLI_TERMINATION_GRACE_MS = "100";
    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    const countPath = await configureFakeRefresh(installed, {
      "https://auth.x.ai::fixture-client": {
        key: "unused",
        auth_mode: "oidc",
        user_id: "fixture-user",
        team_id: "fixture-team",
        expires_at: "2099-01-01T00:00:00Z",
      },
    }, "inherited-stdio-timeout");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: "cli_launch_failed", diagnostic: "timeout" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await readFile(countPath, "utf8")).toBe("x");
    const descendantPidPath = process.env.GROK_TEST_DESCENDANT_PID;
    expect(descendantPidPath).toBeTruthy();
    if (!descendantPidPath) return;
    const descendantPid = Number(await readFile(descendantPidPath, "utf8"));
    // Harness-only liveness probe: ESRCH means gone; EPERM means the pid was
    // recycled to an unowned process (our descendant is still gone). Do not
    // treat either as a production signal path.
    await expect.poll(() => {
      try {
        process.kill(descendantPid, 0);
        return false;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ESRCH" || code === "EPERM";
      }
    }).toBe(true);
  });

  it("does not rethrow macOS EPERM when refresh termination double-signals a dead process group", async () => {
    const source = await readFile(fixtureUrl, "utf8");
    if (process.platform === "win32") return;

    const { spawn, spawnSync } = await import("node:child_process");
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-grok-kill-race-"));
    tempDirs.push(rootDir);
    const executableFixture = join(rootDir, "server.mjs");
    await writeFile(executableFixture, `${source}\nexport { signalRefreshProcessGroup };\n`);
    const fixtureModule = await import(pathToFileURL(executableFixture).href) as {
      signalRefreshProcessGroup: (
        pid: number,
        signal: NodeJS.Signals,
        state: { groupKillIssued: boolean },
      ) => void;
    };
    const { signalRefreshProcessGroup } = fixtureModule;

    function signalChildLegacy(pid: number, signal: NodeJS.Signals): void {
      try {
        process.kill(-pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }

    const fakePgid = 424242;
    const originalKill = process.kill;
    const eperm = Object.assign(new Error("kill EPERM"), { code: "EPERM" }) as NodeJS.ErrnoException;
    (process as NodeJS.Process).kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -fakePgid) throw eperm;
      return originalKill.call(process, pid, signal as NodeJS.Signals);
    }) as typeof process.kill;
    try {
      expect(() => signalChildLegacy(fakePgid, "SIGKILL")).toThrow(
        expect.objectContaining({ code: "EPERM" }),
      );
      const deadGroupState = { groupKillIssued: false };
      expect(() => signalRefreshProcessGroup(fakePgid, "SIGKILL", deadGroupState)).not.toThrow();
      expect(deadGroupState.groupKillIssued).toBe(true);
      expect(() => signalRefreshProcessGroup(fakePgid, "SIGKILL", deadGroupState)).not.toThrow();
    } finally {
      process.kill = originalKill;
    }

    type HangingGroup = {
      child: ReturnType<typeof spawn>;
      leaderPid: number;
      descendantPid?: number;
    };
    const groups: HangingGroup[] = [];

    async function spawnHangingGroup(script: string, descendantPidPath: string): Promise<HangingGroup> {
      const child = spawn(script, [], {
        detached: true,
        env: { ...process.env, GROK_TEST_DESCENDANT_PID: descendantPidPath },
        stdio: ["ignore", "pipe", "pipe"] as const,
        shell: false,
      });
      const leaderPid = child.pid;
      expect(leaderPid).toBeTypeOf("number");
      if (!leaderPid) throw new Error("missing leader pid");
      const group: HangingGroup = { child, leaderPid };
      groups.push(group);
      let descendantPid = 0;
      await expect.poll(async () => {
        try {
          descendantPid = Number(await readFile(descendantPidPath, "utf8"));
          return Number.isFinite(descendantPid) && descendantPid > 0;
        } catch {
          return false;
        }
      }).toBe(true);
      group.descendantPid = descendantPid;
      return group;
    }

    function expectProcessGone(pid: number) {
      return expect.poll(() => {
        try {
          process.kill(pid, 0);
          return false;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          return code === "ESRCH" || code === "EPERM";
        }
      }).toBe(true);
    }

    const script = join(rootDir, "hanging-cli.sh");
    await writeFile(
      script,
      `#!/bin/sh
trap "" TERM
(trap "" TERM; while :; do sleep 1; done) &
printf "%s" "$!" > "$GROK_TEST_DESCENDANT_PID"
wait
`,
    );
    await chmod(script, 0o755);

    const ownedLeaders: number[] = [];
    const ownedDescendants: number[] = [];
    const hardKillTargets: number[] = [];
    (process as NodeJS.Process).kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid < 0 && signal === "SIGKILL") hardKillTargets.push(-pid);
      return originalKill.call(process, pid, signal as NodeJS.Signals);
    }) as typeof process.kill;
    try {
      const liveGroup = await spawnHangingGroup(script, join(rootDir, "live-descendant.pid"));
      const liveEpermKill = process.kill;
      process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
        if (pid === -liveGroup.leaderPid) throw eperm;
        return liveEpermKill.call(process, pid, signal as NodeJS.Signals);
      }) as typeof process.kill;
      const liveState = { groupKillIssued: false };
      expect(() => signalRefreshProcessGroup(liveGroup.leaderPid, "SIGKILL", liveState)).toThrow(
        expect.objectContaining({ code: "EPERM" }),
      );
      expect(liveState.groupKillIssued).toBe(false);
      process.kill = liveEpermKill;

      for (let i = 0; i < 8; i++) {
        const descendantPidPath = join(rootDir, `descendant-${i}.pid`);
        const { child, leaderPid, descendantPid } = await spawnHangingGroup(script, descendantPidPath);
        if (!descendantPid) throw new Error("missing descendant pid");
        ownedLeaders.push(leaderPid);
        ownedDescendants.push(descendantPid);

        const state = { groupKillIssued: false };
        expect(() => {
          signalRefreshProcessGroup(leaderPid, "SIGTERM", state);
          signalRefreshProcessGroup(leaderPid, "SIGKILL", state);
          signalRefreshProcessGroup(leaderPid, "SIGKILL", state);
        }).not.toThrow();

        child.stdout?.destroy();
        child.stderr?.destroy();
        await Promise.race([
          new Promise<void>((resolve) => child.once("close", () => resolve())),
          new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
        ]);
        expect(() => signalRefreshProcessGroup(leaderPid, "SIGKILL", state)).not.toThrow();
        expect(state.groupKillIssued).toBe(true);
        expect(hardKillTargets.filter((pgid) => pgid === leaderPid)).toHaveLength(1);
        await expectProcessGone(leaderPid);
        await expectProcessGone(descendantPid);
      }

      expect(hardKillTargets.every((pgid) => ownedLeaders.includes(pgid))).toBe(true);
      expect(new Set(ownedLeaders).size).toBe(ownedLeaders.length);
      expect(ownedDescendants).toHaveLength(ownedLeaders.length);
    } finally {
      process.kill = originalKill;
      for (const { child, leaderPid } of groups) {
        try {
          originalKill.call(process, -leaderPid, "SIGKILL");
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ESRCH" && code !== "EPERM") throw error;
        }
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    }

    for (const leaderPid of ownedLeaders) {
      const result = spawnSync("/bin/ps", ["-axo", "pid=,pgid=,uid=,state="], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const uid = process.getuid?.();
      const live = result.stdout.split("\n").filter((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return false;
        const [, rawPgid, rawUid, state] = parts;
        if (Number(rawPgid) !== leaderPid) return false;
        if (uid !== undefined && Number(rawUid) !== uid) return false;
        return !String(state).startsWith("Z");
      });
      expect(live).toEqual([]);
    }
  });

  it("uses currentPeriod.end and never the monetary billing period reset", async () => {
    const installed = await install();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => consumerQuotaResponse({
        resetEpoch: Date.parse("2026-07-20T00:00:00Z") / 1000,
        billingResetEpoch: Date.parse("2026-08-01T00:00:00Z") / 1000,
      })),
    );

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.windows.every((window) => window.resetAt === "2026-07-20T00:00:00.000Z")).toBe(true);
    expect(result.data.windows.every(
      (window) => window.provenance.resetField === "config.currentPeriod.end",
    )).toBe(true);
  });

  it("never turns monetary monthly spend into a quota percentage", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => monetaryBillingResponse()));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "quota_unreported",
      message: "Official Grok consumer quota did not report a percentage or valid current period",
    });
  });

  it("accepts the bounded raw protobuf form and retries one transient response only", async () => {
    const installed = await install();
    const framed = new Uint8Array(await consumerQuotaResponse({ percentUsed: 27.5 }).arrayBuffer());
    const payloadLength = new DataView(framed.buffer).getUint32(1);
    const raw = framed.slice(5, 5 + payloadLength);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(responseBody(raw), {
        status: 200,
        headers: { "content-type": "application/grpc-web+proto" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.windows[0]?.percentUsed).toBe(27.5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    [9, "No personal team", "team_scope_unsupported"],
    [7, "permission denied", "quota_service"],
  ])("classifies non-credential gRPC status %i without refreshing, retrying, or exposing the message", async (status, message, kind) => {
    const installed = await install();
    const trailer = grpcFrame(new TextEncoder().encode(
      `grpc-status: ${status}\r\ngrpc-message: ${encodeURIComponent(message)}\r\n`,
    ), 0x80);
    const fetchMock = vi.fn(async () => new Response(responseBody(trailer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe(kind);
    expect(JSON.stringify(result)).not.toContain(message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["header", "invalid"],
    ["header", "17"],
    ["trailer", "invalid"],
    ["trailer", "17"],
  ])("rejects malformed or out-of-range gRPC status in the %s", async (location, status) => {
    const installed = await install();
    const response = location === "header"
      ? new Response("", { status: 200, headers: { "grpc-status": status } })
      : new Response(responseBody(grpcFrame(
          new TextEncoder().encode(`grpc-status: ${status}\r\n`),
          0x80,
        )), { status: 200 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("parse_incompatible");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects compressed frames and non-credential gRPC header errors before protobuf parsing", async () => {
    const installed = await install();
    const compressed = responseBody(grpcFrame(message(1, new Uint8Array()), 0x01));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(compressed, { status: 200 }))
      .mockResolvedValueOnce(new Response("", {
        status: 200,
        headers: { "grpc-status": "9", "grpc-message": "No%20personal%20team" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const compressedResult = await invoke(installed);
    expect(compressedResult.ok).toBe(false);
    if (compressedResult.ok) return;
    expect(compressedResult.failure.kind).toBe("parse_incompatible");

    const headerResult = await invoke(installed);
    expect(headerResult.ok).toBe(false);
    if (headerResult.ok) return;
    expect(headerResult.failure.kind).toBe("team_scope_unsupported");
    expect(JSON.stringify(headerResult)).not.toContain("personal team");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enforces one whole-request timeout without a second provider call", async () => {
    const installed = await install();
    process.env.GROK_QUOTA_TEST_TIMEOUT_MS = "50";
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({ kind: "connectivity", diagnostic: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports exact source unavailable instead of falling back to CLI billing or monetary math", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "official_quota_source_unavailable",
      httpStatus: 404,
      sourcesTried: ["local-auth", "consumer-quota-api", "cache"],
    });
    expect(result).not.toHaveProperty("data");
  });

  it.each([
    ["connectivity", () => Promise.reject(new Error("offline")), "connectivity"],
    ["parser", () => new Response(responseBody(Uint8Array.from([0])), { status: 200 }), "parse_incompatible"],
    ["rate limit", () => new Response("", { status: 429 }), "rate_limited"],
    ["service", () => new Response("", { status: 503 }), "quota_service"],
  ])("rejects and clears the fabricated legacy row during %s failure", async (_label, response, kind) => {
    const installed = await install();
    seedCache(installed, {
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
    });
    vi.stubGlobal("fetch", vi.fn(response));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe(kind);
    expect(result).not.toHaveProperty("data");
    expect(cachedValue(installed)).toBeUndefined();
  });

  it("replaces the fabricated legacy row only after exact-source success", async () => {
    const installed = await install();
    seedCache(installed, {
      source: "api",
      windows: [{ id: "credits", label: "credits", percentUsed: 99, percentRemaining: 1 }],
      refreshedAt: "2026-07-15T00:00:00.000Z",
      stale: false,
    });
    vi.stubGlobal("fetch", vi.fn(async () => noReportedQuotaResponse()));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      schemaVersion: 2,
      source: "grok-credits-grpc-web",
    });
    expect(result.data.windows[0]).toMatchObject({ percentUsed: 0, percentRemaining: 100 });
    expect(cachedValue(installed)).toMatchObject(result.data);
  });

  it.each([
    ["unversioned", { ...trustedSnapshot(), schemaVersion: undefined }],
    ["unknown version", { ...trustedSnapshot(), schemaVersion: 0 }],
    ["legacy version", { ...trustedSnapshot(), schemaVersion: 1 }],
    ["future version", { ...trustedSnapshot(), schemaVersion: 3 }],
    ["wrong source", { ...trustedSnapshot(), source: "api" }],
    ["wrong operation", { ...trustedSnapshot(), operation: "_x.ai/billing" }],
    ["different principal", { ...trustedSnapshot(), accountBinding: "f".repeat(64) }],
    [
      "missing percentage provenance",
      {
        ...trustedSnapshot(),
        windows: trustedSnapshot().windows.map(({ provenance: _provenance, ...window }) => window),
      },
    ],
    [
      "percentage field mismatch",
      {
        ...trustedSnapshot(),
        windows: trustedSnapshot().windows.map((window) => ({
          ...window,
          provenance: { ...window.provenance, percentageField: "config.productUsage[0].usagePercent" },
        })),
      },
    ],
    [
      "missing reset provenance",
      {
        ...trustedSnapshot(),
        windows: trustedSnapshot().windows.map((window) => ({
          ...window,
          provenance: { percentageField: window.provenance.percentageField },
        })),
      },
    ],
    [
      "unknown reset provenance",
      {
        ...trustedSnapshot(),
        windows: trustedSnapshot().windows.map((window) => ({
          ...window,
          provenance: { ...window.provenance, resetField: "config.monthlyLimit.end" },
        })),
      },
    ],
    [
      "reset field without reset value",
      {
        ...trustedSnapshot(),
        windows: trustedSnapshot().windows.map(({ resetAt: _resetAt, ...window }) => window),
      },
    ],
    [
      "missing credits provenance",
      {
        ...trustedSnapshot(),
        credits: { remaining: 450, unit: "credits" },
      },
    ],
    [
      "duplicate product provenance index",
      {
        ...trustedProductSnapshot(),
        windows: trustedProductSnapshot().windows.map((window, index) =>
          index === 2
            ? {
                ...window,
                provenance: {
                  ...window.provenance,
                  percentageField: "config.productUsage[0].usagePercent",
                },
              }
            : window,
        ),
      },
    ],
    [
      "gapped product provenance indexes",
      {
        ...trustedProductSnapshot(),
        windows: trustedProductSnapshot().windows.map((window, index) =>
          index === 1
            ? {
                ...window,
                provenance: {
                  ...window.provenance,
                  percentageField: "config.productUsage[1].usagePercent",
                },
              }
            : window,
        ),
      },
    ],
  ])("fails closed for a %s cache row", async (_label, cacheValue) => {
    const installed = await install();
    seedCache(installed, cacheValue);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("connectivity");
    expect(cachedValue(installed)).toBeUndefined();
  });

  it("renders fresh unbound data but never writes or reuses a persistent cache row", async () => {
    const installed = await install();
    await writeAuthEntries(join(installed.grokHome, "auth.json"), {
      "https://auth.x.ai::unbound": {
        key: "fake-unbound",
        auth_mode: "oidc",
        expires_at: "2099-01-01T00:00:00Z",
      },
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(consumerQuotaResponse())
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await invoke(installed);
    expect(fresh.ok).toBe(true);
    expect(cachedValue(installed)).toBeUndefined();

    const failure = await invoke(installed);
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.failure.kind).toBe("connectivity");
    expect(cachedValue(installed)).toBeUndefined();
  });

  it("preserves a trusted current-schema row byte-for-byte during a transient failure", async () => {
    const installed = await install();
    const trusted = trustedSnapshot();
    const trustedText = JSON.stringify(trusted);
    seedCache(installed, trusted);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ stale: true, refreshedAt: trusted.refreshedAt });
    expect(result.data).not.toHaveProperty("accountBinding");
    expect(result.warning?.kind).toBe("connectivity");
    expect(cachedValue(installed)).toEqual(trusted);
    expect(cachedText(installed)).toBe(trustedText);
  });

  it("writes schema 2 with exact operation, period, global, product, reset, and credit provenance", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => consumerQuotaResponse({
      percentUsed: 18.25,
      products: [
        { product: 2, usagePercent: 33.25 },
        { product: 4, usagePercent: 12.5 },
      ],
    })));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      schemaVersion: 2,
      source: "grok-credits-grpc-web",
      sourceVersion: 1,
      operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig",
      period: {
        type: "weekly",
        endAt: "2026-07-20T00:00:00.000Z",
        provenance: "config.currentPeriod",
      },
      windows: [
        {
          id: "credits",
          label: "Weekly",
          percentUsed: 18.25,
          percentRemaining: 81.75,
          provenance: {
            percentageField: "config.creditUsagePercent",
            resetField: "config.currentPeriod.end",
          },
        },
        {
          id: "product:grok-build",
          label: "Grok Build",
          percentUsed: 33.25,
          provenance: {
            percentageField: "config.productUsage[0].usagePercent",
            resetField: "config.currentPeriod.end",
          },
        },
        {
          id: "product:grok-chat",
          label: "Chat",
          percentUsed: 12.5,
        },
      ],
      credits: {
        remaining: 450,
        unit: "credits",
        sourceField: "config.prepaidBalance.val",
      },
    });
    expect(result.data).not.toHaveProperty("accountBinding");
    expect(cachedValue(installed)).toMatchObject(result.data);
  });

  it("applies protobuf scalar zero semantics only on the exact consumer operation", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => noReportedQuotaResponse()));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.windows).toMatchObject([
      {
        id: "credits",
        percentUsed: 0,
        percentRemaining: 100,
        provenance: {
          percentageField: "config.creditUsagePercent",
          omittedProto3Default: true,
        },
      },
      {
        id: "product:grok-build",
        percentUsed: 0,
        percentRemaining: 100,
        provenance: {
          percentageField: "config.productUsage[0].usagePercent",
          omittedProto3Default: true,
        },
      },
    ]);
    expect(result.data.credits).toEqual({
      remaining: 0,
      unit: "credits",
      sourceField: "config.prepaidBalance.val",
    });
    expect(cachedValue(installed)).toMatchObject(result.data);
  });

  it("decodes an omitted product enum as UNSPECIFIED with indexed cache provenance", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => consumerQuotaResponse({
      products: [
        { usagePercent: 7.5 },
        { product: 4, usagePercent: 12.5 },
      ],
    })));

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.windows.slice(1)).toMatchObject([
      {
        id: "product:unspecified",
        label: "Other",
        percentUsed: 7.5,
        provenance: {
          percentageField: "config.productUsage[0].usagePercent",
        },
      },
      {
        id: "product:grok-chat",
        label: "Chat",
        percentUsed: 12.5,
        provenance: {
          percentageField: "config.productUsage[1].usagePercent",
        },
      },
    ]);
    expect(cachedValue(installed)).toMatchObject(result.data);
  });

  it("replaces an old reported snapshot when the exact source later reports proto3 zero", async () => {
    const installed = await install();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(consumerQuotaResponse({ percentUsed: 18 }))
      .mockResolvedValueOnce(noReportedQuotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const reported = await invoke(installed);
    expect(reported.ok).toBe(true);
    if (!reported.ok) return;

    const zero = await invoke(installed);

    expect(zero.ok).toBe(true);
    if (!zero.ok) return;
    expect(zero.data.windows[0]).toMatchObject({
      percentUsed: 0,
      percentRemaining: 100,
      provenance: { omittedProto3Default: true },
    });
    expect(cachedValue(installed)).toMatchObject(zero.data);
  });

  it("preserves same-principal last-good bytes during a transient transport failure", async () => {
    const installed = await install();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(consumerQuotaResponse({ percentUsed: 18 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await invoke(installed);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const stored = cachedText(installed);

    const stale = await invoke(installed);

    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.data).toMatchObject({ stale: true, refreshedAt: fresh.data.refreshedAt });
    expect(stale.data).not.toHaveProperty("accountBinding");
    expect(stale.warning?.kind).toBe("connectivity");
    expect(cachedText(installed)).toBe(stored);
  });

  it("rejects a response above 64 KiB without exposing or parsing its body", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(65_537), { status: 200 })));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "response_too_large",
      sourcesTried: ["local-auth", "consumer-quota-api", "cache"],
    });
    expect(result.failure).not.toHaveProperty("body");
  });

  it("single-flights repeated manual and startup-equivalent refresh calls", async () => {
    const installed = await install();
    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(consumerQuotaResponse({ percentUsed: 25 })), 40);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all(Array.from({ length: 6 }, () => invoke(installed)));

    expect(results.every((result) => result.ok && !result.data.stale)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
