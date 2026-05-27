# Baby Menu Design System

A design system for **Baby Menu** — a macOS tray-bar Electron app that lives behind a system menu-bar icon. Click the tray icon and a small dark popover falls from the menu bar. Inside the popover, an embedded agent can edit the active extension workspace at runtime to add widgets, and the user can interact with those widgets without ever leaving the menu surface.

The visual direction is **Monochrome Lab** — terminal-elegant, near-black, mono type, one mint signal color. The popover should read as a calm command-line surface that happens to live in the macOS menu bar.

---

## What Baby Menu is

Baby Menu is a tray-popover OS-level utility built around a single moving surface: the user looks at and uses the widgets the agent has built, and the agent is always one slim prompt away at the bottom. There is no mode toggle, no separate "build" view, no chat panel. The composer is *the* affordance for talking to the agent, and it sits there permanently — a single line of mono type with a `›` prompt prefix.

When the user sends a request, the composer momentarily becomes a `RunStrip`: a single live affordance with a pulsing mint dot, the agent's current step, and an elapsed timer. **No log, no step history.** When the agent finishes, a `SessionBar` slides in with a plain-language summary of what was added (`Added a CPU temperature widget`) and two buttons: **Keep** and **Undo**. The user never sees commit SHAs, file counts, or the word "git" — those are infrastructure they shouldn't have to think about.

The popover surface is dynamic-height. The composer is always pinned to the bottom; everything above it stacks and grows.

---

## Source material

This system was built from the live codebase at:

- **GitHub:** https://github.com/kunchenguid/baby-menu (`main`)

Key files referenced (paths in that repo):

- `AGENTS.md` — architecture, three-process split, source-vs-packaged change-session invariants, recipe conventions.
- `src/renderer/styles.css` — the original warm-paper palette (now replaced by this system's monochrome direction).
- `src/renderer/App.tsx`, `src/renderer/agent/AgentChat.tsx`, `src/renderer/menu/MenuSurface.tsx`, `src/renderer/menu/WidgetHost.tsx` — the components being redesigned here.
- `src/shared/contracts.ts` — `BabyMenuWidget`, `RefreshableBabyMenuWidget`, `GitSessionSnapshot`, `AgentChatResult` — the data contracts our redesign remains compatible with.
- `extensions/hello-world/widget.tsx` — the first-run greeting widget and starter example of widget shape.
- `extensions/recipes/*.html` — daisyUI/Tailwind "wireframe" recipe docs. Note: recipes use a separate visual system and should not bleed into popover designs.

> Reader: if you have access to the repo above, browsing it directly will give you a much better grounding than this document can. Read `AGENTS.md` first.

---

## Index — what's in this folder

| Path | What |
| --- | --- |
| `README.md` | This document. Start here. |
| `colors_and_type.css` | The token source of truth — colors, type, spacing, radius, shadow, motion. Import this. |
| `SKILL.md` | Agent-skill manifest. Same folder can be dropped into a Claude Code Skills directory. |
| `preview/` | Small HTML cards that render in the Design System tab. Type specimens, color swatches, components. |
| `ui_kits/popup-menu/` | The redesigned tray popover. `index.html` is a clickable prototype; JSX files are the components. See [`ui_kits/popup-menu/README.md`](./ui_kits/popup-menu/README.md). |
| `fonts/` | (empty — see "Font substitutions" below.) |

### UI kits available

- **`popup-menu`** — the redesigned tray popover. Components: `MenuBar`, `Composer`, `RunStrip`, `SessionBar`, `WidgetHost` + three sample widgets (claude · weekly, battery, now playing).

---

## Content fundamentals

Baby Menu copy is **terse, lowercase, second-person, present-tense**. It sounds like log output a careful engineer would write — not marketing, not chat. The wordmark is `baby_menu` (lowercase, underscore separator) so it reads like an identifier.

### Voice rules

- **Lowercase by default.** UI strings stay lowercase unless they're a proper noun, an identifier, or a button label (which is sentence-case-with-no-period). The wordmark is `baby_menu`.
- **Tracked-caps for keys.** Anything that classifies — widget key (`CLAUDE · WEEKLY`), source (`OAUTH`, `CLI`, `WEB`, `MOCK`), occasional status word — is rendered uppercase with `0.18em` letter-spacing at 10–11px. This is the workhorse heading of the entire system.
- **Address the user as "you"; address the agent as "the agent"** (never "I", "we", or "Claude").
- **No emoji.** Status is a 5px glowing mint dot + one tracked-caps word. Never `🟢` or `✅`.
- **Use ASCII glyphs as iconography.** `›` for prompt, `⟳` for refresh, `+` for add, `·` for separator, `↵` `⌘` for shortcuts. Lucide (16px, stroke 1.5) is the fallback when an ASCII glyph won't read.
- **Plain dashes, not em dashes.** (From `AGENTS.md`. Honor it in copy.)
- **Numbers are confident, units are quiet.** `72%` is 32px / weight 300; `last sync 12:04` is 10px / 48% ink.

### Tone

The personality is "competent log". A calm CLI tool that happens to have a face. Not chirpy, not formal, never apologetic.

**Yes:**

- `Added a CPU temperature widget`
- `keep it, or undo`
- `Finish this change first`
- `ask the agent`
- `last sync 12:04`
- `claude · weekly`
- `designing the widget`
- `wiring it into your menu`

**No:**

- `🎉 Awesome — your widget is ready!`
- `Hi! I'm baby-menu.`
- `Pending session: 3 files in extensions/cpu-temp/`
- `git change session committed · b8d3a2c`
- `Oh no, something went wrong. Please try again.`
- `Click the button below to begin.`

### Capitalization & punctuation

- Wordmark: `baby_menu` (lowercase, underscore).
- Module / widget keys: ALL CAPS, tracked `0.18em`. `CLAUDE · WEEKLY`, `BATTERY`, `NOW PLAYING`.
- Button labels: Sentence case, no period. `Keep`, `Undo`, `Dismiss`. Special-case: tiny labels like `send` stay lowercase as a typographic detail (it reads as a command, not a button).
- Placeholders: lowercase imperative, no period, no `...` ellipsis. `ask the agent`.
- Error states: declarative, no exclamation. `Finish this change first.` `Refresh timed out.`
- The word "agent" stays lowercase except at the start of a sentence.

### Agent-facing copy

When the agent narrates its work, it speaks in plain language - never paths, never file counts, never SHAs, never the word "git".
The RunStrip title is the user's prompt, and its subtitle comes only from assistant response text.
Until assistant response text is available, the subtitle reads `Working...`.
Do not surface tool names, usage updates, command names, or synthetic progress labels in the RunStrip subtitle.
When assistant response text appears there, it should be plain user-facing copy:

- `Built the battery widget`
- `Added the calendar widget`

When the agent finishes, the SessionBar summarizes the result in one phrase, past-tense:

- `Added a CPU temperature widget`
- `Added a battery widget`
- `Updated the now-playing widget`

The user should be able to read this and immediately know whether to **Keep** it or **Undo** it without thinking about engineering at all.

---

## Visual foundations

Everything in the system aims for one feeling: **a calm command-line surface that happens to live in the macOS menu bar.** Not a web app, not a chat, not a dashboard.

### Color

The palette is **near-black + white-at-alpha + one mint signal**. Inspect `colors_and_type.css` for the source of truth.

- **Background** is layered near-black: `--bg-void` `#060607` (outside the popover), `--bg-stage` `#0B0B0C` (popover canvas), `--bg-surface` `#101012` (modules in preview cards), `--bg-elevated` `#16161A` (composer field, hover). **Never use `#000` directly** — pure black reads as missing pixels against the macOS desktop.
- **Ink** is white at progressively lower alpha — `0.96 / 0.86 / 0.65 / 0.48 / 0.34 / 0.22 / 0.12 / 0.07`. The alpha is part of the system; never write `color: #FFF` directly. Use `rgba(255,255,255,…)` or the `--ink-*` tokens.
- **Signal — mint** (`--signal-live` `#6AE3B6`) is the *only* accent. Used as a 5–8px dot with a soft glow, as a single tracked-caps word, or as a 1px progress fill. Never as a button fill, never as a background of more than 10% alpha. This restraint is the entire point.
- **Pending** is amber (`--signal-pending` `#FFD86B`) and **error** is coral (`--signal-error` `#FF6A7A`). Both follow the same rules as mint — dot + word, never a fill.
- **No blue, no purple, no orange.** A "second accent" would weaken the system. If a status needs more weight than mint, use a louder mint dot, not a different color.

### Typography

- **Mono** — `JetBrains Mono`, 300 / 400 / 500 / 600. Used for *everything* in the popover surface — body, labels, values, buttons, error messages. Weight 300 is reserved for big numbers; 400 for body; 500 for buttons and titles.
- **Prose** — `Inter Tight`, 300 / 400 / 500. Used ONLY in long-form explanatory copy (e.g. this README, preview-card notes). Never inside the popover surface itself. Opt in via `.prose`.

Scale stays small. Body **12–13px**, caption **11px**, tracked-caps key **10px**, hero value **28–36px**. Tabular numerals are on by default (`font-feature-settings: "tnum"`) so columns of values align.

### Spacing

A 2px base scale: `2 / 4 / 6 / 8 / 12 / 16 / 20 / 24 / 32`. The popover lives on a 12–14px outer padding. Widgets are separated by `1px dashed` dividers, not gutters, so the surface reads as a continuous log rather than separate cards.

### Background

The popover background is solid `--bg-stage` `#0B0B0C`. No gradients. No textures. No patterns. The macOS desktop behind it provides the only depth. The popover-positioner has no arrow / pointer — it just falls below the tray button.

There are no background images, no full-bleed photography, no illustrations. Imagery is reserved for widget data (e.g. an album-art square in `Now playing`). Chrome is *type and color only*.

### Borders, radius, dividers

- **Outer popover** radius: **10px** (`--radius-xl`). Sharper than most macOS native windows — this is intentional terminal posture.
- **Modules / cards** inside preview surfaces: **8px** (`--radius-lg`).
- **Inputs**: **4px** (`--radius-sm`).
- **Buttons**: full pill (`999px`). The only rounded affordance.
- **Borders** are 1px white at low alpha (`--line` `12%`, `--line-faint` `7%`). Inside the popover, the only borders are the outer 1px and the divider between head/body/composer.
- **Dividers** between widgets: `1px dashed --line-faint`. Between popover sections (head, body, composer): `1px solid --line`. The shift from solid to dashed signals "infrastructure" vs "content".

### Shadows

Exactly one shadow: `--shadow-pop` — `0 24px 80px rgba(0,0,0,0.65)` plus a 0.5px white inner edge. Cast by the popover onto the desktop. **No card shadows anywhere else.** Inside the popover, depth is implied by alpha and dividers, not by elevation.

### Transparency & blur

The macOS popover assumes the OS provides its own under-window blur. Inside the popover we use solid `--bg-stage` and rely on alpha on text for hierarchy — *no* `backdrop-filter` on inner elements. The menu bar above uses a 20px backdrop blur at 82% black, the standard macOS Sonoma vibrancy posture.

### Animation

Motion is **snappy, short, and ease-out.**

- `--motion-fast` **80ms** — hover, refresh-button color shift, dot pulse start.
- `--motion-base` **160ms** — segmented-control toggle, button press, focus ring fade.
- `--motion-slow` **280ms** — popover entry/exit (translate + scale), RunStrip appear, progress fill changes.
- **Caret blink**: 1100ms `steps(2, start)` — the composer caret blinks like a real terminal cursor.
- **Active-step pulse**: 1400ms `ease-in-out` infinite, opacity 1 ↔ 0.4 on the active step's mint dot.

Easings: `--ease` `cubic-bezier(0.22, 0.61, 0.36, 1)` for entry; `--ease-in-out` for things that morph in place.

**No bounces.** No springs. No skeuomorphic 3D rotations. A terminal does not boing.

### Interaction states

- **Hover** on text-button: background fades to `--bg-elevated`, border to `--ink-600`, text to `--ink-100` over 160ms.
- **Hover** on refresh glyph or text-link affordance: color shifts to `--signal-live`.
- **Press** (`:active`): background drops to `--bg-pressed`. No translate, no shrink — keep the surface still.
- **Focus** (keyboard): `--focus-ring` 1px solid mint + 4px mint glow. Same rule for everything.
- **Disabled**: `opacity: 0.32`. No filter, no grayscale.
- **Composer focus**: input border shifts to `rgba(106,227,182,0.45)`. The caret stays.
- **Cursors**: use the default arrow across the popover, text cursor only in editable fields, pointer on buttons and links, and `not-allowed` on disabled controls.

### Layout rules

- Width is fixed at **360px**, **400px max**. Never less than 320px.
- **Height is auto.** The popover grows to fit. Plan layouts for any height between 220px and 720px. When the widget host would exceed 360px, it scrolls internally; the composer and SessionBar stay sticky at the bottom.
- The **composer** is always pinned to the bottom.
- The **SessionBar** is pinned just above the composer **only when** the agent has just added or undone something and is waiting for the user to decide.
- The **RunStrip** is pinned just above the composer **only while** an agent run is in flight, and it replaces any SessionBar that might otherwise be shown.
- The popover never has horizontal scroll. Long file paths and names truncate with ellipsis.

### Card anatomy (widget)

A widget is a vertical stack inside the popover body, separated from its neighbors by a `1px dashed` divider — *not* a contained card. Top to bottom:

1. **Head row** — tracked-caps `key` (e.g. `CLAUDE · WEEKLY`) on the left, refresh glyph on the right.
2. **Value row** — the big number (weight 300, 28–36px, tabular numerals, tight tracking) with the unit at small. Optional status word on the right.
3. **Progress** — a 1px line at `--ink-800` with a `--signal-live` fill plus a 3×5px head at the tip, like a tiny scanline. Optional.
4. **Foot row** — 10px ink-faint meta on the left (timestamp), an uppercase source tag on the right (`OAUTH`, `CLI`, etc).

Widgets do **not** have backgrounds, borders, shadows, or padding-as-containers. They use the popover canvas directly and rely on dividers for separation.

---

## Iconography

Type is the iconography. The system leans on **ASCII glyphs** and **tracked-caps words** instead of a drawn icon set.

1. **ASCII first.** `›` is the prompt and the menu-affordance pointer. `⟳` is refresh. `+` is add. `·` is separator. `↵` and `⌘` appear in shortcut hints. `●` is a status dot. These read crisp at any size because they are real characters in the body font (JetBrains Mono).
2. **Lucide as fallback.** When an ASCII glyph won't carry a meaning, use [Lucide](https://lucide.dev) at **16×16**, stroke width **1.5**, color `currentColor`. Lucide is the closest visual match — slightly soft, geometric, monoline — and is CDN-loadable. *Flagged substitution*: Lucide is not currently bundled with the live codebase.
3. **No emoji as UI.** No `🟢 / ✅ / ⚠️ / 🚫`. Status is the mint dot + word.
4. **No custom hand-drawn SVG.** The tray glyph is the wordmark's `b` rendered as a template PNG by `src/main/tray.ts`.

---

## Font substitutions

> **Flagged for the brand owner:**
>
> - **JetBrains Mono** (Google Fonts) — primary font for the entire popover and all preview cards. JetBrains Mono is on Google Fonts so the substitution is benign for production use; you can also self-host the woff2 from `https://www.jetbrains.com/lp/mono/`.
> - **Inter Tight** (Google Fonts) — prose fallback for long copy (this README, card notes). Only used outside the popover surface.
>
> Both are loaded via `@import` from Google Fonts at the top of `colors_and_type.css`. **For production: replace the `@import` with `@font-face` declarations pointing at `fonts/*.woff2`.** If you'd prefer a different mono (Berkeley Mono, Commit Mono, Geist Mono), swap the value of `--font-mono` in one place and the whole system follows.

---

## Reading this system

A designer or agent picking this up:

1. Read this README top to bottom.
2. Open the Design System tab to flip through every token as a card.
3. Open `ui_kits/popup-menu/index.html` to see the popover live as a clickable prototype.
4. Cross-reference `colors_and_type.css` whenever picking a value — never invent a new color.
5. Cross-reference the [live repo](https://github.com/kunchenguid/baby-menu) for ground truth on data shapes (`src/shared/contracts.ts`) and on extension/widget conventions (`extensions/AGENTS.md`).
