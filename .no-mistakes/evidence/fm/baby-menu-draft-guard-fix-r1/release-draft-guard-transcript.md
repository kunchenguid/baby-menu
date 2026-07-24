# Release draft guard - operator-visible behavior

The exact `Verify release is still draft` script was extracted from `.github/workflows/release-please.yml` and executed with deterministic GitHub API responses for `baby-menu-v0.1.23`.

## Draft release

```text
exit: 0
Guard passed; signed build may proceed.
```

## Already published release

```text
exit: 1
Refusing to build artifacts for a release that is already public: baby-menu-v0.1.23
```

## No release for tag

```text
exit: 1
No GitHub release exists for tag baby-menu-v0.1.23; refusing to build artifacts.
```

## GitHub query unavailable

```text
exit: 1
Unable to verify draft status for baby-menu-v0.1.23; GitHub release query failed: gh: API unavailable (HTTP 503)
```

