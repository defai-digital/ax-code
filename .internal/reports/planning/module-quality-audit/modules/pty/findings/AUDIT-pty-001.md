# AUDIT-pty-001

| Field | Value |
|-------|-------|
| Title | PTY teardown dispose/kill/close failures logged |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | verified-fixed |
| Module | pty |
| Evidence | packages/ax-code/src/pty/index.ts:teardown |
| Independent verifier | codex-sol |
| Regression test | packages/ax-code/test/pty (if present) / static proof |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
log.warn on dispose/kill/ws.close failures during teardown

## Impact
Affects `packages/ax-code/src/pty` (security, resource).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/pty (if present) / static proof
