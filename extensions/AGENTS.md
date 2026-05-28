# baby-menu extensions

This directory is for self-contained baby-menu extensions.
An embedded agent launched from baby-menu should prefer editing files here instead of changing Electron core infrastructure.
Do not modify files outside this directory unless the user explicitly asks.

## Extension Shape

Each extension should live in its own directory under `<extension-id>/` inside this extension workspace.
Use lowercase kebab-case ids such as `codex-quota`.

Common files are:

- `widget.tsx` for the renderer widget surface.
- `server.ts` for privileged server actions and background tasks.
- Additional local helper files used only by this extension.
- Optional notes that make the extension understandable and shareable.

Packaged Baby Menu compiles extension modules before loading them.
Keep imports package-safe: widgets may import `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, the design system `@babymenu/ui`, and local helper files only.
Server modules may import Node built-ins such as `node:fs` plus local helper files only.
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
Only `RefreshableBabyMenuWidget` may declare `viewRefreshIntervalMs`, and it must also declare `refreshView`.
Plain `BabyMenuWidget` exports must not declare a view refresh interval.
Keep the widget renderer-only.
Do not read files, spawn commands, use credentials, or perform privileged network work from the renderer.
Do not store tokens or secrets in renderer or browser storage; Baby Menu disables Chromium keychain-backed storage on macOS.

`refreshView` is for re-rendering a *visible* widget; the host pauses it while the popover is hidden and runs it once each time the popover opens.
It is not a way to keep data fresh in the background - if data must stay current while the popover is closed, use a background task (see "Background tasks").
A widget may also read data directly with `window.babyMenu.db` and subscribe to `window.babyMenu.background.onUpdate` to re-read when a background task finishes.

## Widget Design System

Baby Menu uses the Monochrome Lab direction in runtime widgets.
Design for a 360px macOS tray popover, not a web page, dashboard, or chat transcript.
The host owns the outer widget wrapper, title row, refresh button, dashed dividers, scrolling, and popover chrome.
`widget.title` should be a terse tracked-caps key such as `BATTERY`, `CPU TEMP`, or `CLAUDE · WEEKLY`.
`render()` should return only the body content that belongs below the host title row.

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

`@babymenu/ui` is the only extra import a widget may add beyond `react` and local files.
Overlays such as `Dialog`, `Select`, and `Tooltip` are already sized to fit the tray popover; do not reposition them.

Common API patterns:

- `DataTable` takes `columns`, `rows`, optional `getRowKey`, and optional `empty` content.
- `DataTable` columns use `{ key, header, align?, render? }`; omit `render` only when the row has a value at `row[column.key]`.
- `Badge` supports `tone="neutral" | "live" | "warn" | "danger"`.
- `StatusDot` supports `tone="live" | "warn" | "danger" | "muted"` and should sit next to a short status label.
- `Progress` takes `value={0..100}` and optional `tone="live" | "warn" | "danger"`.
- `Sparkline` takes `data={number[]}` and optional `width`, `height`, `tone="live" | "ink"`, and `area`.
- `Select` and `Dialog` follow Radix composition: root, trigger, content, then item/body/footer pieces.
- `Button` supports `variant="default" | "primary" | "ghost" | "danger"`, `size="sm" | "md"`, and defaults to `type="button"`.
- `Field` takes `label`, optional `hint`, and exactly one control child; it wires the label to the child `id` or generates one.
- `Input` and `Textarea` accept normal HTML control props and are already styled for the popover.
- `Switch` uses Radix switch props such as `checked`, `defaultChecked`, `onCheckedChange`, and `disabled`.
- `Tabs` follow Radix composition: `Tabs defaultValue`, `TabsList`, matching `TabsTrigger value`, and `TabsContent value`.
- `DropdownMenu` follows Radix composition: root, `DropdownMenuTrigger`, `DropdownMenuContent`, then `DropdownMenuItem` rows.
- `Tooltip` wraps one trigger child and takes `content`, optional `side`, and optional `className`; do not mount a separate provider.

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

export const serviceWidget = {
  id: "service-status",
  title: "SERVICES",
  render: () => (
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
          { key: "load", header: "load", align: "right", render: (row) => `${row.load}%` },
        ]}
      />
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><StatusDot tone="live" /> healthy</span>
        <Sparkline data={[12, 18, 14, 31, 29, 41]} area />
      </div>
      <Select defaultValue="hour">
        <SelectTrigger><SelectValue placeholder="window" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="hour">last hour</SelectItem>
          <SelectItem value="day">last day</SelectItem>
        </SelectContent>
      </Select>
      <Dialog>
        <DialogTrigger asChild><Button>details</Button></DialogTrigger>
        <DialogContent>
          <DialogTitle>service details</DialogTitle>
          <DialogBody>Keep dialog copy short enough for the tray window.</DialogBody>
          <DialogFooter><Button>close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  ),
};
```

### Style with Tailwind tokens

Widgets are styled with Tailwind utility classes, and the per-widget stylesheet is compiled for you - you never configure Tailwind.
Prefer Baby Menu token utilities for color, type, radius, and surfaces so widgets match the host app.
Default Tailwind palette colors such as `bg-red-500` and `text-blue-300` are unavailable, but arbitrary Tailwind values can still compile.
Use arbitrary color values only when a widget genuinely needs them, and keep them rare.
Keep class names statically visible in the widget source so the dev stylesheet and packaged per-widget compiler can discover them.
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

### Example data-widget body

```tsx
import { Progress, StatusDot } from "@babymenu/ui";

export const quotaWidget = {
  id: "quota",
  title: "QUOTA",
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-light tracking-value text-ink-strong">
          72<span className="ml-0.5 text-sm text-ink-soft">%</span>
        </span>
        <span className="flex items-center gap-1.5 text-xxs uppercase tracking-caps text-signal-live">
          <StatusDot /> live
        </span>
      </div>
      <Progress value={72} />
      <div className="flex justify-between text-xxs uppercase tracking-caps text-ink-label">
        <span>last sync 12:04</span>
        <span>cli</span>
      </div>
    </div>
  ),
};
```

### Onboarding widgets are not data widgets

For greeting, setup, empty, or explanatory widgets, do not force the data-widget anatomy.
Onboarding widget headlines should usually use `text-md` or `text-lg`.
Starter empty states may use `text-2xl` or `text-3xl` for a single display line because the menu is otherwise empty.
Use readable body copy at `text-base`, and keep examples or hints small but legible.
Example prompts should be complete pasteable user asks, not one-word labels.

## Server Actions

Put privileged filesystem, shell, network, credential, and token work in `server.ts`.
Export an `actions` object from `server.ts`.
Renderer widgets call server actions through `window.babyMenu.capabilities.invoke(extensionId, action, input)`.
Do not add preload methods or per-extension IPC channels.

Each action receives `(input, context)`.
The `context` is `{ rootDir, db, notify }`:

- `rootDir` is Baby Menu's app-data root, used for host-owned runtime state such as caches and local storage.
- `db` is the shared SQL store (see "Storage").
- `notify({ title, body })` shows a native system notification.

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
  runOnStart: true,    // run once immediately so data is warm (default true)
  run: async (context) => {
    const sample = await readSomething();
    context.db.exec("CREATE TABLE IF NOT EXISTS my_ext_samples (at INTEGER, value REAL)");
    context.db.run("INSERT INTO my_ext_samples (at, value) VALUES (?, ?)", [Date.now(), sample]);
    if (sample > THRESHOLD) context.notify({ title: "Heads up", body: `value is ${sample}` });
  },
};
```

The host runs `run` on its own timer in the main process whether or not the popover is open, with one timer per extension.
Newly added or edited background tasks are picked up automatically, without restarting the app.
The widget reads the persisted data with `window.babyMenu.db` on open and subscribes to `window.babyMenu.background.onUpdate` to re-read when a run finishes.

## Performance

Baby Menu lives in the tray and stays running for the whole session, and the popover is hidden (not unmounted) on blur.
Choosing the right mechanism is the main performance decision:

- Use `viewRefreshIntervalMs` / `refreshView` for keeping a *visible* widget current, including live real-time displays.
  It pauses while the popover is hidden, so a 1-2s loop costs nothing when nobody is looking.
  A live monitor that is only interesting while you are watching it - CPU, memory, a clock - belongs here, sampled on demand through a server action, not in a background task.
  Choose the slowest interval that still feels live, and omit it entirely for data that rarely changes (the host always offers a manual refresh button).
- Use a background task for anything that must keep running while the popover is closed.
  It runs in the main process on a single owned timer, clamped to a 60s floor; pick the slowest cadence that meets the need, since each run wakes the machine.
- Never start your own `setInterval`, `setTimeout` loops, or recursive polling inside a widget or server action - the host owns all timing.
- Keep both server actions and background `run` functions cheap and non-blocking.
  An action should read and return quickly; never `await` a fixed delay to build a measurement window.
  For rate-derived metrics such as CPU percent, store the previous reading (in a table or module scope) and diff against it on the next run, instead of opening a fresh sampling window each call.
- Guard long work with an in-flight flag and keep stored history bounded.

## Tests

Use TDD for behavior changes.
Add tests under the repo-level `tests/` directory unless the project later adopts colocated extension tests.
Run the smallest relevant `pnpm vitest run tests/<name>.test.ts` command first, then broader checks before finishing.
