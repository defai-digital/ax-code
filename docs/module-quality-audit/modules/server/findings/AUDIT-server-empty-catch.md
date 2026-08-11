# AUDIT-server-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in server (2 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | server |
| Owner | codex-sol |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/ax-code/src/server/ipc-transport.ts:319` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/ax-code/src/server/runtime-adapter.ts:132` | `} catch {}` | needs-log | process/stream failure should surface |

## Summary
- needs-log: 1
- accepted-best-effort/missing-ok: 0
- review-needed: 1

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
