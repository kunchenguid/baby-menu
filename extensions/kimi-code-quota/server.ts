import type { BabyMenuBackgroundTask, BabyMenuServerContext, KimiQuotaResult } from "@babymenu/contracts";

export const extensionId = "kimi-code-quota";

const brokerUnavailable = (): KimiQuotaResult => ({
  status: "error",
  stale: false,
  source: "api",
  checkedAt: new Date().toISOString(),
  error: {
    code: "credential_resolution_failed",
    category: "credential",
    message: "Kimi credential could not be resolved",
  },
});

async function getQuota(_input: unknown, context: BabyMenuServerContext): Promise<KimiQuotaResult> {
  if (!context.kimiQuota) return brokerUnavailable();
  try {
    return await context.kimiQuota.acquire({ maxAgeMs: 60_000 });
  } catch {
    return brokerUnavailable();
  }
}

function getCachedQuota(_input: unknown, context: BabyMenuServerContext): KimiQuotaResult {
  return context.kimiQuota?.readCached() ?? brokerUnavailable();
}

export const actions = { getQuota, getCachedQuota };

export const background: BabyMenuBackgroundTask = {
  intervalMs: 300_000,
  runOnStart: true,
  async run(context) {
    try {
      await context.kimiQuota?.acquire({ force: true });
    } catch {
      // The host scheduler owns the next attempt. Never create a delayed retry here.
    }
  },
};
