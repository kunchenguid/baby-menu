# baby-menu extensions

This directory is for self-contained baby-menu extensions.
An embedded agent launched from baby-menu should prefer editing files here instead of changing Electron core infrastructure.
Do not modify files outside this directory unless the user explicitly asks.

## Stay inside this workspace

This extension workspace is your working directory, and you should keep every read, search, and edit inside it.
Do not `cd` above this workspace, and do not run recursive `find`, `grep -r`, `rg`, or `ls -R` against your home directory, `/Users/<you>`, or any parent path.
On macOS those parent paths include the protected `Documents`, `Downloads`, `Desktop`, `Music`, `Movies`, and `Pictures` folders, and traversing them makes the operating system pop a permission prompt for each one - a slow, alarming experience for the user that a widget task never needs.
If a search returns nothing inside this workspace, stop and rely on the contracts documented below rather than widening the search outward.
The live-source verification rule near the end of this file is the only narrow exception to the read boundary.
For that check, an extension-owned server action, or an equivalent one-off verification command for that server action, may perform targeted, read-only access to a specific known source the recipe or server code already names: read a named credential file, run a named command such as the macOS Keychain `security` lookup, or call a named endpoint.
This does not permit broad or recursive discovery outside the workspace; do not run `find`, `grep -r`, `rg`, `ls -R`, or similar scans against your home directory, `/Users/<you>`, or any parent path while verifying live data.

The Baby Menu host source is not present in this workspace.
Files such as `src/shared/contracts` and the `@babymenu/ui` source live inside the installed app bundle, not on disk next to your extensions, so there is nothing to find by searching for them.
Do not go hunting for them, and never import host-only paths like `../../src/shared/contracts` - that path does not exist in a packaged install and is exactly what sends a search outward.

Instead, import the contract types from the stable `@babymenu/contracts` specifier:

```tsx
import type { RefreshableBabyMenuWidget, BabyMenuServerContext } from "@babymenu/contracts";
```

The full set of available types is declared in `babymenu-env.d.ts` at the root of this workspace - read that file when you need the exact shape of a widget descriptor, settings section, server `context`, `db`, background task, or the `window.babyMenu` bridge (`BabyMenuExtensionApi`).
These are type-only imports, so the host erases them at compile time; they are always allowed and add no runtime dependency.
Do not import a *value* from `@babymenu/contracts` - it carries types only.

## Extension Shape

Each extension should live in its own directory under `<extension-id>/` inside this extension workspace.
Use lowercase kebab-case ids such as `codex-quota`.

Common files are:

- `layout.tsx` - optional root workspace layout component that arranges active widgets and controls the popover canvas size.
- `widget.tsx` - the entry module that exports the `BabyMenuWidget` descriptor (and any settings section).
- `components.tsx` - the widget's React components, exporting components only so edits hot reload in place.
- `server.ts` for privileged server actions and background tasks.
- Additional local helper / data files (for example `store.ts`) used only by this extension.
- Optional notes that make the extension understandable and shareable.

Packaged Baby Menu compiles extension modules before loading them.
Keep imports package-safe: widget and layout modules may import `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, the design system `@babymenu/ui`, and local helper files only.
Server modules may import Node built-ins such as `node:fs` plus local helper files only.
Both may additionally use type-only imports from `@babymenu/contracts` (see "Stay inside this workspace"); type-only imports are erased at compile time and do not count as runtime dependencies.
Do not add arbitrary npm package imports to extension code unless the host compiler is updated to support them.

When you need current details about a dependency, CLI, local credential layout, or an external API a widget talks to - package versions, command flags, endpoints, request headers, or response shapes - use web search to confirm the latest information before relying on it. APIs and tools change; do not guess field names, versions, or endpoints from memory when a quick search can verify them.

## Recipes

Common recipes live in `recipes/*.html` inside this extension workspace.
Read the matching recipe before implementing a widget that's relevant.
Recipes are self-contained specs for the embedded agent and should be treated as technical reference.

The `hello-world` extension is only the starter state for a fresh Baby Menu install.
The host hides `hello-world` automatically once real widgets are discovered.
Do not leave placeholder, demo, or mock widgets alongside the user's requested widget unless the user explicitly asks for examples.

## Widget Contract

Export a `RefreshableBabyMenuWidget` or `BabyMenuWidget` from `widget.tsx`.
Only `RefreshableBabyMenuWidget` may declare `viewRefreshIntervalMs`, and it must also declare `refreshView`.
Plain `BabyMenuWidget` exports must not declare a view refresh interval.
Keep the widget renderer-only.

Split each widget so editing the UI preserves React state across hot reloads:

- `components.tsx` exports **only React components** (the views and their sub-components). This is the file you edit while iterating on the UI; Vite Fast Refresh hot-swaps it in place and keeps component state (input text, toggles, the current tab).
- `store.ts` (or any `.ts` helper) holds everything that is **not** a component: data fetching, the shared store, hooks like `useSomething`, and pure helpers such as tone/format functions.
- `widget.tsx` imports the view from `components.tsx` plus any helpers (for example `refreshView: () => fetchSample()`) and exports the `BabyMenuWidget` descriptor object.

Why: Fast Refresh only hot-swaps a module whose exports are all React components. A module that also exports a non-component (the widget descriptor object, a helper function, a hook) cannot Fast Refresh and forces a full popover reload, dropping state. So never export a non-component from `components.tsx`, and keep the descriptor object in `widget.tsx`. The packaged widget compiler follows these local imports and compiles the whole module graph, so the split works in both dev and packaged builds.
Do not read files, spawn commands, use credentials, or perform privileged network work from the renderer.
Do not store tokens or secrets in renderer or browser storage; Baby Menu disables Chromium keychain-backed storage on macOS.

`refreshView` is for re-rendering a _visible_ widget; the host pauses it while the popover is hidden and runs it once each time the popover opens.
It is not a way to keep data fresh in the background - if data must stay current while the popover is closed, use a background task (see "Background tasks").
A widget may also read data directly with `window.babyMenu.db` and subscribe to `window.babyMenu.background.onUpdate` to re-read when a background task finishes.

## Popover Layout

By default the popover stacks every widget in a single column and sizes itself to that content.
To take full control of the arrangement and the overall popover size, author one optional file at the **root** of this workspace: `layout.tsx`.
It default-exports a `BabyMenuLayout` component that receives the active widgets and decides how they fit on the canvas.

This is purely additive and backwards compatible.
When there is no `layout.tsx`, the host renders the built-in column, so doing nothing keeps the current behavior.
Older app versions that predate this feature simply ignore the file and render the column, so shipping a layout never breaks them.

The host passes the layout two props (`BabyMenuLayoutProps`):

- `widgets`: a `BabyMenuLayoutWidget[]` of `{ id, title }` for every active extension, so you can iterate or look up what is available.
- `renderWidget(id)`: returns the fully wired render of one widget by id (or `null` for an unknown id). Always render a widget through this, never by importing another extension's files.

Rules:

- The layout owns its own content width: set an explicit width on its root element (for example `className="w-[840px]"` or a fixed grid), and the popover window resizes to fit that width plus the host chrome and the rendered height. Use a normal, content-driven height; do not hard-code the popover height.
- The layout is renderer-only and may import only `react`, `@babymenu/ui`, and type-only `@babymenu/contracts` - the same import rules as `widget.tsx`. It must not read files, run commands, or do privileged work.
- The host no longer draws a title above each widget; the widget owns its entire area. If you want a heading, render it inside the widget or the layout.
- Place every widget you want visible. Any widget you do not render simply will not appear.
- If the layout fails to compile in packaged mode or throws while rendering, the host falls back to the built-in column so the popover never blanks. Packaged compile failures are logged by the host.

Editing `layout.tsx` hot-reloads like a widget.
The app header also has a reload-layout control that remounts the menu surface, re-runs widget and layout discovery, and resets widget React state without restarting Baby Menu or clearing the agent conversation.

Start from this boilerplate, which reproduces the default column, then rearrange it:

```tsx
import type { BabyMenuLayoutProps } from "@babymenu/contracts";

export default function Layout({ widgets, renderWidget }: BabyMenuLayoutProps) {
  return (
    <div className="flex w-[504px] flex-col gap-3 p-3">
      {widgets.map((widget) => (
        <div key={widget.id}>{renderWidget(widget.id)}</div>
      ))}
    </div>
  );
}
```

A two-column canvas, for comparison, is just a wider root with a grid:

```tsx
import type { BabyMenuLayoutProps } from "@babymenu/contracts";

export default function Layout({ widgets, renderWidget }: BabyMenuLayoutProps) {
  return (
    <div className="grid w-[840px] grid-cols-2 gap-3 p-3">
      {widgets.map((widget) => (
        <div key={widget.id}>{renderWidget(widget.id)}</div>
      ))}
    </div>
  );
}
```

## Widget Design System

Baby Menu uses the Monochrome Lab direction in runtime widgets.
Design for a macOS tray popover (504px wide by default; a custom `layout.tsx` can widen it - see "Popover Layout"), not a web page, dashboard, or chat transcript.
The host owns the outer wrapper, dashed dividers, scrolling, and popover chrome, but it no longer draws a title above your widget - the widget owns its entire area.
So `render()` must include its own affordance to say what it is showing whenever that is not obvious from the content: a terse tracked-caps key such as `BATTERY`, `CPU TEMP`, or `CLAUDE · WEEKLY`, a labeled value, or an icon.
This is not a mandate to draw a title bar - a self-evident widget (a single big labeled number, a clearly captioned chart) needs no separate heading; just make sure the user can tell what they are looking at.
`widget.title` is still required, but it is now metadata (the id-stable label the host uses for ordering and accessibility and that a `layout.tsx` reads to place widgets), not something the host renders - keep it terse and tracked-caps, and render your own heading from it if you want one visible.

### Build with @babymenu/ui first

Import ready-made, on-brand components from `@babymenu/ui` instead of hand-rolling tables, inputs, charts, or status chips.
These are the same components the Baby Menu app uses, so widgets stay visually consistent for free.

```tsx
import { DataTable, StatusDot, Progress, Badge, Sparkline } from "@babymenu/ui";
```

Available components:

- Data display: `DataTable`, `Sparkline`, `Progress`, `Badge`, `StatusDot`, `Skeleton`.
- Layout: `Card`, `CardHeader`, `CardBody`.
- Input: `Button`, `Field`, `Input`, `Textarea`, `Switch`, and `Select` with `SelectTrigger`, `SelectContent`, `SelectItem`, `SelectValue`.
- Disclosure: `Tabs` with `TabsList`, `TabsTrigger`, `TabsContent`; `Dialog` with `DialogTrigger`, `DialogContent`, `DialogTitle`, `DialogDescription`, `DialogBody`, `DialogFooter`; `DropdownMenu` with `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`; and `Tooltip`.
- `cn(...)` merges Tailwind class strings safely.

`@babymenu/ui` is the only extra import a widget module may add beyond `react` and local files.
Overlays such as `Dialog` and `Select` are already sized to fit the tray popover; do not reposition them.
`Tooltip` is a small positioned hint rather than a full popover overlay.

Common API patterns:

- `DataTable` takes `columns`, `rows`, optional `getRowKey`, and optional `empty` content.
- `DataTable` columns use `{ key, header, align?, render? }`; omit `render` only when the row has a value at `row[column.key]`.
- `Badge` supports `tone="neutral" | "live" | "warn" | "danger"`.
- `StatusDot` supports `tone="live" | "warn" | "danger" | "muted"` and optional `pulse`; it should sit next to a short status label.
- `Progress` takes `value={0..100}` and optional `tone="live" | "warn" | "danger"`.
- `Sparkline` takes `data={number[]}` and optional `width`, `height`, `tone="live" | "ink"`, and `area`.
- `Select` and `Dialog` follow Radix composition: root, trigger, content, then item/body/footer pieces.
- `Button` supports `variant="default" | "primary" | "ghost" | "danger"`, `size="sm" | "md"`, and defaults to `type="button"`.
- `Field` takes `label`, optional `hint`, and exactly one control child; it wires the label to the child `id` or generates one.
- `Input` and `Textarea` accept normal HTML control props and are already styled for the popover.
- `Switch` uses Radix switch props such as `checked`, `defaultChecked`, `onCheckedChange`, and `disabled`.
- `Tabs` follow Radix composition: `Tabs defaultValue`, `TabsList`, matching `TabsTrigger value`, and `TabsContent value`.
- `DropdownMenu` follows Radix composition: root, `DropdownMenuTrigger`, `DropdownMenuContent`, then `DropdownMenuItem` rows.
- `Tooltip` wraps one trigger child and takes `content`, optional `side`, optional `className`, and optional `defaultOpen`; do not mount a separate provider.

```tsx
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sparkline,
  StatusDot,
} from "@babymenu/ui";

type Row = { name: string; status: "live" | "warn"; load: number };

const rows: Row[] = [
  { name: "api", status: "live", load: 41 },
  { name: "queue", status: "warn", load: 88 },
];

export function ServiceStatusView() {
  return (
    <div className="flex flex-col gap-3">
      <DataTable
        rows={rows}
        getRowKey={(row) => row.name}
        columns={[
          { key: "name", header: "service" },
          {
            key: "status",
            header: "state",
            render: (row) => <Badge tone={row.status}>{row.status}</Badge>,
          },
          {
            key: "load",
            header: "load",
            align: "right",
            render: (row) => `${row.load}%`,
          },
        ]}
      />
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="flex items-center gap-1.5">
          <StatusDot tone="live" /> healthy
        </span>
        <Sparkline data={[12, 18, 14, 31, 29, 41]} area />
      </div>
      <Select defaultValue="hour">
        <SelectTrigger>
          <SelectValue placeholder="window" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hour">last hour</SelectItem>
          <SelectItem value="day">last day</SelectItem>
        </SelectContent>
      </Select>
      <Dialog>
        <DialogTrigger asChild>
          <Button>details</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>service details</DialogTitle>
          <DialogBody>
            Keep dialog copy short enough for the tray window.
          </DialogBody>
          <DialogFooter>
            <Button>close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### Style with Tailwind tokens

Widgets and `layout.tsx` are styled with Tailwind utility classes, and the per-module stylesheet is compiled for you - you never configure Tailwind.
In packaged installs, CSS compilation follows a symlinked `~/.baby-menu/extensions` workspace to its real target before scanning source classes.
Prefer Baby Menu token utilities for color, type, radius, and surfaces so widgets match the host app.
Default Tailwind palette colors such as `bg-red-500` and `text-blue-300` are unavailable, but arbitrary Tailwind values can still compile.
Use arbitrary color values only when a widget genuinely needs them, and keep them rare.
Keep class names statically visible in the widget or layout source so the dev stylesheet and packaged compiler can discover them.
Avoid constructing Tailwind class fragments dynamically; choose complete class strings from a small map instead.

Use these token utilities:

- Surfaces: `bg-stage`, `bg-surface`, `bg-elevated`, `bg-pressed`.
- Ink (text): `text-ink-strong`, `text-ink`, `text-ink-muted`, `text-ink-soft`, `text-ink-label`.
- Lines: `border-line`, `border-line-faint`.
- Signals: `text-signal-live` and `bg-signal-live` for mint, `text-signal-warn` for amber, `text-signal-danger` for coral.
- Type: `font-mono`, the `text-xxs` through `text-3xl` scale, `tracking-caps`, and `tracking-value`.
- Radius: `rounded-xs` through `rounded-xl`, and `rounded-pill`.

Spacing, flex, and grid utilities are standard Tailwind.

### Readable hierarchy

- Primary user-facing content should be at least `text-sm`; use `text-md`, `text-lg`, or larger for the main thing the user should read first.
- Use `text-xs` and `text-xxs` only for optional hints, metadata, and tracked-caps labels.
- One element should clearly win: a number, title, current state, or next action.
- If every line is small, the design is wrong even if it uses the right tokens.

### Visual rules

- Use JetBrains Mono via `font-mono` and keep copy terse, lowercase, present tense unless text is a proper noun or tracked-caps label.
- Use mint only as a signal: a `StatusDot`, a glow, a single word, or a `Progress` fill.
- Use amber and coral only for pending and error status.
- Do not add gradients, emoji, large icons, card shadows, full-card accent fills, custom palettes, or new typefaces.
- Do not wrap widget bodies in their own card background, border, or shadow.
- Keep layouts narrow and resilient; truncate long labels and avoid horizontal scrolling.
- Keep a value, its label, and any meter on the same axis. If a metric has two complementary readings (used vs remaining, full vs free, on vs off), pick one for a given element and make the label text, the displayed number, and any `Progress`/meter all describe it. A meter or number labeled "left"/"remaining" must show the remaining amount, not the used amount. This is about labeling correctness, not layout - it does not dictate whether you show a meter, a number, or a label.

### Example data-widget body

The host draws no title, so this body labels itself with a terse tracked-caps key (here matching `widget.title`) so the user can tell what the `72%` is. Drop the key only when the content is already self-evident.

```tsx
import { Progress, StatusDot } from "@babymenu/ui";

export function QuotaView() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xxs uppercase tracking-caps text-ink-label">
        <span>quota</span>
        <span className="flex items-center gap-1.5 text-signal-live">
          <StatusDot /> live
        </span>
      </div>
      <span className="text-2xl font-light tracking-value text-ink-strong">
        72<span className="ml-0.5 text-sm text-ink-soft">%</span>
      </span>
      <Progress value={72} />
      <div className="flex justify-between text-xxs uppercase tracking-caps text-ink-label">
        <span>last sync 12:04</span>
        <span>cli</span>
      </div>
    </div>
  );
}
```

### Onboarding widgets are not data widgets

For greeting, setup, empty, or explanatory widgets, do not force the data-widget anatomy.
Onboarding widget headlines should usually use `text-md` or `text-lg`.
Starter empty states may use `text-2xl` or `text-3xl` for a single display line because the menu is otherwise empty.
Use readable body copy at `text-base`, and keep examples or hints small but legible.
Example prompts should be complete pasteable user asks, not one-word labels.

## Settings Sections

An extension may contribute its own section to the Baby Menu settings page so the user can configure it (account, thresholds, units, which calendar, refresh cadence) without editing code.
Export a `BabyMenuSettingsSection` from `widget.tsx` alongside the widget - it is discovered from the same module, so no new file convention and no preload changes are needed.

```tsx
import { Button, Field, Input, Switch } from "@babymenu/ui";

function CalendarSettingsView() {
  return (
    <div className="flex flex-col gap-3">
      <Field label="account">
        <Input placeholder="you@example.com" />
      </Field>
      <Switch aria-label="show all-day events" />
    </div>
  );
}

export const calendarSettings = {
  extensionId: "calendar", // must match the extension directory id; used as the section key and sort order
  title: "CALENDAR", // terse tracked-caps label, like a widget title
  render: () => <CalendarSettingsView />,
};
```

The section is renderer-only, exactly like a widget: the host draws the section frame (title, dividers, spacing) and you own only the body.
Build the form from `@babymenu/ui` (`Field`, `Input`, `Switch`, `Select`, `Button`) so it matches the app shell for free.
Read and write configuration through the existing bridges - `window.babyMenu.db` for normal values - using an extension-prefixed table (for example `calendar_settings`); there is no separate settings store.
Do not put tokens or secrets in `db`; keep credential work in `server.ts`.
The running widget picks up changed settings by re-reading on its next view refresh, so persist settings to `db` and read them in the widget rather than wiring a custom change event.

## Server Actions

Put privileged filesystem, shell, network, credential, and token work in `server.ts`.
Export an `actions` object from `server.ts`.
Renderer widgets call server actions through `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
Do not add preload methods or per-extension IPC channels.

Prefer real local data. When a real source is unavailable, return a clear unavailable or sign-in-required result so the widget can show that state - do not fabricate or silently fall back to mock data. Only return labeled sample data when the user explicitly asks for it.

Each action receives `(input, context)`.
The `context` is `{ rootDir, db, notify }`:

- `rootDir` is Baby Menu's app-data root, used for host-owned runtime state such as caches and local storage.
- `db` is the shared SQL store (see "Storage").
- `notify({ title, body })` shows a native system notification.

### Module-scope state in server.ts is not durable

The host keeps one `server.ts` module instance alive across calls, so a module-scope variable does carry its value between `invoke`s and between background ticks - a `let previous = ...` at the top of `server.ts` will hold the last run's value while `server.ts` and its local helper imports are unchanged.
But that instance is replaced with fresh, reset state whenever you edit the extension's code, including local helper files, and whenever the app restarts.
So module scope is fine for a cheap in-memory cache that is safe to lose, but anything that must survive a reload or restart - settings, accumulated history, a baseline you cannot recompute - has to live in `db` (see "Storage").
When in doubt, persist to `db`: it is the only place state is guaranteed to outlive a code edit or restart.

## Storage

Extensions share one local SQLite database, exposed as a small SQL interface.
It is available as `context.db` in server actions and background tasks, and as `window.babyMenu.db` in widgets.

```ts
db.query<T>(sql, params?): T[]            // SELECT -> rows
db.get<T>(sql, params?): T | undefined    // SELECT -> one row
db.run(sql, params?): { changes, lastInsertRowid }  // INSERT / UPDATE / DELETE
db.exec(sql): void                        // multi-statement DDL / migrations
db.transaction(fn): T                     // BEGIN / COMMIT / ROLLBACK (server side only)
```

`params` is either a positional array (`[a, b]` for `?` placeholders) or a named object (`{ name }` for `:name`).
Create your own tables with `CREATE TABLE IF NOT EXISTS`, and prefix table names with your extension id (for example `system_usage_samples`) so extensions do not collide.
The renderer `window.babyMenu.db` methods return promises; the `context.db` methods are synchronous.

Two constraints:

- Queries run synchronously in the main process, so keep them small and indexed.
  Do not run heavy or analytical queries from a widget; do that work in a background task and write the result to a table the widget reads.
- This store is plaintext on disk and is not for secrets.
  Keep tokens, credentials, and cookies in dedicated credential handling, not in `db`.

## Background tasks

A view refresh only runs while the popover is open.
When data must stay fresh even while the popover is closed - polling an API, accumulating history, watching a threshold to alert on - declare a background task.

Export `background` from `server.ts` alongside `actions`:

```ts
export const background = {
  intervalMs: 300_000, // 5 minutes; the host enforces a 60s minimum
  runOnStart: true, // run once immediately so data is warm (default true)
  run: async (context) => {
    const sample = await readSomething();
    context.db.exec(
      "CREATE TABLE IF NOT EXISTS my_ext_samples (at INTEGER, value REAL)",
    );
    context.db.run("INSERT INTO my_ext_samples (at, value) VALUES (?, ?)", [
      Date.now(),
      sample,
    ]);
    if (sample > THRESHOLD)
      context.notify({ title: "Heads up", body: `value is ${sample}` });
  },
};
```

The host runs `run` on its own timer in the main process whether or not the popover is open, with one timer per extension.
Newly added or edited background tasks are picked up automatically, without restarting the app.
The widget reads the persisted data with `window.babyMenu.db` on open and subscribes to `window.babyMenu.background.onUpdate` to re-read when a run finishes.

## Performance

Baby Menu lives in the tray and stays running for the whole session, and the popover is hidden (not unmounted) on blur.
Choosing the right mechanism is the main performance decision:

- Use `viewRefreshIntervalMs` / `refreshView` for keeping a _visible_ widget current, including live real-time displays.
  It pauses while the popover is hidden, so a 1-2s loop costs nothing when nobody is looking.
  A live monitor that is only interesting while you are watching it - CPU, memory, a clock - belongs here, sampled on demand through a server action, not in a background task.
  Choose the slowest interval that still feels live, and omit it entirely for data that rarely changes - the host re-runs `refreshView` each time the popover opens, so the widget is already current whenever the user looks at it.
- Use a background task for anything that must keep running while the popover is closed.
  It runs in the main process on a single owned timer, clamped to a 60s floor; pick the slowest cadence that meets the need, since each run wakes the machine.
- Never start your own `setInterval`, `setTimeout` loops, or recursive polling inside a widget or server action - the host owns all timing.
- Keep both server actions and background `run` functions cheap and non-blocking.
  An action should read and return quickly; do not `await` a fixed delay inside an action to build a measurement window.
- For rate-derived metrics such as CPU percent, persist the previous cumulative reading in `db` and diff the new reading against it on the next view refresh or background run; the gap between refreshes is your sampling window.
  Prefer `db` over a module-scope variable here: module state is dropped on every code edit and restart (see "Module-scope state in server.ts is not durable"), and a baseline lost mid-session makes the next reading collapse to a meaningless 0 or 100 until it warms back up.
  Whenever there is no stored baseline yet - the first call, or just after a reset - write the baseline and report a warming-up state rather than a misleading 0 or 100.
- Guard long work with an in-flight flag and keep stored history bounded.

## Do not write tests or documentation

Extensions are verified live through the Baby Menu UI, not by an automated suite.
Do not write test files, and do not write README or other documentation files for an extension.
In this workflow they slow implementation down far more than they help: the user sees the widget render in the tray popover immediately and gives feedback there, so a passing unit test adds little, and docs go stale as the user iterates on the widget by conversation.
Spend the effort on making the widget correct and good-looking on the first render instead.

Concretely:

- Do not create `*.test.ts` / `*.test.tsx` files for extensions, and do not run a test runner as part of finishing.
- Do not create `README.md` or other docs inside an extension directory.
- Keep code self-explanatory with clear names and short, purposeful comments only where intent is non-obvious - not prose documentation.
- "No test files" does not mean "no verification." When a widget or server action surfaces live or system data - local files, command/CLI output, credentials, an API response - inspect that actual source directly (read the real file, run the real command, call the real endpoint) to confirm its true current shape before writing parsing or rendering code.
  If inspecting a source that can contain secrets, print only non-secret metadata or explicitly redacted placeholders; never echo raw tokens, credential blobs, cookies, auth headers, or secret-bearing payloads to stdout, the agent transcript, logs, or the widget UI.
  Never guess or pattern-complete a field name, path, or response shape from memory, docs, or a similar existing field.
- Before reporting the work done, verify the finished result against that same live data yourself: run the server action (or an equivalent one-off shell/node check) against the real source and confirm the exact value you expect is what actually renders. Reasoning about the return shape on paper is not verification, and it is not the user's job to discover a widget doesn't render - do that check yourself first.
