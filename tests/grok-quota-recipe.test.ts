import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GROK_OBSERVABILITY_ATTRIBUTES } from "../scripts/grok-popover-observability.mjs";
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

  it("specifies the exact consumer gRPC-web request", async () => {
    const html = await readRecipe();

    expect(html).toContain("POST https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig");
    expect(html).toContain("grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig");
    expect(html).toContain("Content-Type: application/grpc-web+proto");
    expect(html).toContain("Origin: https://grok.com");
    expect(html).toContain("Referer: https://grok.com/?_s=usage");
    expect(html).toContain("x-grpc-web: 1");
    expect(html).toContain("x-user-agent: connect-es/2.1.1");
    expect(html).toContain("00 00 00 00 00");
  });

  it("forbids every regressed, direct-OAuth, monetary, or cookie fallback", async () => {
    const html = await readRecipe();

    expect(html).toContain("Do not send <code>x-grok-client-mode: billing</code>");
    expect(html).toContain("Do not run a healthy-session CLI preflight");
    expect(html).toContain("Never read, post, or exchange a refresh token directly");
    expect(html).toContain("no browser cookies");
    expect(html).toContain("must not be written or reused");
    expect(html).toContain("Never divide <code>config.used.val</code> by <code>config.monthlyLimit.val</code>");
    expect(html).toContain("Do not call <code>GET https://cli-chat-proxy.grok.com/v1/billing?format=credits</code>");
    expect(html).toContain("<code>_x.ai/billing</code>");
  });

  it("requires deterministic OIDC principal selection", async () => {
    const html = await readRecipe();

    expect(html).toContain("<code>https://auth.x.ai::</code>");
    expect(html).toContain("<code>https://accounts.x.ai/sign-in</code>");
    expect(html).toContain("Ignore unrelated and API-key-shaped scopes");
    expect(html).toContain("<code>auth_expired</code>");
    expect(html).toContain("<code>auth_scope_ambiguous</code>");
    expect(html).toContain("before network access");
    expect(html).toContain("internal SHA-256 account binding");
    expect(html).toContain("Never return the account binding");
  });

  it("defines one conditional official-client refresh with reread and principal continuity", async () => {
    const html = await readRecipe();

    expect(html).toContain('documents <code>grok models</code> as "List available models and exit');
    expect(html).toContain("only when the deterministically selected bearer is locally expired");
    expect(html).toContain("HTTP 401, gRPC 16");
    expect(html).toContain("HTTP 403 remains a rejected credential or permission outcome but does not trigger refresh");
    expect(html).toContain("Never invoke it before every acquisition");
    expect(html).toContain('<code>["models"]</code>');
    expect(html).toContain("20-second timeout");
    expect(html).toContain("128 KiB bounded stdout and stderr");
    expect(html).toContain("reread the same resolved auth source");
    expect(html).toContain("new stable account binding to equal the pre-refresh binding");
    expect(html).toContain("exactly one new <code>GetGrokCreditsConfig</code> request");
    expect(html).toContain("<code>auth_principal_changed</code>");
  });

  it("defines the whole-request timeout, response cap, status validation, and narrow retry", async () => {
    const html = await readRecipe();

    expect(html).toContain("15-second whole-request deadline");
    expect(html).toContain("64 KiB streamed response cap");
    expect(html).toContain("both HTTP headers and gRPC-web trailer frames");
    expect(html).toContain("Retry exactly once only");
    expect(html).toContain("Never retry authentication, permission, team scope, parser, schema, or response-size failures");
  });

  it("documents the exact typed protobuf wire contract", async () => {
    const html = await readRecipe();

    expect(html).toContain("<code>creditUsagePercent</code>");
    expect(html).toContain("<code>productUsage</code>");
    expect(html).toContain("<code>currentPeriod</code>");
    expect(html).toContain("<code>prepaidBalance</code>");
    expect(html).toContain("Map product enum 1 through 6 to API, Grok Build, Grok Plugins, Chat, Imagine, and Voice");
    expect(html).toContain("<code>omittedProto3Default: true</code>");
    expect(html).toContain("Use only <code>config.currentPeriod.end</code> as a quota reset");
    expect(html).toContain("return <code>quota_unreported</code> rather than inventing zero");
  });

  it("defines schema 2 exact-source and principal-bound cache trust", async () => {
    const html = await readRecipe();

    expect(html).toContain("schemaVersion: 2");
    expect(html).toContain('source: "grok-credits-grpc-web"');
    expect(html).toContain("sourceVersion: 1");
    expect(html).toContain('operation: "grok_api_v2.GrokBuildBilling.GetGrokCreditsConfig"');
    expect(html).toContain("accountBinding: string; // storage only, never renderer output");
    expect(html).toContain("schema version <code>1</code>");
    expect(html).toContain("wrong-principal rows are untrusted");
    expect(html).toContain("Delete the rejected row instead of rewriting, inferring, or promoting it");
    expect(html).toContain("same-principal trusted row as stale without changing the stored bytes");
  });

  it("defines complete structured failure semantics", async () => {
    const html = await readRecipe();

    for (const kind of [
      "auth_expired",
      "auth_scope_ambiguous",
      "auth_principal_changed",
      "credential_rejected",
      "cli_not_found",
      "cli_launch_failed",
      "connectivity",
      "rate_limited",
      "quota_service",
      "official_quota_source_unavailable",
      "team_scope_unsupported",
      "response_too_large",
      "quota_unreported",
      "parse_incompatible",
    ]) {
      expect(html).toContain(`"${kind}"`);
    }
    expect(html).toContain("Arbitrary gRPC 7 is not authentication");
    expect(html).toContain("known no-personal-team condition");
    expect(html).toContain("Raw response data and gRPC messages never leave the server action");
  });

  it("preserves the shared lifecycle and visible parity contract", async () => {
    const html = await readRecipe();

    expect(html).toContain("The host-owned <code>refreshView</code> call is the startup refresh");
    expect(html).toContain("do not launch a mount-time request");
    expect(html).toContain("disable itself while pending");
    expect(html).toContain("keep the currently rendered successful windows");
    expect(html).toContain("fresh safe <code>checkedAt</code>");
    expect(html).toContain("Show both official used percentage and derived remaining percentage");
    expect(html).toContain("Round only rendered values");
    expect(html).toContain("reset only from <code>config.currentPeriod.end</code>");
  });

  it("enumerates one safe, mechanically checkable root observability contract", async () => {
    const html = await readRecipe();

    for (const attribute of GROK_OBSERVABILITY_ATTRIBUTES) {
      expect(html, attribute).toContain(`<code>${attribute}</code>`);
    }
    expect(html).toContain("Every listed attribute must exist directly on the same <code>data-grok-e2e</code> root");
    expect(html).toContain("<code>waiting</code> only before the first acquisition completes");
    expect(html).toContain("at least <code>1</code> for <code>success</code> or <code>failure</code>");
    expect(html).toContain("Never replace a completed success or failure root with <code>waiting</code>");
    expect(html).toContain("already installed PR 48 layout only");
    expect(html).toContain("A terminal partial root that satisfies neither contract is an explicit observability failure");
    expect(html).toContain("Mechanically parity-check generated fixtures and manually managed copies");
    expect(html).toContain("visible UI remains the user-facing truth");
    expect(html).toContain("Never place account binding, user or team ids, auth values, scopes, headers, raw protobuf, raw provider payload, or credential-refresh output in the DOM");
  });

  it("requires a same-window exact-source oracle with safe identity equality", async () => {
    const html = await readRecipe();

    expect(html).toContain("unattended E2E independently calls the same exact operation in the same time window");
    expect(html).toContain("account-binding equality");
    expect(html).toContain("No credential, cookie, raw principal, account-binding material, header, or raw provider payload");
  });

  it("ships the corrected recipe through workspace seeding and discovery", async () => {
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
