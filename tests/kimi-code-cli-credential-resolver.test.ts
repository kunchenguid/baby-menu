import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createKimiCodeCliCredentialResolver,
  createKimiCredentialResolverChain,
} from "../src/main/kimi-code-cli-credential-resolver";
import type { KimiCredentialResolver } from "../src/main/kimi-quota-broker";

const NOW_MS = Date.parse("2026-07-19T12:00:00.000Z");
const ACCESS_TOKEN = "synthetic-cli-access-4ff2d8";
const REFRESH_TOKEN = "synthetic-cli-refresh-never-use-902c";
const tempDirs: string[] = [];

function available(source: "pi-kimi-coding" | "kimi-code-cli", apiKey = ACCESS_TOKEN) {
  return { status: "available" as const, source, apiKey };
}

function resolver(result: Awaited<ReturnType<KimiCredentialResolver["resolveCredential"]>>): KimiCredentialResolver {
  return { resolveCredential: vi.fn(async () => result) };
}

async function temporaryHome(prefix = "baby-menu-kimi-cli-") {
  const home = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(home);
  return home;
}

async function writeCredential(home: string, payload: unknown) {
  const credentialsDir = join(home, "credentials");
  await mkdir(credentialsDir, { recursive: true });
  const path = join(credentialsDir, "kimi-code.json");
  await writeFile(path, typeof payload === "string" ? payload : JSON.stringify(payload), { mode: 0o600 });
  return path;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe("official Kimi Code CLI credential discovery", () => {
  it("reads the official default credential path under the OS home", async () => {
    const home = await temporaryHome();
    const credentialPath = await writeCredential(join(home, ".kimi-code"), {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW_MS / 1000 + 3600,
    });
    const readCredentialFile = vi.fn(async (path: string) => readFile(path));
    const credentialResolver = createKimiCodeCliCredentialResolver({
      environment: {},
      homeDir: home,
      now: () => NOW_MS,
      readCredentialFile,
    });

    await expect(credentialResolver.resolveCredential()).resolves.toEqual(available("kimi-code-cli"));
    expect(readCredentialFile).toHaveBeenCalledWith(credentialPath);
  });

  it("prefers KIMI_CODE_HOME for the complete CLI data root", async () => {
    const osHome = await temporaryHome("baby-menu-kimi-os-home-");
    const overriddenHome = await temporaryHome("baby-menu-kimi-override-");
    const credentialPath = await writeCredential(overriddenHome, {
      access_token: ACCESS_TOKEN,
      expires_at: NOW_MS / 1000 + 3600,
    });
    const readCredentialFile = vi.fn(async (path: string) => readFile(path));
    const credentialResolver = createKimiCodeCliCredentialResolver({
      environment: { KIMI_CODE_HOME: overriddenHome },
      homeDir: osHome,
      now: () => NOW_MS,
      readCredentialFile,
    });

    await expect(credentialResolver.resolveCredential()).resolves.toEqual(available("kimi-code-cli"));
    expect(readCredentialFile).toHaveBeenCalledWith(credentialPath);
    expect(readCredentialFile).not.toHaveBeenCalledWith(join(osHome, ".kimi-code", "credentials", "kimi-code.json"));
  });

  it.each([
    ["integer Unix seconds", Math.floor(NOW_MS / 1000) + 3600],
    ["fractional Unix seconds", NOW_MS / 1000 + 3600.5],
    ["numeric-string Unix seconds", String(NOW_MS / 1000 + 3600)],
  ])("accepts %s expires_at", async (_description, expiresAt) => {
    const home = await temporaryHome();
    await writeCredential(home, { access_token: `  ${ACCESS_TOKEN}  `, expires_at: expiresAt });
    const credentialResolver = createKimiCodeCliCredentialResolver({
      environment: { KIMI_CODE_HOME: home },
      now: () => NOW_MS,
    });

    await expect(credentialResolver.resolveCredential()).resolves.toEqual(available("kimi-code-cli"));
  });

  it.each([
    ["missing file", undefined],
    ["malformed JSON", "{broken"],
    ["oversized file", " ".repeat(64 * 1024 + 1)],
    ["non-object JSON", []],
    ["missing access token", { expires_at: NOW_MS / 1000 + 3600 }],
    ["empty access token", { access_token: "  ", expires_at: NOW_MS / 1000 + 3600 }],
    ["missing expiry", { access_token: ACCESS_TOKEN }],
    ["malformed expiry", { access_token: ACCESS_TOKEN, expires_at: "tomorrow" }],
    ["millisecond expiry", { access_token: ACCESS_TOKEN, expires_at: NOW_MS + 3600_000 }],
    ["expired token", { access_token: ACCESS_TOKEN, expires_at: NOW_MS / 1000 - 1 }],
    ["near-expiry token", { access_token: ACCESS_TOKEN, expires_at: NOW_MS / 1000 + 60 }],
  ])("treats a %s credential as unavailable", async (_description, payload) => {
    const home = await temporaryHome();
    if (payload !== undefined) await writeCredential(home, payload);
    const credentialResolver = createKimiCodeCliCredentialResolver({
      environment: { KIMI_CODE_HOME: home },
      now: () => NOW_MS,
    });

    await expect(credentialResolver.resolveCredential()).resolves.toEqual({ status: "unavailable" });
  });

  it("accepts a token only after the imminent-expiry safety boundary", async () => {
    const home = await temporaryHome();
    await writeCredential(home, { access_token: ACCESS_TOKEN, expires_at: NOW_MS / 1000 + 60.001 });
    const credentialResolver = createKimiCodeCliCredentialResolver({
      environment: { KIMI_CODE_HOME: home },
      now: () => NOW_MS,
    });

    await expect(credentialResolver.resolveCredential()).resolves.toEqual(available("kimi-code-cli"));
  });

  it("never returns the refresh token or mutates the CLI credential", async () => {
    const home = await temporaryHome();
    const credentialPath = await writeCredential(home, {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: NOW_MS / 1000 + 3600,
    });
    const beforeBytes = await readFile(credentialPath);
    const beforeStat = await stat(credentialPath);
    const credentialResolver = createKimiCodeCliCredentialResolver({
      environment: { KIMI_CODE_HOME: home },
      now: () => NOW_MS,
    });

    const resolution = await credentialResolver.resolveCredential();
    const afterStat = await stat(credentialPath);

    expect(JSON.stringify(resolution)).not.toContain(REFRESH_TOKEN);
    expect(await readFile(credentialPath)).toEqual(beforeBytes);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it("contains no credential mutation, process launch, Pi auth-file, or device-id behavior", async () => {
    const source = await readFile(join(import.meta.dirname, "..", "src", "main", "kimi-code-cli-credential-resolver.ts"), "utf8");

    expect(source).not.toMatch(/node:child_process|\bexec(?:File)?\s*\(|\bspawn\s*\(|\bfetch\s*\(|writeFile|appendFile|mkdir|rename|unlink|chmod/);
    expect(source).not.toMatch(/pi-coding-agent|\.pi[\\/]agent[\\/]auth\.json|refresh_token|device_id|device-id/i);
  });
});

describe("Kimi credential source precedence", () => {
  it("uses the Pi-supported kimi-coding source without touching the CLI fallback", async () => {
    const pi = resolver(available("pi-kimi-coding", "synthetic-pi-key"));
    const cli = resolver(available("kimi-code-cli"));
    const chain = createKimiCredentialResolverChain([pi, cli]);

    await expect(chain.resolveCredential()).resolves.toEqual(available("pi-kimi-coding", "synthetic-pi-key"));
    expect(cli.resolveCredential).not.toHaveBeenCalled();
  });

  it.each(["unavailable", "unsupported"] as const)("uses a fresh CLI token only when Pi is %s", async (status) => {
    const pi = resolver({ status });
    const cli = resolver(available("kimi-code-cli"));
    const chain = createKimiCredentialResolverChain([pi, cli]);

    await expect(chain.resolveCredential()).resolves.toEqual(available("kimi-code-cli"));
  });

  it("preserves Pi's unsupported state when the CLI fallback is unavailable", async () => {
    const chain = createKimiCredentialResolverChain([
      resolver({ status: "unsupported" }),
      resolver({ status: "unavailable" }),
    ]);

    await expect(chain.resolveCredential()).resolves.toEqual({ status: "unsupported" });
  });

  it("does not hide primary credential resolution failures behind the fallback", async () => {
    const primaryFailure = new Error("bounded primary failure");
    const pi: KimiCredentialResolver = {
      resolveCredential: vi.fn(async () => Promise.reject(primaryFailure)),
    };
    const cli = resolver(available("kimi-code-cli"));
    const chain = createKimiCredentialResolverChain([pi, cli]);

    await expect(chain.resolveCredential()).rejects.toBe(primaryFailure);
    expect(cli.resolveCredential).not.toHaveBeenCalled();
  });

  it("does not start the CLI fallback when cancellation occurs during Pi resolution", async () => {
    const controller = new AbortController();
    let finishPi: ((resolution: { status: "unavailable" }) => void) | undefined;
    const pi: KimiCredentialResolver = {
      resolveCredential: vi.fn(() => new Promise<{ status: "unavailable" }>((resolve) => {
        finishPi = resolve;
      })),
    };
    const readCredentialFile = vi.fn(async () => JSON.stringify({
      access_token: ACCESS_TOKEN,
      expires_at: NOW_MS / 1000 + 3600,
    }));
    const cli = createKimiCodeCliCredentialResolver({
      environment: { KIMI_CODE_HOME: "/synthetic-kimi-home" },
      now: () => NOW_MS,
      readCredentialFile,
    });
    const chain = createKimiCredentialResolverChain([pi, cli]);
    const resolution = chain.resolveCredential(controller.signal);

    controller.abort();
    finishPi?.({ status: "unavailable" });

    await expect(resolution).rejects.toMatchObject({ name: "AbortError" });
    expect(readCredentialFile).not.toHaveBeenCalled();
  });
});
