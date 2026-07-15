import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export function resolveGrokAuthPath({ grokHome, authPath, inlineAuthJson }) {
  if (inlineAuthJson) throw new Error("Grok E2E requires file-backed provider auth");
  return authPath || join(grokHome, "auth.json");
}

export async function captureGrokAuthIntegrity(options) {
  const path = resolveGrokAuthPath(options);
  try {
    const [bytes, metadata] = await Promise.all([
      readFile(path),
      stat(path, { bigint: true }),
    ]);
    return { path, bytes, mtimeNs: metadata.mtimeNs };
  } catch {
    throw new Error("Grok E2E could not snapshot provider auth");
  }
}

export async function grokAuthIntegrityEqual(snapshot) {
  try {
    const [bytes, metadata] = await Promise.all([
      readFile(snapshot.path),
      stat(snapshot.path, { bigint: true }),
    ]);
    return snapshot.bytes.equals(bytes) && snapshot.mtimeNs === metadata.mtimeNs;
  } catch {
    return false;
  }
}
