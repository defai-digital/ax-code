# AUDIT-permission-001

| Field | Value |
|-------|-------|
| Title | Untrusted policy.json strips allow grants |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | permission |
| Evidence | packages/ax-code/src/permission/index.ts:loadPolicy |
| Independent verifier | codex-sol |
| Regression test | packages/ax-code/test/permission |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
Only deny rules applied when untrusted; allow grants logged and ignored

## Impact
Affects `packages/ax-code/src/permission` (security, trust).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/permission
