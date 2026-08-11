# AUDIT-telemetry-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in telemetry (1 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | telemetry |
| Owner | codex-sol |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/ax-code/src/telemetry/span.ts:59` | `} catch {}` | needs-log | process/stream failure should surface |

## Summary
- needs-log: 1
- accepted-best-effort/missing-ok: 0
- review-needed: 0

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
