# AX Code Documentation

This folder holds **product-facing** documentation: user guides, architecture policies, specs, and reference material. Development-stage planning documents live outside the public docs surface and should not be referenced as shipped product documentation.

## Architecture

| Document                                               | Summary                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [Semantic Layer](architecture/semantic-layer.md)       | Current semantic contract: LSP vs graph surfaces, provenance, and audit/replay boundaries |
| [Repository Structure](architecture/repo-structure.md) | Canonical repo layout, dependency rules, hotspot folders, and placement guidance |
| [Documentation Policy](architecture/documentation-policy.md) | Status model, source-of-truth rules, and drift-prevention checklist for docs |
| [Testing Policy](architecture/testing-policy.md)       | Default test layout by package type and when tests are required                  |

## Guides

| Document                          | Summary                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| [Sandbox Mode](sandbox.md)        | Execution sandbox — toggle, configuration, isolation modes, enforcement details           |
| [Auto-Route](auto-route.md)       | LLM-enhanced agent routing and complexity-based model selection — configuration and trade-offs |
| [Autonomous Mode](autonomous.md)  | Unattended execution — how it works, safety boundaries, and when to use it                |

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

PRDs, ADRs, and temporary reports belong to the internal planning workspace, not the public documentation surface.

Important rule: proposal and historical documents should still carry explicit status labels such as `Draft`, `Implemented`, or `Superseded` so internal planning text is not mistaken for current product behavior.
