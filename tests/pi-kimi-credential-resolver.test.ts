import { describe, expect, it, vi } from "vitest";
import { createPiKimiCredentialResolver } from "../src/main/pi-kimi-credential-resolver";

function authStorage(overrides: Record<string, unknown> = {}) {
  return {
    get: vi.fn(() => undefined),
    getApiKey: vi.fn(async () => undefined),
    setRuntimeApiKey: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

describe("Pi-backed Kimi credential resolver", () => {
  it("resolves a managed kimi-coding API key through the supported Pi API", async () => {
    const storage = authStorage({
      get: vi.fn(() => ({ type: "api_key", key: "not-observed-by-the-broker" })),
      getApiKey: vi.fn(async () => "managed-synthetic-key"),
    });
    const createAuthStorage = vi.fn(() => storage);
    const resolver = createPiKimiCredentialResolver({ createAuthStorage });

    await expect(resolver.inspectStoredCredentialType()).resolves.toBe("api_key");
    await expect(resolver.resolveApiKey()).resolves.toBe("managed-synthetic-key");
    expect(createAuthStorage).toHaveBeenCalledWith();
    expect(storage.get).toHaveBeenCalledWith("kimi-coding");
    expect(storage.getApiKey).toHaveBeenCalledWith("kimi-coding", { includeFallback: false });
    expect(storage.setRuntimeApiKey).not.toHaveBeenCalled();
    expect(storage.login).not.toHaveBeenCalled();
    expect(storage.logout).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("allows Pi to resolve KIMI_API_KEY when no managed credential exists", async () => {
    const storage = authStorage({ getApiKey: vi.fn(async () => "environment-synthetic-key") });
    const resolver = createPiKimiCredentialResolver({ createAuthStorage: () => storage });

    await expect(resolver.inspectStoredCredentialType()).resolves.toBeUndefined();
    await expect(resolver.resolveApiKey()).resolves.toBe("environment-synthetic-key");
    expect(storage.getApiKey).toHaveBeenCalledOnce();
  });

  it("exposes only credential type metadata before resolution", async () => {
    const sentinel = "sentinel-kimi-credential-7ed4f1";
    const storage = authStorage({
      get: vi.fn(() => ({ type: "oauth", access: sentinel, refresh: sentinel, expires: Date.now() + 60_000 })),
    });
    const resolver = createPiKimiCredentialResolver({ createAuthStorage: () => storage });

    const metadata = await resolver.inspectStoredCredentialType();

    expect(metadata).toBe("oauth");
    expect(JSON.stringify(metadata)).not.toContain(sentinel);
    expect(storage.getApiKey).not.toHaveBeenCalled();
  });

  it("does not initialize a model registry, model catalog, or inference runtime", async () => {
    const storage = authStorage({ getApiKey: vi.fn(async () => "synthetic-key") });
    const resolver = createPiKimiCredentialResolver({ createAuthStorage: () => storage });

    await resolver.resolveApiKey();

    expect(Object.keys(storage)).not.toContain("modelRegistry");
    expect(storage.setRuntimeApiKey).not.toHaveBeenCalled();
  });
});
