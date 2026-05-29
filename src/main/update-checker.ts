import type { UpdateStatus } from "../shared/contracts";

// The app ships through GitHub Releases (and the Homebrew cask built from them),
// so "is there a newer version" is answered by the public GitHub releases API.
// There is no in-app auto-updater; the indicator just points the user at the
// release page, which is where the cask upgrade instructions live.
const DEFAULT_REPO = "kunchenguid/baby-menu";
// Matches the cadence used elsewhere in Kun's apps: a check at most every 4 hours.
const DEFAULT_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type UpdateChecker = {
  /** Returns the cached status, refreshing in the background once it goes stale. */
  getStatus: () => Promise<UpdateStatus>;
  /** Opens the newest release page (or the generic releases page) externally. */
  openReleasePage: () => Promise<void>;
};

export type CreateUpdateCheckerOptions = {
  currentVersion: string;
  repo?: string;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  openExternal?: (url: string) => void | Promise<void>;
  // Dev affordance: a dev/source build's version is never behind the latest
  // release, so the indicator would never show. When true the checker fabricates
  // an available update (no network call) so the UI can be exercised in dev mode.
  simulateUpdate?: boolean;
};

function parseParts(version: string): number[] {
  // Strip a leading "v" and any "-prerelease"/"+build" suffix, then read the
  // numeric major.minor.patch. Good enough for our own release tags.
  const core = version.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "";
  return core.split(".").map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isNaN(value) ? 0 : value;
  });
}

/** Returns >0 when a is newer than b, <0 when older, 0 when equal. */
export function compareSemver(a: string, b: string): number {
  const left = parseParts(a);
  const right = parseParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function parseLatestRelease(payload: unknown): { version: string; url: string | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === "string" ? record.tag_name : null;
  if (!tag) return null;
  const version = tag.trim().match(/(?:^|-)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/)?.[1] ?? "";
  if (!version) return null;
  return { version, url: typeof record.html_url === "string" ? record.html_url : null };
}

export function createUpdateChecker(options: CreateUpdateCheckerOptions): UpdateChecker {
  const repo = options.repo ?? DEFAULT_REPO;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? (() => Date.now());
  const openExternal = options.openExternal ?? (() => undefined);
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  const releasesPageUrl = `https://github.com/${repo}/releases/latest`;

  let lastStatus: UpdateStatus | null = null;
  let lastCheckedAt: number | null = null;

  const fallbackStatus = (): UpdateStatus => ({
    currentVersion: options.currentVersion,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
  });

  async function refresh(): Promise<UpdateStatus> {
    if (!fetchImpl) return lastStatus ?? fallbackStatus();
    try {
      const response = await fetchImpl(apiUrl, {
        headers: { Accept: "application/vnd.github+json", "User-Agent": "baby-menu" },
      });
      if (!response.ok) throw new Error(`GitHub releases request failed: ${response.status}`);
      const release = parseLatestRelease(await response.json());
      if (!release) throw new Error("GitHub releases response missing a usable tag");
      lastStatus = {
        currentVersion: options.currentVersion,
        latestVersion: release.version,
        updateAvailable: compareSemver(release.version, options.currentVersion) > 0,
        releaseUrl: release.url,
      };
      return lastStatus;
    } catch {
      // Update checks are best-effort. Keep the last good status if we have one,
      // otherwise report "no update" so the shell never shows a false positive.
      return lastStatus ?? fallbackStatus();
    }
  }

  function simulatedStatus(): UpdateStatus {
    const [major = 0, minor = 0, patch = 0] = parseParts(options.currentVersion);
    return {
      currentVersion: options.currentVersion,
      latestVersion: `${major}.${minor}.${patch + 1}`,
      updateAvailable: true,
      releaseUrl: releasesPageUrl,
    };
  }

  async function getStatus(): Promise<UpdateStatus> {
    if (options.simulateUpdate) return simulatedStatus();
    const timestamp = now();
    if (lastStatus && lastCheckedAt !== null && timestamp - lastCheckedAt < intervalMs) {
      return lastStatus;
    }
    lastCheckedAt = timestamp;
    return refresh();
  }

  async function openReleasePage(): Promise<void> {
    const status = await getStatus();
    await openExternal(status.releaseUrl ?? releasesPageUrl);
  }

  return { getStatus, openReleasePage };
}
