# AUDIT-desktop-web-terminal-001

| Field | Value |
|-------|-------|
| Title | Empty catch (error) {} swallowed kill/SSE cleanup failures |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | verified-fixed |
| Module | desktop-web-terminal |
| Evidence | desktop/packages/web/server/lib/terminal/runtime.js (7 sites) |
| Independent verifier | implementer dual-pass |
| Regression test | desktop/packages/web/server/lib/terminal/runtime.test.js |

## Proof
Replaced with console.warn/error; regression test asserts no empty catch and logging present

## Impact
Trust/stability defect on desktop/packages/web/server/lib/terminal surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Regression test: desktop/packages/web/server/lib/terminal/runtime.test.js
