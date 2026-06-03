# baby_menu - Marketing Video

## Style prompt

Monochrome Lab.
A calm command-line surface that happens to live in the macOS menu bar.
Near-black canvas, white type at varying alpha, JetBrains Mono everywhere, one mint signal color.
No gradients as decoration, no emoji, no second accent, no bounce during the product workflow.
Motion is snappy, short, ease-out - a terminal does not boing.
The only exception is the final logo, which does a short joyful baby-bounce before settling back to the identical loop frame.
The product builds menu-bar widgets by asking an agent, so the video practices the same restraint the product preaches.

## Colors

- **bg-void** `#060607` - the desktop behind the popover
- **bg-stage** `#0B0B0C` - popover canvas
- **bg-surface** `#101012` - module / card background
- **bg-elevated** `#16161A` - composer field, hover
- **bg-pressed** `#1C1C21` - mousedown
- **ink-100** `rgba(255,255,255,0.96)` - hero numbers, values
- **ink-200** `rgba(255,255,255,0.86)` - primary text
- **ink-300** `rgba(255,255,255,0.65)` - body
- **ink-400** `rgba(255,255,255,0.48)` - captions
- **ink-500** `rgba(255,255,255,0.34)` - tracked-caps labels
- **ink-600** `rgba(255,255,255,0.22)` - placeholders, hints
- **ink-700** `rgba(255,255,255,0.12)` - solid dividers
- **ink-800** `rgba(255,255,255,0.07)` - dashed dividers
- **signal-live (mint)** `#6AE3B6` - the only accent: dot, glow, single word, 1px progress fill. Never a button fill, never a background over 10% alpha.
- **signal-pending (amber)** `#FFD86B` - attention only
- **signal-error (coral)** `#FF6A7A` - destructive / quit-on-hover only

Mint glow: `0 0 6px rgba(106,227,182,0.65)`.

## Typography

- **Mono** - `JetBrains Mono`, weights 300 / 400 / 500 / 600. Used for EVERYTHING inside the popover surface - body, labels, values, buttons. Weight 300 for big numbers, 400 body, 500 buttons/titles.
- **Prose** - `Inter Tight`, 300 / 400 / 500. ONLY for marketing copy outside the popover surface (the outro tagline). Never inside the popover.
- Wordmark is `baby_menu` (lowercase, underscore) so it reads like an identifier - always in mono.

Video scale: the popover is rendered at 1.7x so 13px composer copy reads on a phone. Tracked-caps keys at `0.18em`. Tabular numerals on every number column.

## Motion

- `--motion-fast` 80ms (hover, dot pulse start), `--motion-base` 160ms (toggles, press), `--motion-slow` 280ms (popover entry, RunStrip appear).
- Easings: entry `cubic-bezier(0.22,0.61,0.36,1)`; morph-in-place `cubic-bezier(0.65,0,0.35,1)`. For video pacing extend reveals slightly to 0.4-0.7s.
- Caret blink, active-step pulse (mint dot opacity 1 <-> 0.4), 1px progress fill that grows with a 3x5 scanline head.
- No bounce, no spring, no overshoot during the product workflow. No `back.out`, no `elastic` before the outro. Use `power2.out`, `power3.out`, `expo.out`, `sine.inOut`.
- The outro logo may use `bounce.out` / `elastic.out` for the brief baby-bounce, but it must settle back to the exact frame-0 pose before the composition ends.

## What this video shows

A frame-0 outro poster (logo + `what would yours look like?` tagline + install command, used as the X thumbnail and seamless loop point), then the story of how it was built:
clean menu bar -> baby_menu tray icon appears -> click -> simplified hello-world popover -> ask for a cpu + memory widget -> agent works -> widget appears -> ask for a claude code usage widget -> agent works -> widget appears -> "drop the sonnet quota line" -> agent works -> line removed -> outro with the tagline and homebrew install command.

The agent's work is never a chat. It is one live RunStrip (pulsing mint dot + the user's prompt + a current step + an elapsed timer), replaced by a SessionBar (`Added 2 extensions`, Keep / Undo) when real file changes are done. The user never sees git, files, or commits.

## What NOT to do

- No emoji anywhere. Status is a mint dot + one tracked-caps word.
- No gradients as decoration. Solid near-black only (a single faint radial vignette on the desktop is allowed).
- No second accent color. Monochrome plus mint.
- No pure `#000` and no `#FFF` - ink is white at alpha.
- No bouncy easing, no springs, no 3D rotations during the product workflow.
- No transcript, no chat bubbles, no message history.
- Never expose git, file counts, paths, or SHAs. Buttons are Keep and Undo.
- No em dashes. Plain dashes only.
- Wordmark stays lowercase `baby_menu`. UI copy is terse, lowercase, second-person.

## Outro copy

Tagline: `what would yours look like?`

Install command:

```
brew install --cask kunchenguid/tap/baby-menu
```
