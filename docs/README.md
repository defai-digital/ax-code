# AX Code Documentation

Status: Active
Scope: current-state
Last reviewed: 2026-04-21
Owner: ax-code runtime

The root [README](../README.md) is the shortest path to install and launch AX Code. This documentation hub is the next step once you want a clearer product overview, operational guidance, or architecture detail.

## Entry Points

| Need                                            | Go here                                                         | What you get                                                           |
| ----------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Understand what AX Code is and why teams use it | [Start Here](start-here.md)                                     | Product overview, value proposition, mental model, and next paths      |
| Install and launch quickly                      | [Root README](../README.md)                                     | 60-second setup, common commands, and main entrypoints                 |
| Embed AX Code in TypeScript or JavaScript       | [`@ax-code/sdk`](../packages/sdk/js/README.md)                  | `createAgent()`, streaming, custom tools, testing, and migration notes |
| Use AX Code from VS Code                        | [VS Code integration](../packages/integration-vscode/README.md) | Editor commands, settings, and extension workflow                      |

## Guides

| Document                         | Summary                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| [Sandbox Mode](sandbox.md)       | Execution isolation, protected paths, network behavior, and configuration |
| [Autonomous Mode](autonomous.md) | Unattended execution, approval behavior, headless usage, and safeguards   |
| [Auto-Route](auto-route.md)      | LLM-assisted agent routing and complexity-based model selection           |

## Architecture

| Document                                                     | Summary                                                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [Semantic Layer](architecture/semantic-layer.md)             | Current semantic contract for graph and LSP-backed answers, provenance, audit, and replay |
| [Repository Structure](architecture/repo-structure.md)       | Canonical repo layout, dependency rules, and placement guidance                           |
| [Testing Policy](architecture/testing-policy.md)             | Default test layout by package type and when tests are required                           |
| [Documentation Policy](architecture/documentation-policy.md) | Status model, source-of-truth rules, and drift-prevention checklist for docs              |

## Specs and Reference

| Document                                        | Summary                                                       |
| ----------------------------------------------- | ------------------------------------------------------------- |
| [Project API Spec](specs/project.md)            | Current project and session API shape                         |
| [Migration Review](ax-code-migration-review.md) | Migration framing for OpenCode plus ax-cli to AX Code         |
| [Security Policy](../SECURITY.md)               | Threat model, credential storage, and server security posture |

## Policies

Machine-readable examples live in [`policies/`](policies/).

## Notes on Scope

This folder is for product-facing documentation. Planning documents, PRDs, ADRs, and temporary reports should stay outside the public docs surface or carry an explicit status so historical or proposed behavior is not mistaken for shipped behavior.
