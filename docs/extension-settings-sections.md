# Per-extension settings sections

Status: implemented.
The open questions below were resolved along the recommended lines; see "Resolved decisions".

## Goal

Let an extension contribute its own section to the Settings page, so a user can configure the extension (API account, thresholds, units, which calendar, refresh cadence) without editing code.
`SettingsView` renders app-level settings first (launch at login, embedded agent selection, and custom ACP agent management), followed by any settings sections discovered from extensions.

## Why this shape

The app already has one proven pattern: an extension exports a React surface from its workspace, and the host discovers and mounts it (`widget.tsx` -> `WidgetHost`).
A settings section should reuse that pattern rather than invent a new one, so extension authors learn one model and the host stays generic.
The host owns the Settings page chrome (section title, dividers, spacing); the extension owns only the body of its section, exactly as it owns only the body of its widget.

## Contract

An extension may export a settings surface from `widget.tsx` alongside its widget.
The implemented shape mirrors `BabyMenuWidget`:

```ts
export type BabyMenuSettingsSection = {
  extensionId: string;   // matches the extension id, used as the section key
  title: string;         // terse section label, e.g. "CALENDAR"
  render: () => ReactNode; // body only; host draws the section frame
};
```

The section is renderer-only, like a widget.
It reads and writes its own configuration through the existing bridges - `window.babyMenu.db` for normal values and extension server actions for privileged credential work - so no new per-extension IPC or preload methods are added.
It may import `@babymenu/ui` and should build its form from `Field`, `Input`, `Switch`, `Select`, and `Button` so it matches the app shell for free.

## Discovery and rendering

The host discovers settings sections the same way it discovers widgets, via the widget module registry, by inspecting module exports for objects that match `BabyMenuSettingsSection`.
`SettingsView` renders the built-in app settings first, then one framed section per discovered extension section, sorted by extension id for stable order.
Sections are rediscovered when settings refresh or the popover reopens, and they load from compiled modules in packaged mode with the same stylesheet handling widgets use.
An extension with no settings section simply contributes nothing; the page degrades to just built-in app settings.

## Storage

Configuration values live in the shared SQLite store via `window.babyMenu.db`, using an extension-prefixed table (for example `calendar_settings`).
Secrets (API tokens) do not go in `db`; keep credential work in extension server actions, and use the settings section only as the user-facing collection surface.
There is no separate "settings store" primitive - settings are just rows the extension owns, which keeps the surface small.

## Resolved decisions

The three open questions were resolved along the recommended lines:

1. Declarative schema vs. custom component -> custom `render()`.
   A section is a renderer-only `BabyMenuSettingsSection` with `extensionId`, `title`, and `render()`, mirroring `BabyMenuWidget`.
   Authors build the form body from `@babymenu/ui`; the host draws the frame.
2. Where the section is exported -> reuse `widget.tsx`.
   Sections are discovered from the same extension module as widgets, so there is no new discovered-file convention.
   `loadExtensionModules` (`src/renderer/extension-modules.ts`) centralizes descriptor lookup, dynamic import, and packaged-mode stylesheet injection; `settingsSectionsFromModule` extracts the section exports.
3. Live application of changes -> re-read on next view refresh.
   No host-emitted "settings changed" event; the running widget reads its `db` rows on its next refresh.

## Implementation map

- `src/shared/contracts.ts` - `BabyMenuSettingsSection` type.
- `src/renderer/extension-modules.ts` - shared module loader (discovery, dynamic import, packaged-mode stylesheet injection) used by both the widget host and the settings view.
- `src/renderer/settings/settings-sections.ts` - `settingsSectionsFromModule` and `loadRuntimeSettingsSections` (sorted by extension id).
- `src/renderer/settings/SettingsView.tsx` - renders app settings first, including custom ACP agent management, then one framed section per discovered extension section.
- `extensions/AGENTS.md` - "Settings Sections" authoring contract for the embedded agent.
- Tests: `tests/settings-sections.test.tsx` and an added case in `tests/settings-view.test.tsx`.

## Out of scope

No validation framework, no migrations, no cross-extension settings sharing.
Start with: a discovered section, rendered into the page, reading and writing its own `db` rows.
