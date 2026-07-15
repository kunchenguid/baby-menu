import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionDatabase, type ExtensionDatabase } from "../src/main/extension-database";
import { createServerActionRegistry, type ServerActionRegistry } from "../src/main/server-action-registry";

type QuotaFailure = {
  kind: string;
  message: string;
  sourcesTried: string[];
  diagnostic?: string;
};

type QuotaResult =
  | {
      ok: true;
      data: {
        windows: Array<{ percentUsed: number; percentRemaining?: number; resetAt?: string }>;
        refreshedAt: string;
        stale: boolean;
      };
      warning?: QuotaFailure;
    }
  | { ok: false; failure: QuotaFailure };

type InstalledFixture = {
  rootDir: string;
  grokHome: string;
  authAfterPath: string;
  cliCountPath: string;
  registry: ServerActionRegistry;
};

const fixtureUrl = new URL("./fixtures/grok-quota-generated/server.ts.fixture", import.meta.url);
const originalEnv = { ...process.env };

function billingResponse(percentUsed = 22): Response {
  return new Response(
    JSON.stringify({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-13T00:00:00Z",
          end: "2026-07-20T00:00:00Z",
        },
        creditUsagePercent: percentUsed,
        productUsage: [{ product: "GrokBuild", usagePercent: percentUsed }],
        billingPeriodStart: "2026-07-13T00:00:00Z",
        billingPeriodEnd: "2026-07-20T00:00:00Z",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function monetaryBillingResponse(): Response {
  return new Response(
    JSON.stringify({
      config: {
        monthlyLimit: { val: 100 },
        used: { val: 22 },
        onDemandCap: { val: 0 },
        billingPeriodStart: "2026-07-01T00:00:00Z",
        billingPeriodEnd: "2026-08-01T00:00:00Z",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function noReportedQuotaResponse(): Response {
  return new Response(
    JSON.stringify({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-13T00:00:00Z",
          end: "2026-07-20T00:00:00Z",
        },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        prepaidBalance: { val: 0 },
        billingPeriodEnd: "2026-07-20T00:00:00Z",
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
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
      "GROK_QUOTA_TEST_CLI_TIMEOUT_MS",
    ]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    process.env.PATH = originalEnv.PATH;
    for (const database of databases.splice(0)) database.close();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function writeAuth(path: string, options: { key: string; expired: boolean }): Promise<void> {
    await writeFile(
      path,
      JSON.stringify({
        "fake-scope": {
          key: options.key,
          auth_mode: "oidc",
          refresh_token: "fake-refresh-token",
          expires_at: options.expired ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
        },
      }),
    );
  }

  async function writeCli(
    installed: InstalledFixture,
    behavior: "refresh" | "fail" | "timeout",
  ): Promise<void> {
    const executable = join(installed.grokHome, "bin", "grok");
    const body =
      behavior === "refresh"
        ? '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\ncp "$GROK_TEST_AUTH_AFTER" "$GROK_HOME/auth.json"\n'
        : behavior === "timeout"
          ? '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\ntrap "" TERM\nwhile :; do :; done\n'
          : '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\nexit 7\n';
    await writeFile(executable, body);
    await chmod(executable, 0o755);
  }

  async function install(): Promise<InstalledFixture> {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-grok-generated-"));
    tempDirs.push(rootDir);
    const extensionDir = join(rootDir, "extensions", "grok-quota");
    const grokHome = join(rootDir, "grok-home");
    await mkdir(extensionDir, { recursive: true });
    await mkdir(join(grokHome, "bin"), { recursive: true });
    await copyFile(fixtureUrl, join(extensionDir, "server.ts"));

    const authAfterPath = join(rootDir, "auth-after.json");
    const cliCountPath = join(rootDir, "cli-count.txt");
    await writeFile(cliCountPath, "");
    await writeAuth(join(grokHome, "auth.json"), { key: "fake-current", expired: false });
    await writeAuth(authAfterPath, { key: "fake-refreshed", expired: false });

    process.env.GROK_HOME = grokHome;
    process.env.PATH = "/usr/bin:/bin";
    process.env.GROK_TEST_AUTH_AFTER = authAfterPath;
    process.env.GROK_TEST_CLI_COUNT = cliCountPath;
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
    return { rootDir, grokHome, authAfterPath, cliCountPath, registry };
  }

  async function invoke(installed: InstalledFixture): Promise<QuotaResult> {
    return (await installed.registry.invoke("grok-quota", "getQuota")) as QuotaResult;
  }

  it("refreshes an expired session through GROK_HOME under a trimmed GUI PATH", async () => {
    const installed = await install();
    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    await writeCli(installed, "refresh");
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => billingResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stale).toBe(false);
    expect(result.data.windows[0]).toMatchObject({ percentUsed: 22, percentRemaining: 78 });
    expect(await readFile(installed.cliCountPath, "utf8")).toBe("x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-grok-client-mode": "billing" });
    const compiledIds = await readdir(join(installed.rootDir, "cache", "server-actions", "grok-quota"));
    expect(compiledIds).toHaveLength(1);
  });

  it("refreshes once and retries once after a billing 401", async () => {
    const installed = await install();
    await writeCli(installed, "refresh");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(billingResponse(31));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await readFile(installed.cliCountPath, "utf8")).toBe("x");
  });

  it("does not refresh twice when a preflight-refreshed credential is rejected", async () => {
    const installed = await install();
    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    await writeCli(installed, "refresh");
    const fetchMock = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "credential_rejected",
      sourcesTried: ["local-auth", "grok-cli-refresh", "billing-api", "cache"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readFile(installed.cliCountPath, "utf8")).toBe("x");
  });

  it("uses the official usage period reset instead of the monetary billing-period reset", async () => {
    const installed = await install();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            config: {
              currentPeriod: {
                type: "USAGE_PERIOD_TYPE_WEEKLY",
                start: "2026-07-13T00:00:00Z",
                end: "2026-07-20T00:00:00Z",
              },
              creditUsagePercent: 22,
              billingPeriodEnd: "2026-08-01T00:00:00Z",
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await invoke(installed);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.windows[0]?.resetAt).toBe("2026-07-20T00:00:00Z");
  });

  it("never turns monetary monthly spend into a quota percentage", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => monetaryBillingResponse()));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "quota_unreported",
      message: "Official Grok billing did not report a quota percentage",
    });
  });

  it("classifies the official known-period response without a percentage as unreported quota", async () => {
    const installed = await install();
    vi.stubGlobal("fetch", vi.fn(async () => noReportedQuotaResponse()));

    const result = await invoke(installed);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("quota_unreported");
  });

  it("preserves the exact last-good quota when the official source stops reporting a percentage", async () => {
    const installed = await install();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(billingResponse(18))
      .mockResolvedValueOnce(noReportedQuotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const fresh = await invoke(installed);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;

    const unreported = await invoke(installed);

    expect(unreported.ok).toBe(true);
    if (!unreported.ok) return;
    expect(unreported.data).toMatchObject({
      stale: true,
      refreshedAt: fresh.data.refreshedAt,
      windows: fresh.data.windows,
    });
    expect(unreported.warning).toMatchObject({
      kind: "quota_unreported",
      message: "Official Grok billing did not report a quota percentage",
    });
  });

  it("preserves last-good data for refresh and parser failures", async () => {
    const installed = await install();
    await writeCli(installed, "fail");
    const fetchMock = vi.fn(async () => billingResponse(18));
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await invoke(installed);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;

    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    const refreshFailure = await invoke(installed);
    expect(refreshFailure.ok).toBe(true);
    if (!refreshFailure.ok) return;
    expect(refreshFailure.data).toMatchObject({ stale: true, refreshedAt: fresh.data.refreshedAt });
    expect(refreshFailure.warning?.kind).toBe("cli_launch_failed");

    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-current", expired: false });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ config: {} }), { status: 200 }));
    const parseFailure = await invoke(installed);
    expect(parseFailure.ok).toBe(true);
    if (!parseFailure.ok) return;
    expect(parseFailure.data).toMatchObject({ stale: true, refreshedAt: fresh.data.refreshedAt });
    expect(parseFailure.warning?.kind).toBe("parse_incompatible");
  });

  it("returns a structured bounded CLI failure when no cache exists", async () => {
    const installed = await install();
    process.env.GROK_QUOTA_TEST_CLI_TIMEOUT_MS = "80";
    await writeAuth(join(installed.grokHome, "auth.json"), { key: "fake-expired", expired: true });
    await writeCli(installed, "timeout");
    vi.stubGlobal("fetch", vi.fn());
    const started = performance.now();

    const result = await invoke(installed);

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject({
      kind: "cli_launch_failed",
      message: "Grok CLI refresh timed out",
      diagnostic: "timeout",
      sourcesTried: ["local-auth", "grok-cli-refresh", "cache"],
    });
    expect(result.failure).not.toHaveProperty("stdout");
    expect(result.failure).not.toHaveProperty("stderr");
  });

  it("single-flights repeated manual and startup-equivalent refresh calls", async () => {
    const installed = await install();
    await writeCli(installed, "refresh");
    const fetchMock = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(billingResponse(25)), 40);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all(Array.from({ length: 6 }, () => invoke(installed)));

    expect(results.every((result) => result.ok && !result.data.stale)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await readFile(installed.cliCountPath, "utf8")).toBe("");
  });
});
