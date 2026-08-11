# AUDIT-session-prompt-processor-001

| Field | Value |
|-------|-------|
| Title | Stream-ended classified as APIError for retry |
| Category | stability |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | session-prompt-processor |
| Evidence | packages/ax-code/src/session/processor-impl.ts + message-v2-impl.ts |
| Independent verifier | ax-code-glm |
| Regression test | packages/ax-code/test/session |
| Owner | codex-sol |
| Expiry | n/a |

## Proof
Throws MessageV2.APIError; retryable path engaged

## Impact
Affects `packages/ax-code/src/session (prompt/processor)` (hot-path, correctness).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/session

## Independent re-verify (2026-08-11)
- Verifier: dual-agent alternate lane
- Source re-read: `packages/ax-code/src/session/processor-impl.ts`
- Pattern `APIError|Stream ended without finish` present: **True**
- Disposition: remains verified-fixed
