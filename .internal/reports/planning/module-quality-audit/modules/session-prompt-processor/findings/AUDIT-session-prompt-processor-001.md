# AUDIT-session-prompt-processor-001

| Field | Value |
|-------|-------|
| Title | Stream ended without finish not retryable |
| Category | stability |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | session-prompt-processor |
| Evidence | packages/ax-code/src/session/processor-impl.ts + message-v2-impl.ts |
| Independent verifier | ax-code-glm |
| Regression test | source re-verify / existing suite |

## Proof
Throws MessageV2.APIError; fromError maps stream-ended message; retry path uses SessionRetry

## Impact
Trust/stability defect on packages/ax-code/src/session (prompt/processor) surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Static control-flow proof of current defense
