import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadRecipes } from "../src/main/recipe-loader";
import { getRecipesDir } from "../src/shared/paths";

describe("loadRecipes", () => {
  it("resolves recipes inside the active extension workspace", () => {
    expect(getRecipesDir("/repo")).toBe("/repo/extensions/recipes");
  });

  it("discovers the initial HTML recipes with titles", async () => {
    const recipes = await loadRecipes(new URL("../extensions/recipes/", import.meta.url));

    expect(recipes.map((recipe) => recipe.id).sort()).toEqual([
      "claude-code-quota",
      "codex-quota",
      "copilot-quota",
      "cursor-quota",
      "grok-quota",
    ]);
    expect(recipes.every((recipe) => recipe.title.length > 0)).toBe(true);
  });

  it("keeps quota recipes self-contained for agent implementation", async () => {
    const recipeUrls = [
      new URL("../extensions/recipes/claude-code-quota.html", import.meta.url),
      new URL("../extensions/recipes/codex-quota.html", import.meta.url),
      new URL("../extensions/recipes/copilot-quota.html", import.meta.url),
      new URL("../extensions/recipes/cursor-quota.html", import.meta.url),
      new URL("../extensions/recipes/grok-quota.html", import.meta.url),
    ];

    for (const recipeUrl of recipeUrls) {
      const html = await readFile(recipeUrl, "utf8");
      expect(html).toContain("This recipe is self-contained");
      expect(html).toContain("Recommended Data Source Order");
      expect(html).toContain("Implementation Contract");
      expect(html).toContain("Server action response shape");
      expect(html).toContain('data-theme="wireframe"');
      expect(html).toContain("https://cdn.jsdelivr.net/npm/daisyui@5");
      expect(html).toContain("https://cdn.jsdelivr.net/npm/daisyui@5/themes.css");
      expect(html).toContain("https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4");
      expect(html).not.toContain("<style>");
      expect(html).not.toMatch(/Review\s+<a|for discovery and behavior ideas|another repository/i);
    }
  });

  it("keeps Copilot transient 403 handling separate from token rejection", async () => {
    const html = await readFile(new URL("../extensions/recipes/copilot-quota.html", import.meta.url), "utf8");

    expect(html).toContain("Do not classify every <code>403</code> as rejected auth");
    expect(html).toContain("<code>x-ratelimit-remaining: 0</code>");
    expect(html).toContain("<code>x-ratelimit-reset</code> only when <code>x-ratelimit-remaining</code> is <code>0</code>");
    expect(html).toContain("<code>retry-after</code>");
    expect(html).toContain("secondary rate limits");
    expect(html).not.toContain("a future <code>x-ratelimit-reset</code>");
  });

  it("keeps Copilot local auth parse failures out of sign-in-required handling", async () => {
    const html = await readFile(new URL("../extensions/recipes/copilot-quota.html", import.meta.url), "utf8");

    expect(html).toContain("any existing apps.json file was unreadable or malformed");
    expect(html).toContain("follow the cached-stale-or-unavailable path instead of reporting sign-in required");
    expect(html).toContain("return an unavailable error (<code>Copilot quota unavailable</code>) with <code>sourceTried: [\"local-auth\"]</code>");
    expect(html).toContain("no existing apps.json file failed read or parse");
    expect(html).not.toContain("no file parses successfully, or no entry has a usable <code>oauth_token</code>, return <code>Copilot sign-in required</code>");
  });

  it("keeps Grok local auth parse failures out of sign-in-required handling", async () => {
    const html = await readFile(new URL("../extensions/recipes/grok-quota.html", import.meta.url), "utf8");

    expect(html).toContain("If the auth source is missing, unreadable, malformed, or local auth parsing fails before a credential candidate can be built");
    expect(html).toContain("return an unavailable error (<code>Grok quota unavailable</code>) with <code>sourceTried: [\"local-auth\"]</code>");
    expect(html).toContain("If an auth source is successfully read and parsed but no entry has a usable non-empty <code>key</code>");
    expect(html).not.toContain("missing file, empty object, or no candidate with a non-empty <code>key</code>");
  });

  it("keeps Cursor sqlite auth reads scoped to used keys", async () => {
    const html = await readFile(new URL("../extensions/recipes/cursor-quota.html", import.meta.url), "utf8");

    expect(html).toContain("WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/cachedEmail', 'cursorAuth/stripeMembershipType')");
    expect(html).toContain("do not retrieve <code>cursorAuth/refreshToken</code> or any other unused secret");
    expect(html).not.toContain("WHERE key LIKE 'cursorAuth/%'");
  });
});
