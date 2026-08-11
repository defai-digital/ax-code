# AUDIT-desktop-electron-ipc-001

| Field | Value |
|-------|-------|
| Title | IPC invoke allowlist is exact Set |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | desktop-electron-ipc |
| Evidence | desktop/packages/electron/src/preload-ipc-policy.js |
| Independent verifier | codex-sol |
| Regression test | desktop/packages/electron/src/preload-ipc-policy.test.mjs |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
DESKTOP_INVOKE_COMMANDS.has(command); tests reject unknown commands

## Impact
Affects `desktop/packages/electron/src (IPC policy/handlers)` (security, desktop).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- desktop/packages/electron/src/preload-ipc-policy.test.mjs
