# AUDIT-pkg-ax-code-tui-core-empty-catch

| Field                | Value                                               |
| -------------------- | --------------------------------------------------- |
| Title                | Empty catch sites in pkg-ax-code-tui-core (6 sites) |
| Category             | silent-error                                        |
| Severity             | Low                                                 |
| Origin               | new                                                 |
| Status               | deferred                                            |
| Module               | pkg-ax-code-tui-core                                |
| Owner                | ax-code-glm                                         |
| Expiry               | 2026-09-11                                          |
| Independent verifier | codex-sol                                           |

## Per-site disposition

| Site                                                       | Code                 | Disposition   | Rationale                         |
| ---------------------------------------------------------- | -------------------- | ------------- | --------------------------------- |
| `packages/ax-code-tui/index-07zpr2dg.js:1261`              | `} catch (e) {}`     | review-needed | empty catch without local comment |
| `packages/ax-code-tui/index-07zpr2dg.js:5237`              | `} catch {}`         | review-needed | empty catch without local comment |
| `packages/ax-code-tui/index-pcvh9d34.js:8321`              | `} catch {}`         | review-needed | empty catch without local comment |
| `packages/ax-code-tui/index-pcvh9d34.js:15106`             | `} catch (error) {}` | review-needed | empty catch without local comment |
| `packages/ax-code-tui/lib/tree-sitter/update-assets.js:40` | `} catch (error) {}` | review-needed | empty catch without local comment |
| `packages/ax-code-tui/parser.worker.js:79`                 | `} catch (error) {}` | review-needed | empty catch without local comment |

## Summary

- needs-log: 0
- accepted-best-effort/missing-ok: 0
- review-needed: 6

## Mitigation

High-risk kill/auth paths fixed elsewhere (terminal/pty/auth). Remaining sites tracked with site-level disposition above; not bulk-ignored.
