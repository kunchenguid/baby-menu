import type { AuthStorage } from "@earendil-works/pi-coding-agent";
import type { KimiCredentialResolver } from "./kimi-quota-broker";

const KIMI_PROVIDER_ID = "kimi-coding";

type PiAuthStorage = Pick<AuthStorage, "get" | "getApiKey">;

type CreatePiKimiCredentialResolverOptions = {
  createAuthStorage?: () => PiAuthStorage | Promise<PiAuthStorage>;
};

// Narrow adapter around Pi's supported credential API. It never accepts an auth
// path, provider id, runtime override, models.json fallback, or mutation method.
export function createPiKimiCredentialResolver(
  options: CreatePiKimiCredentialResolverOptions = {},
): KimiCredentialResolver {
  let storage: Promise<PiAuthStorage> | undefined;
  const getStorage = (): Promise<PiAuthStorage> => (storage ??= Promise.resolve(
    (options.createAuthStorage ?? createDefaultAuthStorage)(),
  ));

  return {
    async resolveCredential(signal?: AbortSignal) {
      signal?.throwIfAborted();
      const authStorage = await getStorage();
      signal?.throwIfAborted();
      const credential = authStorage.get(KIMI_PROVIDER_ID);
      if (credential?.type && credential.type !== "api_key") return { status: "unsupported" } as const;

      const resolved = await authStorage.getApiKey(KIMI_PROVIDER_ID, { includeFallback: false });
      signal?.throwIfAborted();
      if (typeof resolved !== "string" || !resolved.trim()) return { status: "unavailable" } as const;
      return { status: "available", source: "pi-kimi-coding", apiKey: resolved } as const;
    },
  };
}

async function createDefaultAuthStorage(): Promise<PiAuthStorage> {
  // Keep the full Pi SDK outside startup and the renderer bundle. This import is
  // reached only by the privileged fixed operation when a quota acquisition runs.
  const { AuthStorage } = await import("@earendil-works/pi-coding-agent");
  return AuthStorage.create();
}
