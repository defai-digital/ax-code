# AUDIT-desktop-web-terminal-empty-catch

| Field | Value |
|-------|-------|
| Title | 6 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | desktop-web-terminal |
| Evidence | desktop/packages/web/server/lib/terminal/runtime.js:29; desktop/packages/web/server/lib/terminal/runtime.js:32; desktop/packages/web/server/lib/terminal/runtime.js:213; desktop/packages/web/server/lib/terminal/runtime.js:308; desktop/packages/web/server/lib/terminal/runtime.js:352; desktop/packages/web/server/lib/terminal/runtime.js:996 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `desktop/packages/web/server/lib/terminal` (desktop, security).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
