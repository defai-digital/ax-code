# AUDIT-cli-parent-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in cli-parent (4 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | cli-parent |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/ax-code/src/cli/cmd/github-agent/github-api.ts:49` | `} catch {}` | accepted-missing-ok | likely missing-path tolerance |
| `packages/ax-code/src/cli/cmd/run.ts:839` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/ax-code/src/cli/cmd/storage/session.ts:453` | `} catch {}` | needs-log | process/stream failure should surface |
| `packages/ax-code/src/cli/cmd/tui/component/prompt/index.tsx:1590` | `} catch {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 1
- accepted-best-effort/missing-ok: 1
- review-needed: 2

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
