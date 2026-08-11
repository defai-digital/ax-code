# AUDIT-pkg-opentui-core-empty-catch

| Field | Value |
|-------|-------|
| Title | 6 empty catch site(s) remain (best-effort/deferred) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | pkg-opentui-core |
| Evidence | packages/opentui-core/index-07zpr2dg.js:1261; packages/opentui-core/index-07zpr2dg.js:5237; packages/opentui-core/index-pcvh9d34.js:8321; packages/opentui-core/index-pcvh9d34.js:15106; packages/opentui-core/lib/tree-sitter/update-assets.js:40; packages/opentui-core/parser.worker.js:79 |
| Independent verifier | codex-sol |
| Regression test | n/a — deferred with owner review 2026-09-11 |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |

## Proof
Disposition: best-effort dispose/teardown or intentional ignore; not auto-fixed to avoid noise. Tracked residual risk. High-risk kill paths fixed in terminal/pty/auth.

## Impact
Affects `packages/opentui-core` (ui).

## Verification
- Evidence path re-read at commit `8556bab68b2232bf9bbf4509092468efa73611af`
- n/a — deferred with owner review 2026-09-11
