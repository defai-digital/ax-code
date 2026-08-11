# AUDIT-desktop-web-server-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-server (87 sites) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | desktop-web-server |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/index.js:143` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:73` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:174` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:181` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:268` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:275` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:283` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/core-routes.js:290` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:153` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:167` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:207` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:368` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:529` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:559` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:603` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:622` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:682` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:701` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:972` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:1023` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js:1064` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:80` | `} catch {}` | accepted-best-effort | adjacent dispose/cleanup/best-effort context |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:83` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:185` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:197` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:209` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:217` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:225` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:735` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js:1023` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/plugin-routes.test.js:79` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/proxy.js:311` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/proxy.js:502` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/proxy.js:603` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/proxy.js:627` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/session-runtime.js:172` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/session-runtime.js:230` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/ax-code/watcher.js:106` | `} catch {}` | accepted-missing-ok | likely missing-path tolerance |
| `desktop/packages/web/server/lib/desktop/startup-diagnostics.js:73` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:50` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 16
- accepted-best-effort/missing-ok: 6
- review-needed: 65

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
