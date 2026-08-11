# AUDIT-desktop-web-ui-auth-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-ui-auth (4 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-ui-auth |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:86` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:101` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:105` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ui-auth/ui-passkeys.js:109` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 4

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
