# AUDIT-desktop-web-terminal-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-terminal (6 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-terminal |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/terminal/runtime.js:29` | `} catch {}` | accepted-best-effort | adjacent dispose/cleanup/best-effort context |
| `desktop/packages/web/server/lib/terminal/runtime.js:32` | `} catch {}` | accepted-best-effort | adjacent dispose/cleanup/best-effort context |
| `desktop/packages/web/server/lib/terminal/runtime.js:213` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/terminal/runtime.js:308` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/terminal/runtime.js:352` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/terminal/runtime.js:996` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 2
- accepted-best-effort/missing-ok: 2
- review-needed: 2

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
