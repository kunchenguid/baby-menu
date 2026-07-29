# Command helpers

Command helpers let an extension route one bare command name to a trusted executable selected in Baby Menu Settings.
They are useful when a credential manager, enterprise launcher, or signed helper must own the child-process identity instead of Baby Menu.

The command-helper setting stores only the command name and executable path, never a credential.
The GitHub Graph extension owns one fixed contribution-calendar operation, never requests a token, and receives only that operation's normal output.

## One-time GitHub Graph setup

Obtain the trusted GitHub helper from your credential provider or administrator and complete that provider's approval process.
Do not paste a token into Baby Menu.

1. Open Baby Menu and select **Settings**.
2. Find **command helpers** and select **add command helper**.
3. Enter `gh` as the command name.
4. Paste the absolute executable or wrapper path supplied by your helper provider.
5. Select **save helper**.

The selected path must exist, be a regular file, and be executable.
Baby Menu accepts a no-shell wrapper when that is the reviewed entry point to a signed helper application.
Baby Menu does not claim that an executable wrapper is itself code signed, so verify identity and authority using the helper provider's instructions before selecting it.

GitHub Graph extensions created before this capability may still call `node:child_process` directly.
After updating Baby Menu, paste this request into the composer once:

```text
Update my GitHub contributions widget to use the configured gh command helper.
Keep its existing fixed GraphQL request, timeout, output limit, account display, stale-data behavior, and error handling unchanged.
Do not accept a command, executable, argument, query, token, or URL from widget input.
```

Review the resulting change and select **Keep** only when the graph still shows the expected account.
New extensions receive this command-helper contract in their workspace instructions and generated types.

## Verify the setup

1. Quit Baby Menu completely.
2. Reopen Baby Menu and open the GitHub graph.
3. Confirm the expected account appears and the refresh time advances.
4. Confirm no credential approval window appears.
5. Confirm the helper is no longer present in Activity Monitor after the graph finishes loading.
6. Repeat the complete quit-and-reopen cycle four times.

A successful check produces four fresh snapshots for the expected account, no approval windows, and no helper process left running.
Never verify by displaying a token or other credential.

## Failure recovery

If Settings rejects the path, confirm that you pasted the complete absolute path and that the helper installation is still present and executable.
Do not replace the path with shell syntax, environment assignments, arguments, or a token.

If the widget reports that the helper is missing after setup, edit the `gh` helper in Settings and select the current provider-supplied path.
Baby Menu deliberately does not fall back to bare `gh` when a configured helper is malformed or has disappeared.

If an approval window still appears, the extension probably still invokes bare `gh` directly.
Run the migration request above, review the change, and reopen the app.

If the graph shows the wrong account, stop and verify the helper's selected GitHub account using the helper provider's non-secret account check.
Do not run or display `gh auth token` in Baby Menu.

## Roll back

Open Settings, select **remove** beside the `gh` helper, read the warning, and confirm **remove helper**.
The extension then returns to normal app command lookup, which may restore the original approval behavior.
Removing the Baby Menu setting does not revoke a helper approval or change a credential-manager policy.
Follow the helper provider's own rollback instructions if that policy must also be removed.

## Defaults, migration, and updates

An installation with no command-helper setting keeps normal host command resolution for compatibility with existing extensions.
A configured override always wins for extensions that use `context.commands.execFile`.
A malformed configured override fails closed and never falls back to the bare command.

Command-helper settings live in Baby Menu preferences under the mutable app-data directory.
Application upgrades preserve that directory, and extension seeding does not overwrite the setting.
Removing or reinstalling a user-created extension does not remove the command-helper setting.

## Extension contract

Server actions and background tasks receive `context.commands.execFile(command, args, options)`.
The host resolves only a syntactically safe bare command name, invokes the resolved executable directly with `execFile` semantics, and never starts a shell.
It rejects null bytes and oversized argument lists, applies a 15-second default timeout and 1 MiB default output bound, and caps explicit values at 30 seconds and 8 MiB.
Timeout and output-limit failures use deterministic error codes.
When Settings maps a command to a helper executable, the host requires a built-in operation policy matching the requesting extension id, action name, operation name, command, and exact argv.
The GitHub contribution-calendar policy authorizes only `github-graph.getGraph` with the fixed `github.contributionGraph` operation and the contribution GraphQL request below.

A GitHub Graph action should keep its GraphQL document and every argument in extension-owned constants:

```ts
const { stdout } = await context.commands.execFile(
  "gh",
  ["api", "graphql", "-f", `query=${QUERY}`],
  { operation: "github.contributionGraph", timeoutMs: 15_000, maxBufferBytes: 8 * 1024 * 1024 },
);
```

Never pass renderer input into the command name, executable path, arguments, query, URL, environment, timeout, or output limit.
Command helpers are scoped routing, not a sandbox for untrusted extensions.
Server extensions are already privileged and must be reviewed before they are kept.
