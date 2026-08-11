# AUDIT-cli-parent-empty-catch

| Field | Value |
|-------|-------|
| Title | 4 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | cli-parent |
| Evidence | packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49; packages/ax-code/src/cli/cmd/run.ts:839; packages/ax-code/src/cli/cmd/storage/session.ts:453; packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590 |
| Independent verifier | ax-code-glm |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | codex-sol |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `packages/ax-code/src/cli` (cli).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
