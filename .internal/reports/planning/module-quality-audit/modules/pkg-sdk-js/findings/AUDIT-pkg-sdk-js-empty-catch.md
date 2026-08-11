# AUDIT-pkg-sdk-js-empty-catch

| Field | Value |
|-------|-------|
| Title | 9 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | pkg-sdk-js |
| Evidence | packages/sdk/js/src/grpc.ts:2327; packages/sdk/js/src/headless/lifecycle.ts:450; packages/sdk/js/src/headless/lifecycle.ts:463; packages/sdk/js/src/headless/lifecycle.ts:469; packages/sdk/js/src/internal/server-shared.ts:92; packages/sdk/js/src/internal/server-shared.ts:149; packages/sdk/js/src/internal/server-shared.ts:256; packages/sdk/js/src/protocol.ts:29 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `packages/sdk/js` (api).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
