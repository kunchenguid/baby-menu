export type GrokAuthIntegrityOptions = {
  grokHome: string;
  authPath?: string;
  inlineAuthJson?: string;
};

export type GrokAuthIntegritySnapshot = {
  path: string;
  bytes: Buffer;
  mtimeNs: bigint;
};

export function resolveGrokAuthPath(options: GrokAuthIntegrityOptions): string;
export function captureGrokAuthIntegrity(options: GrokAuthIntegrityOptions): Promise<GrokAuthIntegritySnapshot>;
export function grokAuthIntegrityEqual(snapshot: GrokAuthIntegritySnapshot): Promise<boolean>;
