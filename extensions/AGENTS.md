# baby-menu extensions

This directory is for self-contained baby-menu extensions.
An embedded agent launched from baby-menu should prefer editing files here instead of changing Electron core infrastructure.
Do not modify files outside this directory unless the user explicitly asks.

## Extension Shape

Each extension should live in its own directory under `<extension-id>/` inside this extension workspace.
Use lowercase kebab-case ids such as `codex-quota`.

Common files are:

- `widget.tsx` for the renderer widget surface.
- `server.ts` for privileged server actions.
- Additional local helper files used only by this extension.
- Optional notes that make the extension understandable and shareable.

Packaged Baby Menu compiles extension modules before loading them.
Keep imports package-safe: widgets may import `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, and local helper files only.
Server actions may import Node built-ins such as `node:fs` plus local helper files only.
Do not add arbitrary npm package imports to extension code unless the host compiler is updated to support them.

## Recipes

Recipe-backed widget specs live in `recipes/*.html` inside this extension workspace.
Read the matching recipe before implementing a recipe-backed widget.
Recipes are self-contained specs for the embedded agent and should be treated as input, not generated extension output.

The `hello-world` extension is only the starter state for a fresh Baby Menu install.
The host hides `hello-world` automatically once real widgets are discovered.
Do not leave placeholder, demo, or mock widgets alongside the user's requested widget unless the user explicitly asks for examples.

## Widget Contract

Export a `RefreshableBabyMenuWidget` or `BabyMenuWidget` from `widget.tsx`.
Only `RefreshableBabyMenuWidget` may declare `refreshIntervalMs`, and it must also declare `refresh`.
Plain `BabyMenuWidget` exports must not declare a refresh interval.
Keep the widget renderer-only.
Do not read files, spawn commands, use credentials, or perform privileged network work from the renderer.
Do not store tokens or secrets in renderer or browser storage; Baby Menu disables Chromium keychain-backed storage on macOS.

## Widget Design System

Baby Menu uses the Monochrome Lab direction in runtime widgets.
Design for a 360px macOS tray popover, not a web page, dashboard, or chat transcript.
The host owns the outer widget wrapper, title row, refresh button, dashed dividers, scrolling, and popover chrome.
`widget.title` should be a terse tracked-caps key such as `BATTERY`, `CPU TEMP`, or `CLAUDE · WEEKLY`.
`render()` should return only the body content that belongs below the host title row.

Use the existing global design tokens and widget classes from the renderer CSS.
Prefer `value-row`, `value`, `progress`, `fill`, `foot`, `src`, `status`, and `label` before writing custom CSS.
Custom classes must be extension-prefixed and use `var(--...)` tokens rather than raw colors, font stacks, shadows, or spacing scales.

Public tokens available to widgets:

- Type: `--font-mono`, `--fs-xxs`, `--fs-xs`, `--fs-sm`, `--fs-base`, `--fs-lg`, `--fs-xl`, `--fs-2xl`, `--fs-3xl`, `--weight-light`, `--weight-reg`, `--weight-med`, `--tracking-caps`, `--tracking-value`, `--lh-tight`, `--lh-body`.
- Ink: `--ink-strong`, `--ink`, `--ink-muted`, `--ink-soft`, `--ink-label`, `--ink-faint`.
- Lines: `--line`, `--line-faint`.
- Signals: `--signal-live`, `--signal-warn`, `--signal-danger`, `--signal-live-glow`, `--signal-live-tint`, `--signal-pending-tint`, `--signal-error-tint`.
- Space: `--space-1` through `--space-9` for the 2px-based spacing scale.
- Radius: `--radius-xs`, `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`.
- Motion: `--motion-fast`, `--motion-base`, `--motion-slow`, `--ease`, `--ease-in-out`.

Public widget classes available to widgets:

- `value-row` lays out the primary value and optional right-side status.
- `value` styles the main numeric or short text value; put units in a nested `small` element.
- `progress` creates the 1px scanline track; `fill` is the mint progress segment inside it.
- `foot` lays out quiet metadata and source text only.
- `src` styles an uppercase source tag inside `foot` such as `CLI`, `OAUTH`, or `MOCK`.
- `status` renders a mint dot and tracked-caps status word.
- `status warn`, `status danger`, and `status muted` switch status tone.
- `label` renders a small tracked-caps label.
- `btn`, `btn-primary`, `btn-danger`, and `btn-ghost` are available for rare interactive widget controls.

Readable hierarchy rules:

- The host `widget.title`, `label`, `src`, and `foot` text may be tiny because they are metadata.
- Primary user-facing content should be at least `--fs-sm`; use `--fs-md`, `--fs-lg`, or a `value` class for the main thing the user should read first.
- Use `--fs-xs` only for optional hints and metadata.
- Do not use `foot` for primary instructions, onboarding copy, warnings, or calls to action.
- If every line is small, the design is wrong even if it uses the right tokens.
- One element should clearly win: a number, title, current state, or next action.

Onboarding widgets are not data widgets.
For greeting, setup, empty, or explanatory widgets, do not force `value`, `progress`, `foot`, or `src` into the layout just to match the data-widget anatomy.
Onboarding widget headlines should usually use `--fs-md` or `--fs-lg`.
Starter empty states may use `--fs-2xl` or `--fs-3xl` for a single display line because the menu is otherwise empty.
Use readable body copy at `--fs-base`, and keep examples or hints outside `foot`.
Example prompts should be complete pasteable user asks, not one-word labels.
Label them `examples` and phrase each one as something likely to produce a useful widget.

Canonical widget body pattern:

```tsx
<div className="value-row">
  <span className="value">
    72<small>%</small>
  </span>
  <span className="status">live</span>
</div>
<div className="progress">
  <div className="fill" style={{ width: "72%" }} />
</div>
<div className="foot">
  <span>last sync 12:04</span>
  <span className="src">mock</span>
</div>
```

Recommended widget body anatomy:

- A value row with one confident numeric or textual value.
- An optional `status` word for live, pending, error, or muted state.
- An optional 1px `progress` scanline with a `fill`.
- A `foot` row with quiet metadata on the left and an uppercase source tag with `src` on the right.

Visual rules:

- Use JetBrains Mono through `var(--font-mono)` and keep copy terse, lowercase, present tense unless text is a proper noun or tracked-caps label.
- Use mint only as a signal dot, glow, single word, or progress fill.
- Use amber and coral only for pending and error status.
- Do not add gradients, emoji, large icons, card shadows, full-card accent fills, custom palettes, or new typefaces.
- Do not wrap widget bodies in their own card background, border, or shadow.
- Keep layouts narrow and resilient; truncate long labels and avoid horizontal scrolling.

## Server Actions

Put privileged filesystem, shell, network, credential, and token work in `server.ts`.
Export an `actions` object from `server.ts`.
Renderer widgets call server actions through `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
Do not add preload methods or per-extension IPC channels.

## Tests

Use TDD for behavior changes.
Add tests under the repo-level `tests/` directory unless the project later adopts colocated extension tests.
Run the smallest relevant `pnpm vitest run tests/<name>.test.ts` command first, then broader checks before finishing.
