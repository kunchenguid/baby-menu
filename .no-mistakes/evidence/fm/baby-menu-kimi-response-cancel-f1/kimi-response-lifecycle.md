# Kimi response lifecycle validation

Validated target `2aef344ada45583a293aa663deac6c167a1c838b` against base `9c0a970dca92b86e1275add9213aeb20eeda1780` using the broker's real fetch boundary and a controlled loopback HTTP server. No live Kimi credential or provider request was used.

## End-user boundary exercised

Every request presented to the broker remained the production fixed operation:

```text
GET https://api.kimi.com/coding/v1/usages
```

The injected transport routed that operation to a loopback server which deliberately kept response bodies open. At the exact moment `broker.acquire()` completed, the tests inspected both the server-side active response set and live TCP socket set.

## Target result

All tested terminal paths returned their normalized broker result with zero active responses and zero live sockets:

| Response path | Normalized result | Resource state at completion |
| --- | --- | --- |
| 301, 302, 307, 308 | `redirect_rejected` | 0 active responses, 0 live sockets |
| 401, 403 | `provider_auth_rejected` | 0 active responses, 0 live sockets |
| 408 | `provider_timeout` | 0 active responses, 0 live sockets |
| 429 | `provider_rate_limited` | 0 active responses, 0 live sockets |
| 418, 422 | `provider_request_rejected` | 0 active responses, 0 live sockets |
| 500, 503 | `provider_unavailable` | 0 active responses, 0 live sockets |
| Wrong content type | `unexpected_content_type` | 0 active responses, 0 live sockets |
| Declared or streamed oversized body | `response_too_large` | 0 active responses, 0 live sockets |
| Malformed bounded JSON | `malformed_json` | 0 active responses, 0 live sockets, deadline cleared |
| Valid bounded JSON | `fresh` API snapshot | 0 active responses, 0 live sockets, deadline cleared |
| Indefinitely streaming success body | `request_timeout` | 0 active responses, 0 live sockets, deadline cleared |

Command:

```sh
pnpm vitest run tests/kimi-quota-broker.test.ts --reporter=verbose
```

Relevant runner output:

```text
PASS closes an indefinitely streaming HTTP 301/302/307/308 response before acquire completes
PASS closes an indefinitely streaming HTTP 401/403/408/429 response before acquire completes
PASS closes an indefinitely streaming HTTP 418/422/500/503 response before acquire completes
PASS closes the socket for an unexpected content type before acquire completes
PASS closes the socket for declared and streamed oversized bodies before acquire completes
PASS finishes bounded malformed and valid JSON with no live body, socket, or deadline timer
PASS closes an indefinitely streaming success body and clears its timer when the deadline expires
```

## Base negative control

The target regression test file was run unchanged against the base broker implementation in an isolated, transient fixture. It failed 14 cleanup cases. The base returned the correct normalized result but still had one active response at the moment the broker completed:

```text
AssertionError: expected 1 to be +0

- Expected
+ Received

- 0
+ 1

tests/kimi-quota-broker.test.ts:371
expect(transport.activeResponsesAtCompletion).toBe(0)
```

Affected negative-control cases were all indefinitely streaming 301, 302, 307, 308, 401, 403, 408, 429, 418, 422, 500, and 503 responses, wrong content type, and deadline expiry.

## Compatibility checks

The fake-credential product path from the official CLI resolver through the host broker, extension capability, and widget still passes. Pi-first precedence, cancellation during Pi resolution, fallback rules, and secret confinement checks also pass. These checks use synthetic credentials only.

```sh
pnpm vitest run tests/e2e-kimi-cli-quota.test.ts tests/kimi-code-cli-credential-resolver.test.ts --reporter=verbose
```
