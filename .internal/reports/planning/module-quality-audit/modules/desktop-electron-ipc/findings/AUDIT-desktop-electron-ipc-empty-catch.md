# AUDIT-desktop-electron-ipc-empty-catch

| Field | Value |
|-------|-------|
| Title | 5 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | desktop-electron-ipc |
| Evidence | desktop/packages/electron/src/main.js:1646; desktop/packages/electron/src/main.js:1656; desktop/packages/electron/src/main.js:2168; desktop/packages/electron/src/server-process.js:51; desktop/packages/electron/src/startup-diagnostics.js:47 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `desktop/packages/electron/src (IPC policy/handlers)` (security, desktop).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
