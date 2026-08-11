# AUDIT-desktop-web-security-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-security (4 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-security |
| Owner | codex-sol |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/security/legacy-tunnel.js:38` | `} catch {}` | accepted-missing-ok | likely missing-path tolerance |
| `desktop/packages/web/server/lib/security/legacy-tunnel.js:49` | `} catch {}` | accepted-missing-ok | likely missing-path tolerance |
| `desktop/packages/web/server/lib/security/request-security.js:52` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/security/request-security.js:56` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 2
- review-needed: 2

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
