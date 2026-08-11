# AUDIT-desktop-electron-shell-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-electron-shell (5 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-electron-shell |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/electron/src/main.js:1646` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/electron/src/main.js:1656` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/electron/src/main.js:2168` | `} catch {}` | accepted-missing-ok | likely missing-path tolerance |
| `desktop/packages/electron/src/server-process.js:51` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/electron/src/startup-diagnostics.js:47` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 1
- review-needed: 4

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
