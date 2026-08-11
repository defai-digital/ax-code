# AUDIT-desktop-electron-ipc-001

| Field | Value |
|-------|-------|
| Title | IPC allowlist was name regex |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | desktop-electron-ipc |
| Evidence | desktop/packages/electron/src/preload-ipc-policy.js |
| Independent verifier | codex-sol |
| Regression test | source re-verify / existing suite |

## Proof
DESKTOP_INVOKE_COMMANDS Set + isAllowedDesktopInvokeCommand exact match

## Impact
Trust/stability defect on desktop/packages/electron/src (IPC policy/handlers) surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Static control-flow proof of current defense
