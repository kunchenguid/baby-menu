# Recipe Authoring

Conventions for the bundled HTML recipes under `extensions/recipes/`.
Recipes are HTML so the embedded agent can read them from its workspace and use embedded interactive demos; `src/main/recipe-loader.ts` discovers `*.html`, sorts them, and takes the title from `<title>` or the first `<h1>`.
Each recipe owns its provider-specific acquisition and refresh contract.

## Rules

- Recipes must be self-contained implementation specs.
- Do not tell the agent to inspect another repository, website, blog post, or external implementation guide before it can implement the recipe.
- It is fine to mention inspiration or provenance, but copy the actionable details into the recipe itself: commands, endpoints, local file paths, parser expectations, fallback order, security notes, IPC shape, files to edit, live verification steps, and acceptance criteria.
- A recipe should let an agent implement the feature from the recipe plus this repo alone.
- Each recipe should include a clear capability statement, expected user-facing behavior, recommended data-source order, implementation contract, error handling, security constraints, interactive demo, and acceptance criteria.
- For privileged work, explicitly say that filesystem, shell, network, credential, and token access belongs in extension-owned server actions behind `window.babyMenu.capabilities.invoke`.
- For durable local data, explicitly say whether the widget should read directly from `window.babyMenu.db`, whether a server action should use `context.db`, or whether a background task should persist data for later widget reads.
- For ongoing work, explicitly distinguish visible-widget refresh from background tasks and require the slowest acceptable interval.
- Renderer widgets and settings sections should receive normalized data over `window.babyMenu` and should not add new preload methods for each capability.
- If a real data source may be unavailable, require an explicit unavailable or sign-in-required result rather than a mock fallback; recipes should use real data only and must not fabricate or silently substitute mock data. Only specify labeled sample data when the user explicitly asks for examples.
- When a product-native client owns credential refresh or selection, a local expiry timestamp or raw API rejection is not proof of sign-out; require a bounded call through the authoritative client before showing sign-in guidance.
- Require generated live-data widgets to carry structured failures into accurate UI copy and keep last-good data visibly stale during refresh, launch, connectivity, rate-limit, service, and parser failures.
- Define normalized TypeScript shapes in the recipe so the agent knows what data extension server actions should return to widgets.
- Include parser guidance for command or API output, including timeout behavior, stale-data behavior, and user-visible errors.
- For recipes backed by live or system data, require the agent to inspect the real named source before writing parsing or rendering code, never guess field names or response shapes, and verify the finished server action or equivalent one-off check against the same live source before reporting done.
  Reasoning through return shapes on paper is not verification.
  If source inspection can expose secrets, require redacted output only.
- Never include or ask for committed secrets, tokens, cookie values, or local credential dumps.
- Standalone recipe HTML should use daisyUI from CDN and the `wireframe` theme.
- Include these tags in recipe HTML: `<link href="https://cdn.jsdelivr.net/npm/daisyui@5" rel="stylesheet" type="text/css" />`, `<link href="https://cdn.jsdelivr.net/npm/daisyui@5/themes.css" rel="stylesheet" type="text/css" />`, and `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>`.
- Set `<html data-theme="wireframe">` on recipe pages.
- Avoid custom `<style>` blocks in recipes unless there is a specific interaction that cannot be expressed with daisyUI and Tailwind utilities.
- Keep recipe typography readable: use a bounded content width such as `max-w-4xl`, body copy around `text-base`, comfortable `leading-7`, clear heading hierarchy, restored bullet and numbered list styles, and smaller text for code and tables.
- Prefer daisyUI components such as `card`, `table`, `btn`, `progress`, and `mockup-code` for recipe structure and demos instead of hand-written CSS.
- When changing recipe conventions, update `tests/recipe-loader.test.ts` so the convention is protected by regression tests.
