# AUDIT-tool-execution-001

| Field | Value |
|-------|-------|
| Title | Tilde expansion for bash path recording |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | tool-execution |
| Evidence | packages/ax-code/src/tool/bash-helpers.ts:expandLeadingTilde |
| Independent verifier | codex-sol |
| Regression test | packages/ax-code/test/tool |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
recordResolvedPath expands ~/ and treats dynamic expansion as dynamicPathAccess

## Impact
Affects `packages/ax-code/src/tool (bash/shell execution)` (security, hot-path).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/tool
