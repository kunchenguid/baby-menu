import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  KimiCredentialResolution,
  KimiCredentialResolver,
} from "./kimi-quota-broker";

const CREDENTIAL_RELATIVE_PATH = ["credentials", "kimi-code.json"] as const;
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const EXPIRY_SAFETY_SECONDS = 60;
const MAX_UNIX_SECONDS = 253_402_300_799;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

type CreateKimiCodeCliCredentialResolverOptions = {
  environment?: Readonly<Record<string, string | undefined>>;
  homeDir?: string;
  now?: () => number;
  readCredentialFile?: (path: string) => Promise<string | Uint8Array | undefined>;
};

// Read-only adapter for the official Kimi Code CLI token bundle. It exposes
// only a fresh access token and a fixed non-secret source label.
export function createKimiCodeCliCredentialResolver(
  options: CreateKimiCodeCliCredentialResolverOptions = {},
): KimiCredentialResolver {
  const environment = options.environment ?? process.env;
  const now = options.now ?? Date.now;
  const readCredentialFile = options.readCredentialFile ?? readBoundedCredentialFile;

  return {
    async resolveCredential(signal?: AbortSignal): Promise<KimiCredentialResolution> {
      signal?.throwIfAborted();
      const root = environment.KIMI_CODE_HOME || join(options.homeDir ?? homedir(), ".kimi-code");
      const path = join(root, ...CREDENTIAL_RELATIVE_PATH);
      let bytes: string | Uint8Array | undefined;
      try {
        bytes = await readCredentialFile(path);
      } catch {
        signal?.throwIfAborted();
        return { status: "unavailable" };
      }
      signal?.throwIfAborted();
      if (bytes === undefined) return { status: "unavailable" };

      let payload: unknown;
      try {
        const text = typeof bytes === "string" ? bytes : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        payload = JSON.parse(text);
      } catch {
        return { status: "unavailable" };
      }
      if (!isRecord(payload)) return { status: "unavailable" };

      const apiKey = typeof payload.access_token === "string" ? payload.access_token.trim() : "";
      const expiresAt = unixSeconds(payload.expires_at);
      if (!apiKey || expiresAt === undefined || expiresAt <= now() / 1000 + EXPIRY_SAFETY_SECONDS) {
        return { status: "unavailable" };
      }
      return { status: "available", source: "kimi-code-cli", apiKey };
    },
  };
}

export function createKimiCredentialResolverChain(
  resolvers: readonly KimiCredentialResolver[],
): KimiCredentialResolver {
  return {
    async resolveCredential(signal?: AbortSignal): Promise<KimiCredentialResolution> {
      let unsupported = false;
      for (const resolver of resolvers) {
        signal?.throwIfAborted();
        const resolution = await resolver.resolveCredential(signal);
        signal?.throwIfAborted();
        if (resolution.status === "available") return resolution;
        if (resolution.status === "unsupported") unsupported = true;
      }
      return { status: unsupported ? "unsupported" : "unavailable" };
    },
  };
}

async function readBoundedCredentialFile(path: string): Promise<Uint8Array | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
    const file = await handle.stat();
    if (!file.isFile() || file.size > MAX_CREDENTIAL_BYTES) return undefined;

    const buffer = new Uint8Array(MAX_CREDENTIAL_BYTES + 1);
    let total = 0;
    while (total < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > MAX_CREDENTIAL_BYTES) return undefined;
    return buffer.subarray(0, total);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function unixSeconds(value: unknown): number | undefined {
  let seconds: number;
  if (typeof value === "number") {
    seconds = value;
  } else if (typeof value === "string" && DECIMAL_PATTERN.test(value.trim())) {
    seconds = Number(value.trim());
  } else {
    return undefined;
  }
  return Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_UNIX_SECONDS ? seconds : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
