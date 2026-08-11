# AUDIT-desktop-web-scheduled-tasks-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-scheduled-tasks (5 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-scheduled-tasks |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/scheduled-tasks/routes.js:179` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/scheduled-tasks/routes.js:211` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.js:353` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.js:631` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.js:786` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 5

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
