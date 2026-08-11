# AUDIT-desktop-web-terminal-001

| Field | Value |
|-------|-------|
| Title | pty kill failures logged (not swallowed) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | verified-fixed |
| Module | desktop-web-terminal |
| Evidence | desktop/packages/web/server/lib/terminal/runtime.js:killTerminalProcess |
| Independent verifier | implementer dual-pass |
| Regression test | desktop/packages/web/server/lib/terminal/runtime.test.js |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
console.warn on kill failure; behavioral force-kill test

## Impact
Affects `desktop/packages/web/server/lib/terminal` (desktop, security).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- desktop/packages/web/server/lib/terminal/runtime.test.js
