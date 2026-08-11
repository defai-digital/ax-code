# AUDIT-config-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in config (1 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | config |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/ax-code/src/config/config-impl.ts:123` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 1

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
