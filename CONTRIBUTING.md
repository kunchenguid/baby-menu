# Contributing

Thanks for wanting to contribute.
One rule up front:

**Human-authored pull requests targeting `main` must be raised through [`no-mistakes`](https://github.com/kunchenguid/no-mistakes).**
We require this to reduce the maintainer's burden of reviewing and merging contributions.

`no-mistakes` puts a local git proxy in front of your real remote.
Pushing through it runs an AI-driven review, test, lint, and CI pipeline in an isolated worktree, forwards the push upstream only after every check passes, and opens a clean PR automatically.

A GitHub Actions check named `Require no-mistakes` runs on PRs targeting `main` and fails if the body is missing the deterministic signature that no-mistakes writes.
Known automation accounts are exempt so dependency and release automation can keep working.
Regular contributor PRs without the signature will not be reviewed or merged.

## Workflow

Fork routing requires `no-mistakes` v1.30.1 or newer.

1. Fork the repo, then clone the parent repo or set your local `origin` back to the parent repo (`git@github.com:kunchenguid/baby-menu.git`).
2. Create a branch and make your changes.
3. Initialize or refresh the gate with your fork as the push target: `no-mistakes init --fork-url git@github.com:<you>/baby-menu.git`.
4. Commit your changes.
5. Push through the gate instead of pushing to `origin`: `git push no-mistakes`.
6. Run `no-mistakes` to attach to the pipeline, watch findings, and auto-fix or review as needed.
7. Once the pipeline passes, it pushes the branch to your fork and opens the PR against this repo for you.

See the [no-mistakes quick start](https://kunchenguid.github.io/no-mistakes/start-here/quick-start/) for the full first-run walkthrough.

## Repo Conventions

- Use `pnpm` with the pinned version from `packageManager`.
- Tests live in `tests/` at the repo root.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before pushing.
- Run `pnpm generate:contracts` and commit `extensions/babymenu-env.d.ts` after changing extension-facing types or `src/shared/extension-contract-names.ts`.
- Run `pnpm package:mac` when changing packaging, runtime paths, extension compilation, native dependencies, or release behavior.
- Local `pnpm package:mac` builds intentionally produce `Baby Menu Dev.app` with bundle id `com.kunchenguid.baby-menu.dev`; release automation uses `electron-builder.yml` directly for the production `Baby Menu.app` identity.
- Keep universal macOS packaging compatible with both Intel and Apple Silicon Macs; native prebuilt packages must be installed for `x64` and `arm64` and preserved in `electron-builder.yml` `x64ArchFiles` when electron-builder merges the app.
- Keep `electron-builder` at `26.8.2` or newer so pnpm-deduped dependencies are included correctly in packaged builds.
- Keep `pnpm-lock.yaml` changes with dependency changes.
- Do not commit generated build output, release artifacts, runtime caches, or dev extension workspaces.
- Do not hand-edit release-please metadata such as `CHANGELOG.md` or `.release-please-manifest.json`.
- See `AGENTS.md` for architecture notes, extension workspace rules, and agent-specific constraints.

## Release Notes

Baby Menu releases are proposed by release-please after conventional commits land on `main`.
Use prefixes such as `feat:` and `fix:` so release-please can choose the version bump and release notes.
Mark breaking changes with `!` in the commit type or a `BREAKING CHANGE:` footer.
Merging the release-please PR creates the version tag and a draft GitHub Release.
The release-please workflow builds the universal macOS app, signs every code object with `Developer ID Application: Kun Chen (9T2J7MNUP9)`, notarizes and staples the app and DMG, verifies the publication-ready DMG, computes its checksum, uploads it to the draft, and only then publishes the release before updating `kunchenguid/homebrew-tap`.
Any signing, notarization, verification, packaged runtime, checksum, or GitHub upload failure leaves the release as a draft and stops before stable publication and tap publication. A missing or invalid `HOMEBREW_TAP_TOKEN`, or another tap update failure, occurs after stable publication and fails the workflow without updating Homebrew.
The generated Homebrew Cask quits Baby Menu during upgrade and relaunches it after installation only when the app was already running before uninstall started.

Maintainers must keep these repository secrets provisioned from the canonical secure owners:

- `MAC_DEVELOPER_ID_CERT_P12` - base64 of the password-protected Developer ID Application certificate and private key for Team `9T2J7MNUP9`.
- `MAC_DEVELOPER_ID_CERT_PASSWORD` - the p12 export password.
- `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and `APP_STORE_CONNECT_API_KEY` - the App Store Connect API credentials used by `notarytool`; the API key is base64-encoded p8 content.
- `HOMEBREW_TAP_TOKEN` - write access to `kunchenguid/homebrew-tap` for the final cask update.

Never commit or print credential contents. Missing or malformed secrets fail the real release job; pull-request CI remains secret-free and validates the release config through `tests/release-config.test.ts`.
Maintainers must also keep the `BABY_MENU_UMAMI_WEBSITE_ID` GitHub Actions repository variable configured for packaged-release telemetry; it is intentionally a variable rather than a secret because the id is baked into the app and sent in Umami payloads.

To release, merge the release-please PR and require the `release-please` workflow's macOS job to pass. The release remains a draft until the signed artifact passes verification and runtime E2E, receives a valid checksum, and uploads successfully. Do not upload a replacement DMG or update the tap by hand unless repairing a failed release.
For a post-release check of exactly the downloaded artifact on macOS:

```sh
VERSION=x.y.z # Replace with the released version.
TAG="baby-menu-v${VERSION}"
mkdir -p verify-baby-menu/mount

gh release download "$TAG" --pattern "Baby-Menu-${VERSION}-universal.dmg" --dir verify-baby-menu
DMG="$PWD/verify-baby-menu/Baby-Menu-${VERSION}-universal.dmg"
hdiutil attach "$DMG" -readonly -nobrowse -mountpoint "$PWD/verify-baby-menu/mount"
trap 'hdiutil detach "$PWD/verify-baby-menu/mount" >/dev/null' EXIT
APP="$PWD/verify-baby-menu/mount/Baby Menu.app"

test "$(plutil -extract CFBundleIdentifier raw -o - "$APP/Contents/Info.plist")" = \
  "com.kunchenguid.baby-menu"
test "$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")" = \
  "$VERSION"
codesign --verify --deep --strict --verbose=4 "$APP"
SIGNATURE="$(codesign -d --verbose=4 "$APP" 2>&1)"
grep -Fq 'Identifier=com.kunchenguid.baby-menu' <<<"$SIGNATURE"
grep -Fq 'TeamIdentifier=9T2J7MNUP9' <<<"$SIGNATURE"
grep -Fq 'Authority=Developer ID Application: Kun Chen (9T2J7MNUP9)' <<<"$SIGNATURE"
grep -Eq '^CodeDirectory .*flags=.*runtime' <<<"$SIGNATURE"
grep -Eq '^Timestamp=.+$' <<<"$SIGNATURE"
spctl --assess --type execute --verbose=4 "$APP"
xcrun stapler validate "$APP"
xcrun stapler validate "$DMG"
lipo "$APP/Contents/MacOS/Baby Menu" -verify_arch arm64 x86_64

hdiutil detach "$PWD/verify-baby-menu/mount"
trap - EXIT
```

The expected Gatekeeper result is `accepted` with source `Notarized Developer ID`. The workflow runs these checks, plus per-bundle and per-Mach-O identity, hardened-runtime, and timestamp checks, against the mounted publication-ready DMG before upload.

## Questions

Open an issue if something is unclear.
