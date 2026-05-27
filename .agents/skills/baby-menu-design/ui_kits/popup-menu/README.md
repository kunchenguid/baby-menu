# Popup menu — UI kit

A clickable recreation of the redesigned Baby Menu tray popover in the Monochrome Lab direction.

## Files

| File | What |
| --- | --- |
| `index.html` | Loads React + Babel and mounts the prototype. |
| `popup.css` | All layout + component CSS for the kit. Imports tokens from `../../colors_and_type.css`. |
| `MenuBar.jsx` | Fake macOS menu bar with the tray button. |
| `App.jsx` | Top-level shell. Owns popover open state, widgets, the active Run, and the session. |
| `Composer.jsx` | Slim 1-line prompt with `›` prefix, blinking caret, auto-grow on multi-line typing. Always pinned to bottom. |
| `RunStrip.jsx` | Single live affordance — pulsing mint dot, agent's task + current step, elapsed timer. No log history. |
| `SessionBar.jsx` | Human-language summary from the agent (`Added a CPU temperature widget`) with **Keep** / **Undo** actions. |
| `WidgetHost.jsx` | Widget shell + three sample widgets (claude · weekly, battery, now playing). |

## Interactions to try

1. **Click the `b` tray icon** in the menu bar (top right). The popover toggles.
2. **Type a request** in the composer and press Enter (or click `send`). The composer flips into a `RunStrip` with a pulsing mint dot, a current-step subtitle that fades up each time the agent advances, and a live timer. No checklist, no log.
3. **When the agent finishes**, a `SessionBar` slides in with a plain-language summary (e.g. `Added a CPU temperature widget`) and two buttons: **Keep** and **Undo**. Click **Keep** to add the new widget to the surface; click **Undo** to discard. Either way, the bar auto-dismisses after a moment.
4. **Send a second request while a session is still pending** — the SessionBar flips to an amber-dot `Finish this change first` state. Click **Dismiss** and try again.

## What this kit *does not* try to do

- It does not call the real agent. Steps and summaries are mocked.
- It does not execute git commands. **Keep** / **Undo** flip UI state only and never expose commits or file paths.

## Compatibility with the live codebase

| Live file | Kit equivalent | Notes |
| --- | --- | --- |
| `App.tsx` | `App.jsx` | The mode toggle is gone; the live app has a settings view, and the composer is hidden while settings are open. |
| `agent/AgentChat.tsx` | `Composer.jsx` + `RunStrip.jsx` + `SessionBar.jsx` | Three components from one chat surface. There is no message history. |
| `menu/MenuSurface.tsx` + `menu/WidgetHost.tsx` | `WidgetHost.jsx` | Recipes pill row removed — recipes are an agent-side concept, not user UI. |
| `styles.css` | `popup.css` + `colors_and_type.css` | |

`AgentChatMessage[]` from `src/shared/contracts.ts` is not used in this design — there is no transcript. `GitSessionSnapshot` still maps to the SessionBar's internal `session.kind` field, but its `head`, `commit`, and similar git-shaped fields are never rendered. The agent should pass a plain-language `summary` string (e.g. `"Added a CPU temperature widget"`) alongside the snapshot for the UI to display.
