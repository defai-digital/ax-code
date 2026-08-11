# AUDIT-desktop-web-notifications-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-notifications (2 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-notifications |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/notifications/routes.js:54` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/notifications/template-runtime.js:311` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 2

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
