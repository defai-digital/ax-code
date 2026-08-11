# AUDIT-cli-cmd-github-agent-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in cli-cmd-github-agent (1 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | cli-cmd-github-agent |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | ax-code-glm |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49` | `} catch {}` | accepted-missing-ok | likely missing-path tolerance |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 1
- review-needed: 0

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
