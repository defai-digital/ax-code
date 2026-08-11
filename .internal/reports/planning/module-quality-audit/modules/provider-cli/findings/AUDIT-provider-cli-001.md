# AUDIT-provider-cli-001

| Field | Value |
|-------|-------|
| Title | EPIPE uncaught on CLI provider stdin |
| Category | stability |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | provider-cli |
| Evidence | packages/ax-code/src/provider/cli/cli-language-model.ts |
| Independent verifier | ax-code-glm |
| Regression test | source re-verify / existing suite |

## Proof
stdin error/close handlers installed before write; EPIPE logged

## Impact
Trust/stability defect on packages/ax-code/src/provider/cli surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Static control-flow proof of current defense
