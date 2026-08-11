# AUDIT-hooks-001

| Field | Value |
|-------|-------|
| Title | Project hooks gated by ProjectConfigTrust |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | hooks |
| Evidence | packages/ax-code/src/hooks/lifecycle.ts:loadProjectHooks |
| Independent verifier | ax-code-glm |
| Regression test | packages/ax-code/test (hooks/trust coverage via lifecycle callers) |
| Owner | ax-code-glm |
| Expiry | n/a |

## Proof
Returns [] unless ProjectConfigTrust.enabled() (AX_CODE_TRUST_PROJECT_CONFIG=1)

## Impact
Affects `packages/ax-code/src/hooks` (security, trust).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- packages/ax-code/test (hooks/trust coverage via lifecycle callers)
