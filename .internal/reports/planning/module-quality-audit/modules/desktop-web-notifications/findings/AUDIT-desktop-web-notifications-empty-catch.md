# AUDIT-desktop-web-notifications-empty-catch

| Field | Value |
|-------|-------|
| Title | 2 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-notifications |
| Evidence | desktop/packages/web/server/lib/notifications/routes.js:54; desktop/packages/web/server/lib/notifications/template-runtime.js:311 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `desktop/packages/web/server/lib/notifications` (desktop).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
