# Packaged default inventory

`pnpm package:mac` completed successfully for the universal `Baby Menu Dev.app`.

The built app's `Contents/Resources/extensions-template` contained:

```text
AGENTS.md
babymenu-env.d.ts
hello-world/components.tsx
hello-world/widget.tsx
recipes/claude-code-quota.html
recipes/codex-quota.html
recipes/copilot-quota.html
recipes/cursor-quota.html
recipes/grok-quota.html
```

Searching the built app's `Contents/Resources` for case-insensitive path names containing
`kimi` or `moonshot` returned no matches.

The packaged bundle was deleted after verification as required by the repository's
packaging hygiene rules.
