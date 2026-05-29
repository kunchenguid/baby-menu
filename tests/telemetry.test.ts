import { describe, expect, it } from "vitest";

import { createTelemetryClient, resolveTelemetryConfig } from "../src/main/telemetry";

type RecordedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: { type: string; payload: Record<string, unknown> } | undefined;
};

function createFetchSpy(options: { throws?: Error; delayMs?: number } = {}) {
  const requests: RecordedRequest[] = [];
  let release = () => {};
  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    if (options.throws) throw options.throws;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init.headers as Record<string, string>) || {})) {
      headers[key] = value;
    }
    requests.push({
      url: String(url),
      method: init.method || "GET",
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (options.delayMs !== undefined) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, options.delayMs);
        timer.unref?.();
        release = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, requests, release: () => release() };
}

describe("telemetry config resolution", () => {
  it("can be disabled by environment", () => {
    const config = resolveTelemetryConfig({
      env: { BABY_MENU_TELEMETRY: "0" },
      buildHost: "https://build.example",
      buildWebsiteID: "build-id",
    });

    expect(config.enabled).toBe(false);
  });

  it("honours off and false opt-out values", () => {
    for (const value of ["off", "false", "FALSE", " Off "]) {
      const config = resolveTelemetryConfig({
        env: { BABY_MENU_TELEMETRY: value },
        buildHost: "https://build.example",
        buildWebsiteID: "build-id",
      });
      expect(config.enabled).toBe(false);
    }
  });

  it("uses runtime env values before build-time defaults", () => {
    const config = resolveTelemetryConfig({
      env: {
        BABY_MENU_UMAMI_HOST: " https://env.example ",
        BABY_MENU_UMAMI_WEBSITE_ID: " env-id ",
      },
      buildHost: "https://build.example",
      buildWebsiteID: "build-id",
    });

    expect(config).toEqual({
      enabled: true,
      host: "https://env.example",
      websiteID: "env-id",
    });
  });

  it("falls back to the hardcoded host when neither env nor build host is set", () => {
    const config = resolveTelemetryConfig({
      env: {},
      buildHost: "",
      buildWebsiteID: "build-id",
    });

    expect(config).toEqual({
      enabled: true,
      host: "https://a.kunchenguid.com",
      websiteID: "build-id",
    });
  });

  it("disables when no website id is configured", () => {
    const config = resolveTelemetryConfig({
      env: {},
      buildHost: "https://build.example",
      buildWebsiteID: "",
    });

    expect(config.enabled).toBe(false);
  });
});

describe("telemetry client", () => {
  it("returns a no-op client when disabled", async () => {
    const { fetch, requests } = createFetchSpy();
    const client = createTelemetryClient({
      enabled: false,
      host: "https://a.example.com",
      websiteID: "site-1",
      app: "baby-menu",
      version: "1.0.0",
      fetch,
    });

    client.track("app_start", {});
    await client.close(50);
    expect(requests.length).toBe(0);
  });

  it("sends anonymous Umami event payloads", async () => {
    const { fetch, requests } = createFetchSpy();
    const client = createTelemetryClient({
      enabled: true,
      host: "https://a.example.com/umami/",
      websiteID: "site-1",
      app: "baby-menu",
      version: "1.2.3",
      platform: "darwin",
      arch: "arm64",
      fetch,
    });

    client.track("agent_turn", { agent: "claude", status: "success" });
    await client.close(500);

    expect(requests.length).toBe(1);
    expect(requests[0].url).toBe("https://a.example.com/umami/api/send");
    expect(requests[0].method).toBe("POST");
    expect(requests[0].headers["Content-Type"]).toBe("application/json");
    expect(requests[0].headers["User-Agent"]).toMatch(/^baby-menu\/1\.2\.3 telemetry$/);
    const payload = requests[0].body?.payload as Record<string, unknown>;
    expect(payload.website).toBe("site-1");
    expect(payload.hostname).toBe("app");
    expect(payload.title).toBe("Baby Menu");
    expect(payload.url).toBe("app://baby-menu/agent_turn");
    expect(payload.name).toBe("agent_turn");
    const data = payload.data as Record<string, unknown>;
    expect(data.agent).toBe("claude");
    expect(data.status).toBe("success");
    expect(data.platform).toBe("darwin");
    expect(data.arch).toBe("arm64");
    expect(data.version).toBe("1.2.3");
    expect(typeof payload.timestamp).toBe("number");
  });

  it("sends pageviews with an empty event name", async () => {
    const { fetch, requests } = createFetchSpy();
    const client = createTelemetryClient({
      enabled: true,
      host: "https://a.example.com",
      websiteID: "site-1",
      app: "baby-menu",
      version: "1.0.0",
      fetch,
    });

    client.pageview("/launch");
    await client.close(500);

    expect(requests.length).toBe(1);
    const payload = requests[0].body?.payload as Record<string, unknown>;
    expect(payload.name).toBe("");
    expect(payload.url).toBe("/launch");
  });

  it("is best effort and never throws fetch failures", async () => {
    const client = createTelemetryClient({
      enabled: true,
      host: "https://a.example.com",
      websiteID: "site-1",
      app: "baby-menu",
      version: "1.0.0",
      fetch: createFetchSpy({ throws: new Error("network down") }).fetch,
    });

    expect(() => client.track("app_start", {})).not.toThrow();
    await expect(client.close(500)).resolves.toBeUndefined();
  });

  it("close waits only up to the requested timeout", async () => {
    const { fetch, requests, release } = createFetchSpy({ delayMs: 10_000 });
    const client = createTelemetryClient({
      enabled: true,
      host: "https://a.example.com",
      websiteID: "site-1",
      app: "baby-menu",
      version: "1.0.0",
      fetch,
    });

    client.track("app_start", {});
    await client.close(20);
    expect(requests.length).toBe(1);
    release();
  });
});
