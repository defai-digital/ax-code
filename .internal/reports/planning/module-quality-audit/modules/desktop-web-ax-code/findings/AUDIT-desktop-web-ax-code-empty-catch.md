# AUDIT-desktop-web-ax-code-empty-catch

| Field | Value |
|-------|-------|
| Title | 37 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | desktop-web-ax-code |
| Evidence | desktop/packages/web/server/lib/ax-code/core-routes.js:73; desktop/packages/web/server/lib/ax-code/core-routes.js:174; desktop/packages/web/server/lib/ax-code/core-routes.js:181; desktop/packages/web/server/lib/ax-code/core-routes.js:268; desktop/packages/web/server/lib/ax-code/core-routes.js:275; desktop/packages/web/server/lib/ax-code/core-routes.js:283; desktop/packages/web/server/lib/ax-code/core-routes.js:290; desktop/packages/web/server/lib/ax-code/env-runtime.js:153 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `desktop/packages/web/server/lib/ax-code` (desktop).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
