# AUDIT-desktop-web-fs-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-fs (3 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-fs |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/fs/routes.js:379` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/fs/routes.js:1447` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/fs/routes.js:1449` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 1
- accepted-best-effort/missing-ok: 0
- review-needed: 2

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
