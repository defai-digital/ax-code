# AUDIT-cli-cmd-tui-boot-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in cli-cmd-tui-boot (1 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | cli-cmd-tui-boot |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 1

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
