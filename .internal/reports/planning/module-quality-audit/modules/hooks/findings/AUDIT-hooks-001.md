# AUDIT-hooks-001

| Field | Value |
|-------|-------|
| Title | Project hooks.json executes shell without trust gate |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | hooks |
| Evidence | packages/ax-code/src/hooks/lifecycle.ts:loadProjectHooks |
| Independent verifier | ax-code-glm (independent re-read 2026-08-11) |
| Regression test | source re-verify / existing suite |

## Proof
loadProjectHooks returns [] unless ProjectConfigTrust.enabled(); ProjectConfigTrust only honors AX_CODE_TRUST_PROJECT_CONFIG=1

## Impact
Trust/stability defect on packages/ax-code/src/hooks surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Static control-flow proof of current defense
