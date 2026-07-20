import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KimiQuotaContent } from "../extensions/kimi-code-quota/components";
import { createKimiQuotaViewStore } from "../extensions/kimi-code-quota/store";
import {
  createKimiCodeCliCredentialResolver,
  createKimiCredentialResolverChain,
} from "../src/main/kimi-code-cli-credential-resolver";
import { createExtensionDatabase } from "../src/main/extension-database";
import { createKimiQuotaBroker, type KimiQuotaLogEvent } from "../src/main/kimi-quota-broker";
import { createServerActionRegistry } from "../src/main/server-action-registry";
import type { BabyMenuApi } from "../src/shared/contracts";

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const CLI_ACCESS_TOKEN = "synthetic-e2e-kimi-cli-access-686d";
const CLI_REFRESH_TOKEN = "synthetic-e2e-kimi-cli-refresh-never-use-d4af";
const repoRoot = resolve(import.meta.dirname, "..");
const extensionDir = join(repoRoot, "extensions", "kimi-code-quota");
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Kimi CLI quota real Baby Menu path", () => {
  it("flows a fresh CLI credential through the host broker and capability into the widget", async () => {
    const root = await mkdtemp(join(tmpdir(), "baby-menu-kimi-cli-e2e-"));
    tempDirs.push(root);
    const kimiHome = join(root, "kimi-home");
    await mkdir(join(kimiHome, "credentials"), { recursive: true });
    await writeFile(join(kimiHome, "credentials", "kimi-code.json"), JSON.stringify({
      access_token: CLI_ACCESS_TOKEN,
      refresh_token: CLI_REFRESH_TOKEN,
      expires_at: NOW_MS / 1000 + 3600,
    }));

    const cliResolver = createKimiCodeCliCredentialResolver({
      environment: {
        KIMI_CODE_HOME: kimiHome,
        KIMI_CODE_BASE_URL: "https://untrusted-origin.invalid/coding/v1",
      },
      now: () => NOW_MS,
    });
    const credentialResolver = createKimiCredentialResolverChain([
      { resolveCredential: vi.fn(async () => ({ status: "unavailable" as const })) },
      cliResolver,
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      usage: { limit: 200, used: 50, resetTime: "2026-07-26T12:00:00Z" },
      limits: [{
        window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
        detail: { limit: 100, used: 24, resetAt: "2026-07-19T17:00:00Z" },
      }],
    }), { headers: { "content-type": "application/json" } }));
    const db = createExtensionDatabase(":memory:");
    const logEvents: KimiQuotaLogEvent[] = [];
    const broker = createKimiQuotaBroker({
      db,
      credentialResolver,
      fetch: fetchMock,
      now: () => NOW_MS,
      userAgent: "baby-menu-e2e/1.0.0",
      logger: (event) => logEvents.push(event),
    });
    const registry = createServerActionRegistry({
      rootDir: root,
      actionRoots: [extensionDir],
      cacheDir: join(root, "server-cache"),
      db,
      kimiQuota: broker,
    });
    const api = {
      capabilities: {
        invoke: (_extensionId: string, action: string) => registry.invoke("kimi-code-quota", action),
      },
    } as unknown as BabyMenuApi;
    const store = createKimiQuotaViewStore(api);

    await store.refresh();

    const view = store.getSnapshot();
    const markup = renderToStaticMarkup(createElement(KimiQuotaContent, { view, now: NOW_MS }));
    const [input, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const cacheRows = db.query("SELECT key, value FROM kimi_quota_cache ORDER BY key");
    const observable = JSON.stringify({ view, markup, logEvents, cache: cacheRows });

    expect(input).toBe("https://api.kimi.com/coding/v1/usages");
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${CLI_ACCESS_TOKEN}`);
    expect(view.result).toMatchObject({
      status: "fresh",
      credentialSource: "kimi-code-cli",
      snapshot: {
        credentialSource: "kimi-code-cli",
        windows: [
          { id: "weekly", percentUsed: 25 },
          { id: "five_hour", percentUsed: 24 },
        ],
      },
    });
    expect(markup).toContain("Kimi Code");
    expect(markup).toContain("76%");
    expect(markup).toContain("75%");
    expect(JSON.stringify(cacheRows)).toContain("kimi-code-cli");
    expect(observable).not.toContain(CLI_ACCESS_TOKEN);
    expect(observable).not.toContain(CLI_REFRESH_TOKEN);
    expect(observable).not.toMatch(/authorization|bearer|refresh_token|access_token/i);

    db.close();
  });
});
