# AUDIT-permission-001

| Field | Value |
|-------|-------|
| Title | Project policy.json silently grants tool permissions |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | permission |
| Evidence | packages/ax-code/src/permission/index.ts:loadPolicy |
| Independent verifier | ax-code-glm (independent re-read 2026-08-11) |
| Regression test | source re-verify / existing suite |

## Proof
Untrusted projects only keep deny rules; allow grants ignored with log.warn

## Impact
Trust/stability defect on packages/ax-code/src/permission surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Static control-flow proof of current defense
