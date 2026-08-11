# AUDIT-pkg-opentui-core-empty-catch

| Field | Value |
|-------|-------|
| Title | Empty catch sites in pkg-opentui-core (6 sites) |
| Category | silent-error |
| Severity | Low |
| Origin | new |
| Status | deferred |
| Module | pkg-opentui-core |
| Owner | ax-code-glm |
| Expiry | 2026-09-11 |
| Independent verifier | codex-sol |

## Per-site disposition

| Site | Code | Disposition | Rationale |
|------|------|-------------|-----------|
| `packages/opentui-core/index-07zpr2dg.js:1261` | `} catch (e) {}` | review-needed | empty catch without local comment |
| `packages/opentui-core/index-07zpr2dg.js:5237` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/opentui-core/index-pcvh9d34.js:8321` | `} catch {}` | review-needed | empty catch without local comment |
| `packages/opentui-core/index-pcvh9d34.js:15106` | `} catch (error) {}` | review-needed | empty catch without local comment |
| `packages/opentui-core/lib/tree-sitter/update-assets.js:40` | `} catch (error) {}` | review-needed | empty catch without local comment |
| `packages/opentui-core/parser.worker.js:79` | `} catch (error) {}` | review-needed | empty catch without local comment |

## Summary
- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 6

## Mitigation
High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
