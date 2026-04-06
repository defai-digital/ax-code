# AX Code Documentation

This folder holds repository documentation that should be stable, discoverable, and safe to reference from code reviews and contributor guidance.

## Architecture

| Document                                               | Summary                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Repository Structure](architecture/repo-structure.md) | Canonical repo layout, dependency rules, hotspot folders, and placement guidance |
| [Testing Policy](architecture/testing-policy.md)       | Default test layout by package type and when tests are required                  |

## Planning

| Folder             | Summary                                            |
| ------------------ | -------------------------------------------------- |
| [`adr/`](adr/)     | Architecture decision records                      |
| [`prd/`](prd/)     | Product and engineering requirement documents      |
| [`specs/`](specs/) | Stable product and technical specifications        |
| [`bugs/`](bugs/)   | Bug inventories, audits, and defect tracking notes |
| [`todos/`](todos/) | Deferred work and follow-up plans                  |

## Guides

| Document                   | Summary                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| [Sandbox Mode](sandbox.md) | Execution sandbox — toggle, configuration, isolation modes, enforcement details |

## Reference

| Document                                        | Summary                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| [Migration Review](ax-code-migration-review.md) | Feature comparison and migration strategy: OpenCode + ax-cli → AX Code |

## Policies

Machine-readable policy examples live in [`docs/policies`](policies/).
