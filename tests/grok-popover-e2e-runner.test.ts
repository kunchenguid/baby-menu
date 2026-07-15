import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const scriptUrl = new URL("../scripts/e2e-grok-popover.mjs", import.meta.url);
const docsUrl = new URL("../docs/grok-quota-e2e.md", import.meta.url);
const packageUrl = new URL("../package.json", import.meta.url);

describe("unattended Grok popover E2E runner", () => {
  it("opens the real popover and drives startup and manual refresh without accessibility input", async () => {
    const script = await readFile(scriptUrl, "utf8");

    expect(script).toContain('mkdtemp(join(rootDir, ".cache", "baby-menu", "grok-popover-e2e-"))');
    expect(script).toContain('BABY_MENU_OPEN_POPOVER_ON_START: "1"');
    expect(script).toContain("BABY_MENU_REMOTE_DEBUGGING_PORT");
    expect(script).toContain("waitForCompletedRefresh(1)");
    expect(script).toContain("waitForCompletedRefresh(2)");
    expect(script).toContain('button[data-grok-refresh=\'true\']');
    expect(script).toContain('Input.dispatchMouseEvent", { type: "mousePressed"');
    expect(script).toContain('entry.text === "checking" && entry.disabled === true');
    expect(script).not.toContain("System Events");
    expect(script).not.toContain("AXPress");
  });

  it("compares rendered quota semantics to the official Grok ACP source without exposing auth", async () => {
    const script = await readFile(scriptUrl, "utf8");

    expect(script).toContain('method: "_x.ai/billing"');
    expect(script).toContain("rendered percentage does not match official Grok billing");
    expect(script).toContain("rendered reset does not match official Grok billing");
    expect(script).toContain("expected quota_unreported");
    expect(script).toContain("rendered a fabricated quota or reset");
    expect(script).toContain("refusing a read-only E2E that could refresh it");
    expect(script).toContain("Grok auth metadata changed during read-only E2E");
    expect(script).toContain("JSON.stringify(afterAuthMetadata) !== JSON.stringify(beforeAuth.metadata)");
    expect(script).not.toMatch(/console\.log\([^\n]*(?:authPath|message\.result|config)/);
  });

  it("waits for the app process group and requires successful database cleanup", async () => {
    const script = await readFile(scriptUrl, "utf8");

    expect(script).toContain("await stopDevProcess()");
    expect(script).toContain("await waitForProcessGroupExit(pid, 10_000)");
    expect(script).toContain('signalProcessGroup(pid, "SIGKILL")');
    expect(script).toContain('if (result.status !== 0) fail(`failed to clean Grok E2E database:');
  });

  it("documents the repeatable command and cleanup contract", async () => {
    const [docs, packageText] = await Promise.all([readFile(docsUrl, "utf8"), readFile(packageUrl, "utf8")]);
    const packageJson = JSON.parse(packageText) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["test:e2e:grok-popover"]).toBe("node scripts/e2e-grok-popover.mjs");
    expect(docs).toContain("pnpm test:e2e:grok-popover");
    expect(docs).toContain("no accessibility click or human interaction is required");
    expect(docs).toContain("official Grok ACP agent");
    expect(docs).toContain("drops only its dedicated `grok_quota_e2e_cache` table");
  });
});
