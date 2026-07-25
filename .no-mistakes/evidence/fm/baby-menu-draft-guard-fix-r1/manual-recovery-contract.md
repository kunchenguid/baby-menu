# 0.1.23 manual recovery contract

> Historical evidence for the superseded tag-based recovery path. See
> [CONTRIBUTING.md](../../../../CONTRIBUTING.md#release-notes) for the current
> recovery contract.

The recovery path was inspected and exercised without dispatching the release, which would mutate the real GitHub release before this fix is merged.

## Existing target identity

```text
$ git ls-remote --tags origin refs/tags/baby-menu-v0.1.23 refs/tags/baby-menu-v0.1.23^{}
a8fd9cf3cda01277358a8b5e225e2ace7b0c0593	refs/tags/baby-menu-v0.1.23
```

This matches the workflow's pinned `EXPECTED_COMMIT`.

## Operator entry point and fail-closed restrictions

The `workflow_dispatch` entry point requires both:

```text
tag_name = baby-menu-v0.1.23
version  = 0.1.23
```

Any other pair exits before checkout with:

```text
Manual recovery is restricted to baby-menu-v0.1.23 at version 0.1.23.
```

Direct execution of the workflow condition produced:

```text
accepted: baby-menu-v0.1.23 0.1.23
Manual recovery is restricted to baby-menu-v0.1.23 at version 0.1.23.
```

After checkout, the workflow compares `git rev-parse HEAD` with the pinned commit above and exits before loading credentials if they differ.

## Recovery sequence retained

The focused workflow contract test verifies this order:

1. Check out `refs/tags/baby-menu-v0.1.23`.
2. Verify the pinned release commit.
3. Confirm the existing GitHub release is still a draft.
4. Restore signing and notarization credentials.
5. Build the universal app and DMG.
6. Submit for notarization and staple the DMG.
7. Verify codesign identity, hardened runtime, architectures, entitlements, Gatekeeper acceptance, app and DMG stapled tickets, and packaged-app launch.
8. Compute a non-empty artifact checksum.
9. Upload the DMG to the existing draft with `--clobber`.
10. Recheck draft state and publish that same release.

There is no release-creation step in manual recovery, so the path cannot create a new version or substitute a hand-upload flow.
