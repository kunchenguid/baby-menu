# PR body compliance event replay

Target: `40c8967cdb780d2e766690b4c65bd27794f10133`  
Base: `77be90c0a0daa7387371e6c314df48cde0352e3c`

## End-user event replay

The shell script below was extracted directly from the workflow's
`Verify no-mistakes signature in PR body` step and executed for three body
events on the same simulated PR head.

```text
Same-head PR #42 body-event replay using the workflow real shell step
event=701 run=91001 action=opened group=no-mistakes-required-42-91001 terminal=SUCCESS
  Found no-mistakes signature in PR #42 body.
event=702 run=91002 action=edited group=no-mistakes-required-42-91002 terminal=FAILURE
  ::error::This PR was not raised through no-mistakes.
event=703 run=91003 action=edited group=no-mistakes-required-42-91003 terminal=SUCCESS
  Found no-mistakes signature in PR #42 body.
Replay result: PASS - all three independently grouped events reached expected terminal outcomes (success/failure/success).
```

This demonstrates the intended user-visible sequence: a signed opened event
passes, an unsigned edited event fails, and a later signed edited event passes.
Each event has its own immutable run-ID concurrency group, so none can replace
or cancel another pending body event.

## Preservation matrix

| Invariant | Observed workflow behavior |
| --- | --- |
| Opened event isolation | `no-mistakes-required-42-91001` |
| First edited event isolation | `no-mistakes-required-42-91002` |
| Second edited event isolation | `no-mistakes-required-42-91003` |
| Synchronize coalescing | `no-mistakes-required-42-head-change` |
| Reopened coalescing | `no-mistakes-required-42-head-change` |
| Fork security boundary | `pull_request` with `contents: read` |
| Cancellation policy | `cancel-in-progress: true` |
| Stable check name | `PR must be raised via no-mistakes` |
| Signature policy | Canonical `Updates from [git push no-mistakes]...` marker unchanged |
| Bot exemptions | GitHub Actions, Dependabot, and release-please exemptions unchanged |
| Run identity | PR number, action, monotonic run number, and immutable run ID in `run-name` |

An exact base-to-target comparison also passed after removing the canonical
`run-name` addition and the documented concurrency-group replacement. This
confirms the workflow job, trigger set, permissions, signature step, bot
exemptions, and repository-specific behavior were otherwise unchanged.

## Why there is no screenshot

This change controls GitHub Actions scheduling and terminal check outcomes. It
does not alter a rendered application surface. The transcript above is the
product-level artifact for the behavior reviewers need to verify.
