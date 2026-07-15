import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { seedExtensionWorkspace } from "../src/main/extension-seeder";
import { loadRecipes } from "../src/main/recipe-loader";

describe("Grok quota recipe", () => {
  const tempDirs: string[] = [];
  const recipeUrl = new URL("../extensions/recipes/grok-quota.html", import.meta.url);

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function readRecipe(): Promise<string> {
    return readFile(recipeUrl, "utf8");
  }

  it("requires official CLI refresh for an expired session before retrying billing", async () => {
    const html = await readRecipe();

    expect(html).toContain("When the selected session credential is expired, invoke the official Grok CLI refresh path before the billing request");
    expect(html).toContain("<code>grok models</code>");
    expect(html).toContain("reread the auth source after the command succeeds");
    expect(html).toContain("Never implement the OIDC refresh-token exchange directly");
    expect(html).not.toContain("There is no CLI fallback for Grok in this recipe");
  });

  it("requires one refresh and retry after authenticated 401 or 403 responses", async () => {
    const html = await readRecipe();

    expect(html).toContain("After every candidate in the initial pass returns <code>401</code> or <code>403</code>");
    expect(html).toContain("retry the billing candidate pass exactly once");
    expect(html).toContain("Never recurse from the retry path");
    expect(html).toContain("module-scope single-flight promise");
    expect(html).toContain("return <code>credential_rejected</code>");
    expect(html).toContain("must not launch another probe or show sign-in guidance");
    expect(html).not.toContain("only return <code>Grok sign-in required</code> after every usable candidate has been rejected");
  });

  it("uses the official credits source without mislabeling monetary spend as quota", async () => {
    const html = await readRecipe();

    expect(html).toContain("GET https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    expect(html).toContain("<code>_x.ai/billing</code>");
    expect(html).toContain("the official Grok UI source of truth");
    expect(html).toContain("<code>config.creditUsagePercent</code>");
    expect(html).toContain("<code>config.currentPeriod.end</code>");
    expect(html).toContain("x-grok-client-mode: billing");
    expect(html).toContain("<code>quota_unreported</code>");
    expect(html).toContain("must not divide <code>config.used.val</code> by <code>config.monthlyLimit.val</code>");
    expect(html).toContain("pay-as-you-go monetary spending cap");
    expect(html).not.toContain("label: \"monthly credits\"");
  });

  it("shares startup, manual, and interval refresh through one bounded request", async () => {
    const html = await readRecipe();

    expect(html).toContain("The host-owned <code>refreshView</code> call is the startup refresh");
    expect(html).toContain("Do not launch a second mount-time request from the component or store");
    expect(html).toContain("The visible manual refresh control must call the same refresh function");
    expect(html).toContain("disable itself while that shared request is pending");
    expect(html).toContain("single-flight the entire <code>getQuota</code> acquisition");
    expect(html).toContain("concurrent startup, interval, and manual calls share one billing request");
  });

  it("distinguishes local auth outcomes and probes before concluding sign-in is required", async () => {
    const html = await readRecipe();

    for (const kind of [
      "auth_source_missing",
      "auth_source_unreadable",
      "auth_source_malformed",
      "auth_source_incompatible",
    ]) {
      expect(html).toContain(`<code>${kind}</code>`);
      expect(html).toContain(`"${kind}"`);
    }
    expect(html).toContain("run the bounded official CLI capability probe at most once");
    expect(html).toContain("then reread and reclassify the resolved auth source");
    expect(html).toContain("Return <code>auth_required</code> only when that probe exits with an explicit verified authentication-required marker");
    expect(html).not.toContain("classify the result as <code>parse_incompatible</code>");
  });

  it("requires stale cache preservation for refresh and service failures", async () => {
    const html = await readRecipe();

    expect(html).toContain("On any later failure except <code>quota_unreported</code>, read the last-good snapshot");
    expect(html).toContain("Refresh failures, CLI discovery or launch failures, connectivity failures, rate limits, quota-service failures, and parse failures all use this stale-cache path");
    expect(html).toContain("When no last-good snapshot exists, return the structured failure instead");
    expect(html).toContain("must keep rendering the cached windows");
  });

  it("defines a versioned cache trust boundary with exact official field provenance", async () => {
    const html = await readRecipe();

    expect(html).toContain("schemaVersion: 1");
    expect(html).toContain('percentageField: "config.creditUsagePercent" | `config.productUsage[${number}].usagePercent`');
    expect(html).toContain('resetField?: "config.currentPeriod.end" | "config.billingPeriodEnd"');
    expect(html).toContain('sourceField: "config.prepaidBalance.val"');
    expect(html).toContain("Legacy, unversioned, unknown-version, future-version, malformed, or provenance-free cache rows are untrusted");
    expect(html).toContain("delete the rejected row instead of rewriting, inferring, or promoting it");
    expect(html).toContain("only a fully valid official-percentage success may write schema version <code>1</code>");
    expect(html).toContain("Every official <code>quota_unreported</code> result is a no-data failure");
    expect(html).toContain("no old percentage, reset, credit amount, stale state, or warning");
    expect(html).toContain("Preserve a trusted row in storage when quota is unreported");
    expect(html).toContain("without reading it into the result");
    expect(html).toContain("no old percentage, reset, credits, stale state, or a warning-backed last-good result");
  });

  it("requires every refresh path to visibly settle with a fresh safe check timestamp", async () => {
    const html = await readRecipe();

    expect(html).toContain("checkedAt: string");
    expect(html).toContain("Every completed startup, interval, and manual acquisition must visibly settle");
    expect(html).toContain("last checked time");
    expect(html).toContain("must not keep or reattach an untrusted prior client-side snapshot");
  });

  it("keeps last-good windows visible while refresh is in flight", async () => {
    const html = await readRecipe();

    expect(html).toContain("While a refresh request is in flight, retain the currently rendered successful windows");
    expect(html).toContain("Show an updating indicator alongside those windows");
    expect(html).toContain("never replace them with a blank, unavailable, or loading-only state");
    expect(html).toContain("continue showing those same windows through the stale-success result");
  });

  it("requires structured no-cache and malformed-response outcomes", async () => {
    const html = await readRecipe();

    for (const kind of [
      "auth_required",
      "auth_source_missing",
      "auth_source_unreadable",
      "auth_source_malformed",
      "auth_source_incompatible",
      "credential_rejected",
      "cli_not_found",
      "cli_launch_failed",
      "connectivity",
      "rate_limited",
      "quota_service",
      "quota_unreported",
      "parse_incompatible",
    ]) {
      expect(html).toContain(`"${kind}"`);
    }
    expect(html).toContain("A malformed or unknown incompatible <code>2xx</code> response is <code>parse_incompatible</code>");
    expect(html).toContain("It is never an authentication failure");
  });

  it("forbids misleading sign-in copy and carries failures through the renderer", async () => {
    const html = await readRecipe();

    expect(html).toContain("The renderer must use <code>failure.kind</code> and <code>failure.message</code>");
    expect(html).toContain("Show sign-in guidance only for <code>auth_required</code>");
    expect(html).toContain("A local expiry timestamp or raw billing <code>401</code>/<code>403</code> alone must never produce sign-in guidance");
    expect(html).not.toContain("How the widget presents it - layout, states, copy, refresh controls - is left to the implementer");
  });

  it("requires GUI-safe executable discovery and a safe inherited environment", async () => {
    const html = await readRecipe();

    expect(html).toContain("<code>$GROK_CLI_PATH</code>");
    expect(html).toContain("<code>$GROK_HOME/bin/grok</code>");
    expect(html).toContain("<code>~/.local/bin/grok</code>");
    expect(html).toContain("<code>~/.grok/bin/grok</code>");
    expect(html).toContain("<code>/opt/homebrew/bin/grok</code>");
    expect(html).toContain("<code>/usr/local/bin/grok</code>");
    expect(html).toContain("preserve the complete inherited <code>process.env</code>");
    expect(html).toContain("<code>shell: false</code>");
    expect(html).toContain("bounded stdout and stderr");
    expect(html).toContain("kill the child on timeout and wait for it to close");
    expect(html).toContain("<code>quota-axi</code> may be used as optional development evidence, but it is never a runtime dependency or refresh authority");
  });

  it("ships the corrected recipe through the real workspace seeding and discovery path", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "baby-menu-grok-recipe-install-"));
    tempDirs.push(rootDir);
    const extensionsDir = join(rootDir, "extensions");
    const templateDir = fileURLToPath(new URL("../extensions/", import.meta.url));

    await expect(seedExtensionWorkspace({ extensionsDir, templateDir })).resolves.toBe(true);

    const recipes = await loadRecipes(join(extensionsDir, "recipes"));
    const installed = recipes.find((recipe) => recipe.id === "grok-quota");
    expect(installed).toBeDefined();
    await expect(readFile(installed!.path, "utf8")).resolves.toBe(await readRecipe());
  });
});
