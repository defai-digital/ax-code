# AUDIT-provider-cli-001

| Field | Value |
|-------|-------|
| Title | CLI provider stdin EPIPE handled |
| Category | stability |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | provider-cli |
| Evidence | packages/ax-code/src/provider/cli/cli-language-model.ts |
| Independent verifier | ax-code-glm |
| Regression test | packages/ax-code/test/provider |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
stdin error/close listeners before write

## Impact
Affects `packages/ax-code/src/provider/cli` (stability, process).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test/provider
