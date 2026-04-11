# AX Code Documentation

This folder holds **product-facing** documentation: user guides, architecture policies, specs, and reference material.

## Architecture

| Document                                               | Summary                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Repository Structure](architecture/repo-structure.md) | Canonical repo layout, dependency rules, hotspot folders, and placement guidance |
| [Testing Policy](architecture/testing-policy.md)       | Default test layout by package type and when tests are required                  |

## Guides

| Document                                         | Summary                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| [Code Intelligence Graph](code-intelligence.md)  | Indexing, querying, DRE workflows, and troubleshooting the persistent code graph |
| [Sandbox Mode](sandbox.md)                       | Execution sandbox — toggle, configuration, isolation modes, enforcement details |

## Specs

| Document                           | Summary                                    |
| ---------------------------------- | ------------------------------------------ |
| [`specs/project.md`](specs/project.md) | API spec for project/session management |

## Reference

| Document                                        | Summary                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [Migration Review](ax-code-migration-review.md) | Feature comparison and migration strategy: OpenCode + ax-cli -> AX Code |

## Policies

Machine-readable policy examples live in [`policies/`](policies/).

| Document | Summary |
| -------- | ------- |
| [`../LICENSING.md`](../LICENSING.md) | Canonical MIT licensing policy for the AX Code repository and release artifacts |
| [`../TRADEMARKS.md`](../TRADEMARKS.md) | Branding and naming rules for forks, redistributions, and compatibility claims |

## Notes

- Current licensing for AX Code is defined by [`../LICENSING.md`](../LICENSING.md), not by historical planning documents in this folder.
