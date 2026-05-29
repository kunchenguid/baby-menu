import { describe, expect, it, vi } from "vitest";
import { compareSemver, createUpdateChecker, parseLatestRelease } from "../src/main/update-checker";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("compareSemver", () => {
  it("orders versions by major, minor, then patch", () => {
    expect(compareSemver("0.2.0", "0.1.7")).toBeGreaterThan(0);
    expect(compareSemver("0.1.7", "0.2.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareSemver("0.1.7", "0.1.7")).toBe(0);
  });

  it("ignores a leading v and any prerelease suffix", () => {
    expect(compareSemver("v0.2.0", "0.1.0")).toBeGreaterThan(0);
    expect(compareSemver("0.2.0-beta.1", "0.1.0")).toBeGreaterThan(0);
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });
});

describe("parseLatestRelease", () => {
  it("extracts the version (without v) and release page url", () => {
    expect(
      parseLatestRelease({ tag_name: "v0.2.0", html_url: "https://github.com/kunchenguid/baby-menu/releases/tag/v0.2.0" }),
    ).toEqual({ version: "0.2.0", url: "https://github.com/kunchenguid/baby-menu/releases/tag/v0.2.0" });
  });

  it("extracts the version from component-prefixed release tags", () => {
    expect(
      parseLatestRelease({
        tag_name: "baby-menu-v0.2.0",
        html_url: "https://github.com/kunchenguid/baby-menu/releases/tag/baby-menu-v0.2.0",
      }),
    ).toEqual({ version: "0.2.0", url: "https://github.com/kunchenguid/baby-menu/releases/tag/baby-menu-v0.2.0" });
  });

  it("returns null when the payload has no usable tag", () => {
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease({})).toBeNull();
    expect(parseLatestRelease({ tag_name: "" })).toBeNull();
  });
});

describe("createUpdateChecker", () => {
  const release =
    (tag: string, url = "https://example.test/rel") =>
    async () =>
      jsonResponse({ tag_name: tag, html_url: url });

  it("reports an update when the latest release is newer", async () => {
    const fetchImpl = vi.fn(release("v0.2.0"));
    const checker = createUpdateChecker({ currentVersion: "0.1.7", fetchImpl, now: () => 0 });

    await expect(checker.getStatus()).resolves.toEqual({
      currentVersion: "0.1.7",
      latestVersion: "0.2.0",
      updateAvailable: true,
      releaseUrl: "https://example.test/rel",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports an update from component-prefixed release tags", async () => {
    const fetchImpl = vi.fn(release("baby-menu-v0.2.0"));
    const checker = createUpdateChecker({ currentVersion: "0.1.7", fetchImpl, now: () => 0 });

    await expect(checker.getStatus()).resolves.toMatchObject({ latestVersion: "0.2.0", updateAvailable: true });
  });

  it("reports no update when the current version is latest or newer", async () => {
    const checker = createUpdateChecker({ currentVersion: "0.2.0", fetchImpl: vi.fn(release("v0.2.0")), now: () => 0 });
    await expect(checker.getStatus()).resolves.toMatchObject({ updateAvailable: false, latestVersion: "0.2.0" });
  });

  it("caches within the interval and refetches only after it elapses", async () => {
    let clock = 0;
    const fetchImpl = vi.fn(release("v0.2.0"));
    const checker = createUpdateChecker({ currentVersion: "0.1.0", fetchImpl, now: () => clock, intervalMs: 1000 });

    await checker.getStatus();
    clock = 500;
    await checker.getStatus();
    expect(fetchImpl).toHaveBeenCalledOnce();

    clock = 1500;
    await checker.getStatus();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("returns a safe status and never throws when the check fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const checker = createUpdateChecker({ currentVersion: "0.1.7", fetchImpl, now: () => 0 });

    await expect(checker.getStatus()).resolves.toEqual({
      currentVersion: "0.1.7",
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
    });
  });

  it("treats a non-ok HTTP response as a failed check", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 403));
    const checker = createUpdateChecker({ currentVersion: "0.1.7", fetchImpl, now: () => 0 });
    await expect(checker.getStatus()).resolves.toMatchObject({ latestVersion: null, updateAvailable: false });
  });

  it("falls back to the last good status after a later failure", async () => {
    let clock = 0;
    let offline = false;
    const fetchImpl = vi.fn(async () => {
      if (offline) throw new Error("offline");
      return jsonResponse({ tag_name: "v0.2.0", html_url: "https://example.test/rel" });
    });
    const checker = createUpdateChecker({ currentVersion: "0.1.0", fetchImpl, now: () => clock, intervalMs: 100 });

    const good = await checker.getStatus();
    clock = 1000;
    offline = true;
    await expect(checker.getStatus()).resolves.toEqual(good);
  });

  it("simulates an available update (for dev mode) without hitting the network", async () => {
    const fetchImpl = vi.fn();
    const checker = createUpdateChecker({ currentVersion: "0.1.7", fetchImpl, now: () => 0, simulateUpdate: true });

    const status = await checker.getStatus();
    expect(status).toMatchObject({ currentVersion: "0.1.7", updateAvailable: true });
    expect(status.latestVersion).toBe("0.1.8");
    expect(status.releaseUrl).not.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("opens the latest release page through the injected opener", async () => {
    const openExternal = vi.fn();
    const checker = createUpdateChecker({
      currentVersion: "0.1.0",
      fetchImpl: vi.fn(release("v0.2.0", "https://example.test/rel")),
      now: () => 0,
      openExternal,
    });

    await checker.openReleasePage();
    expect(openExternal).toHaveBeenCalledWith("https://example.test/rel");
  });

  it("opens the generic releases page when no specific release url is known", async () => {
    const openExternal = vi.fn();
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    const checker = createUpdateChecker({ currentVersion: "0.1.0", repo: "kunchenguid/baby-menu", fetchImpl, now: () => 0, openExternal });

    await checker.openReleasePage();
    expect(openExternal).toHaveBeenCalledWith("https://github.com/kunchenguid/baby-menu/releases/latest");
  });
});
