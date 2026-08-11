# AUDIT-desktop-web-security-empty-catch

| Field | Value |
|-------|-------|
| Title | 4 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-security |
| Evidence | desktop/packages/web/server/lib/security/legacy-tunnel.js:38; desktop/packages/web/server/lib/security/legacy-tunnel.js:49; desktop/packages/web/server/lib/security/request-security.js:52; desktop/packages/web/server/lib/security/request-security.js:56 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `desktop/packages/web/server/lib/security` (security, desktop).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
