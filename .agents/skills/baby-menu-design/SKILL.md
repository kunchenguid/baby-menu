---
name: baby-menu-design
description: Use this skill to generate well-branded interfaces and assets for Baby Menu, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## What's here

- `README.md` — full brand brief: product context, content fundamentals, visual foundations, iconography.
- `colors_and_type.css` — prototype and app-shell token reference. For production widgets, use `@babymenu/ui` and the live Tailwind tokens in `src/ui/theme.css`; never invent new tokens without updating the relevant source first.
- `preview/` — small HTML cards that document each token / component visually.
- `ui_kits/popup-menu/` — the canonical UI kit: a clickable recreation of the redesigned tray popover with `MenuBar`, `Composer`, `RunStrip`, `SessionBar`, `WidgetHost` and three sample widgets.

## The direction in one paragraph

**Monochrome Lab.** Near-black canvas (`#0B0B0C`), white type at varying alpha, JetBrains Mono everywhere, one mint signal color (`#6AE3B6`). The popover reads as a calm command-line surface. No gradients, no emoji, no second accent. Status is a small glowing dot plus one tracked-caps word, 6px in shared components and 8px in RunStrip/SessionBar controls.

## Hard rules

1. Baby Menu is a **macOS tray popover**, 504px wide, dynamic-height. Never design for a full browser window.
2. **The agent's work is not a chat.** No transcript, no bubbles, no history. Use the `RunStrip` pattern: one live affordance (pulsing mint dot + current step + timer), replaced by a `SessionBar` when done.
3. **No build-mode toggle.** On the main idle surface, the composer is one slim row pinned to the bottom of the popover. It auto-grows to a second line when the user types more. During an active agent run, `RunStrip` replaces the composer; the settings view also replaces it while open.
4. **Never expose git, files, or commits to the user.** The SessionBar reads "Added a CPU temperature widget", not "3 files committed · b8d3a2c". Buttons are **Keep** and **Undo**, not Save and Rollback.
5. **No emoji as UI.** No gradients. Status is color + word (rarely needed — usually only on the SessionBar's leading dot).
6. **Type and ASCII glyphs are the iconography.** `›` `+` `·` `↵` `⌘` `●`. Lucide is used when ASCII won't carry the meaning, including `CircleArrowUp` for update availability, `Settings` for settings, and `Power` for quitting the app; use 14px in compact controls and 16px in roomier controls.
7. **JetBrains Mono everywhere** inside the popover surface. Inter Tight only for long prose outside the surface.
8. **Mint is the only signal color** and is used ONLY as a dot, glow, single word, or 1px progress fill — never as a button fill, never as a background of more than 10% alpha.
9. Production `@babymenu/ui` buttons use compact `rounded-sm` corners. Primary is **inverse white** (`--ink-100` on near-black). Default is transparent with a 1px hairline border. Destructive is coral outline. Reserve pill buttons for prototype/app-shell affordances where the design brief calls for them.

## Reference repo

The live product code lives at https://github.com/kunchenguid/baby-menu. Read `AGENTS.md` and `src/shared/contracts.ts` there for the architectural ground truth (three-process Electron split, source-vs-packaged change-session invariants, widget contracts).
