# AUDIT-tool-execution-001

| Field | Value |
|-------|-------|
| Title | ~ and bare $VAR path bypass |
| Category | security |
| Severity | Critical |
| Origin | prior-review |
| Status | verified-fixed |
| Module | tool-execution |
| Evidence | packages/ax-code/src/tool/bash-helpers.ts:expandLeadingTilde + bash-impl recordResolvedPath |
| Independent verifier | codex-sol (independent re-read 2026-08-11) |
| Regression test | source re-verify / existing suite |

## Proof
expandLeadingTilde expands ~/ ; dynamic expansion sets dynamicPathAccess

## Impact
Trust/stability defect on packages/ax-code/src/tool (bash/shell execution) surface.

## Fix
See proof. Minimal invariant restoration already present or applied this program.

## Verification
- Re-read evidence path at baseline/current
- Static control-flow proof of current defense
