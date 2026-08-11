# AUDIT-pkg-sdk-js-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in pkg-sdk-js (9 sites) |
| Category | silent-error |
| Severity | Medium |
| Origin | new |
| Status | deferred |
| Module | pkg-sdk-js |
| Owner | implementer |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/sdk/js/src/grpc.ts:2327` | `} catch {}` | needs-log | process/stream failure should surface |
| `packages/sdk/js/src/headless/lifecycle.ts:450` | `} catch {}` | needs-log | process/stream failure should surface |
| `packages/sdk/js/src/headless/lifecycle.ts:463` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/sdk/js/src/headless/lifecycle.ts:469` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/sdk/js/src/internal/server-shared.ts:92` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/sdk/js/src/internal/server-shared.ts:149` | `} catch {}` | needs-log | process/stream failure should surface |
| `packages/sdk/js/src/internal/server-shared.ts:256` | `} catch {}` | needs-log | process/stream failure should surface |
| `packages/sdk/js/src/protocol.ts:29` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/sdk/js/test/headless-lifecycle.test.ts:553` | `"  try { fs.writeFileSync(process.env.AX_CODE_FAKE_TERM_FILE, 'terminated') } catch {}",` | needs-log | process/stream failure should surface |

## Summary
- needs-log: 5
- accepted-best-effort/missing-ok: 0
- review-needed: 4

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
