import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExtensionDatabase, type ExtensionDatabase } from "../src/main/extension-database";
import { createServerActionRegistry, type ServerActionRegistry } from "../src/main/server-action-registry";

type Result =
  | { ok: true; data: { stale: boolean; refreshedAt: string }; warning?: { kind: string } }
  | { ok: false; failure: { kind: string } };

type Harness = {
  rootDir: string;
  grokHome: string;
  authPath: string;
  refreshedAuthPath: string;
  cliCountPath: string;
  registry: ServerActionRegistry;
};

const fixtureUrl = new URL("./fixtures/grok-quota-generated/server.ts.fixture", import.meta.url);
const originalEnv = { ...process.env };
const databases: ExtensionDatabase[] = [];
const roots: string[] = [];

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
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

function frame(payload: Uint8Array, flags = 0): Uint8Array {
  const output = new Uint8Array(payload.length + 5);
  output[0] = flags;
  new DataView(output.buffer).setUint32(1, payload.length);
  output.set(payload, 5);
  return output;
}

function quotaResponse(percentUsed = 22): Response {
  const end = Date.parse("2026-07-20T00:00:00Z") / 1000;
  const start = end - 7 * 86_400;
  const period = concat(
    scalar(1, 2),
    message(2, scalar(1, start)),
    message(3, scalar(1, end)),
  );
  const config = concat(
    fixed32(1, percentUsed),
    message(7, concat(scalar(1, 2), fixed32(2, percentUsed))),
    message(8, period),
    message(12, new Uint8Array()),
  );
  const payload = message(1, config);
  const trailers = frame(new TextEncoder().encode("grpc-status: 0\r\n"), 0x80);
  return new Response(Uint8Array.from(concat(frame(payload), trailers)).buffer, {
    status: 200,
    headers: { "content-type": "application/grpc-web+proto" },
  });
}

function authEntry(key: string, userId = "fixture-user", expired = false): Record<string, unknown> {
  return {
    "https://auth.x.ai::fixture-client": {
      key,
      auth_mode: "oidc",
      user_id: userId,
      team_id: "fixture-team",
      expires_at: expired ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
    },
  };
}

async function writeAuth(path: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path, JSON.stringify(value));
}

async function createHarness(
  initialAuth = authEntry("fake-current"),
  refreshedAuth = authEntry("fake-refreshed"),
  cliBehavior: "refresh" | "fail" = "refresh",
): Promise<Harness> {
  const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-grok-refresh-e2e-"));
  roots.push(rootDir);
  const extensionDir = join(rootDir, "extensions", "grok-quota");
  const grokHome = join(rootDir, "grok-home");
  const authPath = join(grokHome, "auth.json");
  const refreshedAuthPath = join(rootDir, "refreshed-auth.json");
  const cliCountPath = join(rootDir, "cli-count.txt");
  const executable = join(grokHome, "bin", "grok");
  await mkdir(extensionDir, { recursive: true });
  await mkdir(join(grokHome, "bin"), { recursive: true });
  await copyFile(fixtureUrl, join(extensionDir, "server.ts"));
  await writeAuth(authPath, initialAuth);
  await writeAuth(refreshedAuthPath, refreshedAuth);
  await writeFile(cliCountPath, "");
  await writeFile(
    executable,
    cliBehavior === "refresh"
      ? '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\ncp "$GROK_TEST_AUTH_AFTER" "$GROK_HOME/auth.json"\n'
      : '#!/bin/sh\nprintf x >> "$GROK_TEST_CLI_COUNT"\nexit 7\n',
  );
  await chmod(executable, 0o755);

  process.env.GROK_HOME = grokHome;
  process.env.GROK_CLI_PATH = executable;
  process.env.GROK_TEST_AUTH_AFTER = refreshedAuthPath;
  process.env.GROK_TEST_CLI_COUNT = cliCountPath;
  process.env.PATH = "/usr/bin:/bin";
  delete process.env.GROK_AUTH_JSON;
  delete process.env.GROK_AUTH_PATH;

  const database = createExtensionDatabase(join(rootDir, "baby-menu.db"));
  databases.push(database);
  const registry = createServerActionRegistry({
    rootDir,
    cacheDir: join(rootDir, "cache", "server-actions"),
    db: database,
  });
  return { rootDir, grokHome, authPath, refreshedAuthPath, cliCountPath, registry };
}

async function invoke(harness: Harness): Promise<Result> {
  return harness.registry.invoke("grok-quota", "getQuota") as Promise<Result>;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const key of ["GROK_HOME", "GROK_CLI_PATH", "GROK_TEST_AUTH_AFTER", "GROK_TEST_CLI_COUNT"]) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  process.env.PATH = originalEnv.PATH;
  for (const database of databases.splice(0)) database.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Grok conditional official refresh E2E", () => {
  it("refreshes local expiry through only the fake official-client executable and rereads auth", async () => {
    const harness = await createHarness(authEntry("fake-expired", "fixture-user", true));
    const fetchMock = vi.fn<typeof fetch>(async () => quotaResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(harness);

    expect(result.ok).toBe(true);
    expect(await readFile(harness.cliCountPath, "utf8")).toBe("x");
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-refreshed");
  });

  it("refreshes one HTTP 401 and retries exact gRPC once with the reread bearer", async () => {
    const harness = await createHarness();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(quotaResponse(31));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(harness);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer fake-refreshed");
    expect(await readFile(harness.cliCountPath, "utf8")).toBe("x");
  });

  it("refuses a refreshed principal change without a second gRPC request", async () => {
    const harness = await createHarness(
      authEntry("fake-current"),
      authEntry("fake-other", "other-user"),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await invoke(harness);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe("auth_principal_changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves same-principal last-good bytes when conditional refresh fails", async () => {
    const harness = await createHarness(authEntry("fake-current"), authEntry("unused"), "fail");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(quotaResponse(18))
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const fresh = await invoke(harness);
    expect(fresh.ok).toBe(true);

    const stale = await invoke(harness);

    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.data).toMatchObject({ stale: true, refreshedAt: fresh.ok ? fresh.data.refreshedAt : "" });
    expect(stale.warning?.kind).toBe("cli_launch_failed");
  });

  it("does not execute even the fake CLI on a healthy exact-source success", async () => {
    const harness = await createHarness();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => quotaResponse()));

    const result = await invoke(harness);

    expect(result.ok).toBe(true);
    expect(await readFile(harness.cliCountPath, "utf8")).toBe("");
  });
});
