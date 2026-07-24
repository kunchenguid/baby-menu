# Signed release failure repair - focused validation

Validated on macOS against target commit `dc5a59cc83db0f47aebb87a1c3187676d85a3ac9`.

## Real Electron Framework output

The verifier was fed the output of the same `codesign` command used by the release workflow, run against the installed Electron 42.2.0 framework:

```text
$ codesign -d --arch arm64 --entitlements - --xml \
    "node_modules/.pnpm/electron@42.2.0/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Framework.framework" \
    > framework-arm64.plist
$ wc -c framework-arm64.plist
0
$ python3 scripts/verify-macos-entitlements.py framework-arm64.plist \
    "Electron Framework.framework" --architecture arm64
PASS real Electron Framework codesign output: arch=arm64 bytes=0 accepted as no entitlements
```

This directly reproduces and accepts the zero-byte output that broke the first signed release. The locally installed Electron binary contains only an arm64 slice, so x86_64 slice behavior is covered with exact parser fixtures in the focused automated test.

## Strict entitlement behavior

`pnpm vitest run tests/macos-entitlements-verifier.test.ts tests/release-config.test.ts --reporter=verbose` exercised these observable cases:

```text
PASS accepts the exact empty output emitted for Electron Framework
PASS accepts the exact XML output emitted for a JIT-only code object
PASS rejects malformed non-empty codesign output
PASS rejects unexpected effective entitlements
PASS rejects the allowed JIT entitlement unless its value is exactly true
PASS rejects a no-entitlement object when JIT is required
PASS rejects unreadable entitlement data
```

The release workflow contract test also proves that each universal process executable invokes entitlement verification separately for `arm64` and `x86_64` with JIT required.

## Draft-until-verified publication path

The focused release contract test verified this order in `.github/workflows/release-please.yml`:

```text
release-please creates draft release and tag
  -> refuse to proceed unless release is draft
  -> sign and notarize app
  -> create, notarize, and staple DMG
  -> mount final DMG and verify signatures, identity, runtime, architecture,
     entitlements, Gatekeeper, and staples
  -> run packaged app E2E from mounted DMG
  -> compute and validate SHA256
  -> upload DMG to draft release
  -> refuse to publish unless release is still draft
  -> publish stable release
  -> update Homebrew cask
```

The changed-file and workflow checks found no reference that edits or deletes `baby-menu-v0.1.22`, no tag deletion or force-update command, and no new cleanup automation. Release Please's supported `draft: true` and `force-tag-creation: true` settings are used so future draft releases receive their own tag immediately.

The read-only repository check `gh-axi release view baby-menu-v0.1.22` still returned the existing published release authored by `github-actions[bot]`, with its original `0.1.22` notes and `caa901a` release commit.

Production Developer ID signing and Apple notarization were not rerun locally because they require the protected release credentials and GitHub release mutation. The workflow itself retains those release-equivalent checks before publication.
