# AUDIT-pkg-opentui-solid-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in pkg-opentui-solid (2 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | pkg-opentui-solid |
| Owner | codex-sol |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/opentui-solid/index.bun.js:959` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/opentui-solid/index.js:982` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 2

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
