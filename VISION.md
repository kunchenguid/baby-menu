# Vision

`baby-menu` exists so that a person can grow their own menu bar by asking for it, instead of waiting for someone else to ship the widget they wanted.
It serves one person on their own machine, running an authenticated coding agent CLI, and it turns a plain-English request into a live widget in their own menu.
It owns exactly one thing: the tray popover surface and the safe loop that lets an embedded agent edit it while it is running.

## The extension workspace is the product

The agent edits extensions, never the host.
Widgets, root layouts, settings sections, server actions, and background tasks all live in the active extension workspace, and new capability arrives as a new extension.
The core stays immutable at runtime, because that immutability is what keeps baseline behavior stable and the security posture enforced.
`src/main`, `src/preload`, and the IPC wiring stay boring infrastructure, and growing them to serve one widget is the wrong shape.
Everything an extension can reach arrives through the stable `window.babyMenu` bridge and the generated `@babymenu/contracts` surface.
Per-widget IPC channels and per-capability preload methods are refused.
Widgets may reach past `react` and `@babymenu/ui`, but never by lengthening a hardcoded in-bundle allowlist, so that capability has to arrive as its own explicit mechanism.
Privileged work - filesystem, shell, network, credentials, tokens - lives in extension server actions in the main process, and only normalized non-secret data crosses into the renderer.

## The user can always undo

An agent that edits running software is only acceptable if the user can take it back.
Every accepted turn runs inside a change session, and the diff that session records is what the Keep/Undo bar reports.
Ultimate control sits with the user, so the guarantee is the ability to undo rather than a mandatory confirmation: a user may opt into keeping turns automatically, and may never be opted out of being able to undo them.
The tracked-source path refuses to start on a dirty tree and refuses to save or roll back once `HEAD` has moved, because rollback runs `git reset --hard` and `git clean -fd`.
A guard like that may be made more precise about which paths a turn can touch, and it is not removed for convenience.
Overlapping turns are rejected rather than queued or interleaved.
Managed defaults self-heal on every launch, and that repair never deletes an extension the user created.

## The interface tells the truth

What the menu says happened is derived from what actually happened on disk, never from what the agent said it did.
A turn that changed nothing says so, and a turn that failed says it failed instead of reporting a clean no-op.
Live-data widgets show real data or an explicit unavailable or sign-in-required state, and fabricated, mocked, or silently substituted data is refused.
A cached value is shown only when its provenance is trusted, and an untrusted cache is deleted rather than rendered.
Failure text is actionable and sanitized, and it never carries raw provider payloads or credentials.

## Guidance is code

The embedded agent's prompt and the bundled recipes are a shipped surface held to the same standard as the runtime.
When a generated widget lands wrong, the fix belongs in the guidance that misled the agent, in every place that wording appears, not in a special case for one provider.
Recipes are self-contained implementation specs, and a recipe that sends the agent to another repo, site, or CLI to learn its own contract is unfinished.
Recipes require inspecting the real source before writing a parser, and verifying the finished widget against that same source before reporting done.
Reasoning about a response shape on paper is not verification.
Recipes exist to close the agent's knowledge gaps, and they never shape what a fresh install shows.

## The default is empty

A new install ships the starter sample widget and nothing else.
Every other widget exists because a person asked for it, so no provider-specific widget joins the shipped default inventory.
Community-shared extensions are welcome as a baseline the user's own agent then customizes, while a fixed catalog the user cannot change is not.
Telemetry is anonymous, carries no user id, device id, prompt text, or file contents, fails silently, and can be turned off.
Anything richer than that is strictly opt-in and off by default, because users own their data.

## Only what was proven ships

The macOS release stays a draft until it is signed, notarized, verified on the mounted DMG, and launched as a packaged app.
Missing or malformed signing credentials fail the release closed rather than producing an unverified artifact.
Packaging defects are fixed at the cause: real Intel slices rather than a silenced universal merge error, build-only binaries excluded rather than shipped dead.
A bug fix starts by reproducing the real user-visible failure, and lands a regression test at the boundary that actually broke.
Human pull requests to `main` come through the `no-mistakes` gate, with no lower bar for an outside contributor than for the maintainer.

## Scope

It is not a general app platform, not an agent harness, not a chat client, and not a dashboard product.
It is not a provider quota suite, and no shipped default makes it one.
What it offers is not tied to one operating system, so more hosts are welcome for the reach they give it, and each one earns the same class of proof before it ships.
The expected way to use it is the popover, so a terminal or scripted entrypoint is not the product.
User extensions, agent sessions, caches, and preferences live under `~/.baby-menu`, never inside the app bundle.

A change aligns when it makes the ask-and-it-appears loop safer, more honest, or more reversible, when it lands in the extension workspace or in the guidance that shapes it, and when it is proven against the real surface it claims to fix.
A change should be resisted when it lets the agent edit the host, adds a bridge method a server action could have handled, puts a widget in front of a user who never asked for it, shows a value the system did not verify, or takes away the user's ability to undo.
