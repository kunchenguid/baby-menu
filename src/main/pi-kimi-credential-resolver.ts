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
    async inspectStoredCredentialType() {
      const credential = (await getStorage()).get(KIMI_PROVIDER_ID);
      return credential?.type;
    },
    async resolveApiKey() {
      const resolved = await (await getStorage()).getApiKey(KIMI_PROVIDER_ID, { includeFallback: false });
      if (typeof resolved !== "string" || !resolved.trim()) return undefined;
      return resolved;
    },
  };
}

async function createDefaultAuthStorage(): Promise<PiAuthStorage> {
  // Keep the full Pi SDK outside startup and the renderer bundle. This import is
  // reached only by the privileged fixed operation when a quota acquisition runs.
  const { AuthStorage } = await import("@earendil-works/pi-coding-agent");
  return AuthStorage.create();
}
