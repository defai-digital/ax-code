# AX Code Documentation

This folder holds **product-facing** documentation: user guides, architecture policies, specs, and reference material. Development-stage planning (PRDs, ADRs, research) lives in `automatosx/` at the repo root.

## Architecture

| Document                                               | Summary                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Repository Structure](architecture/repo-structure.md) | Canonical repo layout, dependency rules, hotspot folders, and placement guidance |
| [Testing Policy](architecture/testing-policy.md)       | Default test layout by package type and when tests are required                  |

## Guides

| Document                   | Summary                                                                      |
| -------------------------- | ---------------------------------------------------------------------------- |
| [Sandbox Mode](sandbox.md) | Execution sandbox — toggle, configuration, isolation modes, enforcement details |

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

## Development-Stage Documents

PRDs, ADRs, and temporary reports are in `automatosx/` (gitignored, not shipped):

- `automatosx/prd/` — Product requirement documents
- `automatosx/adr/` — Architecture decision records
- `automatosx/tmp/` — Temporary reports and research

Use `/prd` and `/adr` slash commands to create new documents — they write to the correct location automatically.
