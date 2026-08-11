# AUDIT-desktop-web-preview-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-preview (9 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | desktop-web-preview |
| Owner | codex-sol |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:190` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:230` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:292` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:408` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:457` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:491` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:529` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:545` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/preview/proxy-runtime.js:562` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 9

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
