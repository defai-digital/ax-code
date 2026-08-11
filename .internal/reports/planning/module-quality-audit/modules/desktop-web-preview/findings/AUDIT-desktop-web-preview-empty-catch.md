# AUDIT-desktop-web-preview-empty-catch

| Field | Value |
|-------|-------|
| Title | 9 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | desktop-web-preview |
| Evidence | desktop/packages/web/server/lib/preview/proxy-runtime.js:190; desktop/packages/web/server/lib/preview/proxy-runtime.js:230; desktop/packages/web/server/lib/preview/proxy-runtime.js:292; desktop/packages/web/server/lib/preview/proxy-runtime.js:408; desktop/packages/web/server/lib/preview/proxy-runtime.js:457; desktop/packages/web/server/lib/preview/proxy-runtime.js:491; desktop/packages/web/server/lib/preview/proxy-runtime.js:529; desktop/packages/web/server/lib/preview/proxy-runtime.js:545 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `desktop/packages/web/server/lib/preview` (desktop, security).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
