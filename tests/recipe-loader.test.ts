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
});
