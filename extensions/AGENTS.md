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
Keep imports package-safe: widgets may import `react`, `react/jsx-runtime`, `react/jsx-dev-runtime`, the design system `@babymenu/ui`, and local helper files only.
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

## Tests

Use TDD for behavior changes.
Add tests under the repo-level `tests/` directory unless the project later adopts colocated extension tests.
Run the smallest relevant `pnpm vitest run tests/<name>.test.ts` command first, then broader checks before finishing.
