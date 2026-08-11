# AUDIT-desktop-web-event-stream-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in desktop-web-event-stream (10 sites) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | desktop-web-event-stream |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:50` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:60` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/event-stream/directory-ws-bridge.js:216` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:66` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:163` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/event-stream/global-ws-bridge.js:177` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/event-stream/protocol.js:77` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/event-stream/protocol.js:87` | `} catch {}` | needs-log | process/stream failure should surface |
| `desktop/packages/web/server/lib/event-stream/runtime.js:27` | `} catch {}` | review-needed | empty catch without local comment |
| `desktop/packages/web/server/lib/event-stream/runtime.js:162` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 4
- accepted-best-effort/missing-ok: 0
- review-needed: 6

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
