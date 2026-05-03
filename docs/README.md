# AX Code Documentation

Status: Active
Scope: current-state
Last reviewed: 2026-05-03
Owner: ax-code runtime

The root [README](../README.md) is the shortest path to install and launch AX Code. This documentation hub is the next step once you want a clearer product overview, operational guidance, or architecture detail.

## Entry Points

| Need                                            | Go here                                                         | What you get                                                           |
| ----------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Understand what AX Code is and why teams use it | [Start Here](start-here.md)                                     | Product overview, value proposition, mental model, and next paths      |
| Install and launch quickly                      | [Root README](../README.md)                                     | 60-second setup, compiled package install, and main entrypoints        |
| Embed AX Code in TypeScript or JavaScript       | [`@ax-code/sdk`](../packages/sdk/js/README.md)                  | `createAgent()`, streaming, custom tools, testing, and migration notes |
| Use AX Code from Python, Go, Java, or services  | [HTTP and OpenAPI SDKs](sdk-http-openapi.md)                    | `ax-code serve`, OpenAPI generation, and cross-language guardrails      |
| Use AX Code from VS Code                        | [VS Code integration](../packages/integration-vscode/README.md) | Editor commands, settings, and extension workflow                      |

## Guides

| Document                         | Summary                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| [Sandbox Mode](sandbox.md)       | Execution isolation, protected paths, network behavior, and configuration |
| [Autonomous Mode](autonomous.md) | Unattended execution, approval behavior, headless usage, and safeguards   |
| [Auto-Route](auto-route.md)      | Keyword-based specialist routing (active by default) and optional fast-model complexity routing |

## Architecture

| Document                                         | Summary                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [Semantic Layer](semantic-layer.md)              | Current semantic contract for graph and LSP-backed answers, provenance, audit, and replay |

## Specs and Reference

| Document                                        | Summary                                                       |
| ----------------------------------------------- | ------------------------------------------------------------- |
| [Project API Spec](specs/project.md)            | Current project and session API shape                         |
| [HTTP and OpenAPI SDKs](sdk-http-openapi.md)    | Cross-language HTTP integration and generated-client guidance  |
| [Security Policy](../SECURITY.md)               | Threat model, credential storage, and server security posture |

## Policies

Machine-readable examples live in [`policies/`](policies/).

## Notes on Scope

This folder is for product-facing documentation. Planning documents, PRDs, ADRs, and temporary reports should stay outside the public docs surface or carry an explicit status so historical or proposed behavior is not mistaken for shipped behavior.

## Doc Freshness Policy

Public docs should stay close to the shipped runtime. Before a release or major documentation refresh, verify the most drift-prone claims against their source of truth:

| Claim area | Source of truth | What to check |
| ---------- | --------------- | ------------- |
| Install, runtime, package manager, and local launcher behavior | Root `package.json`, `packages/ax-code/package.json`, `script/setup-cli.ts`, `packages/ax-code/script/build.ts` | Package names, Bun/pnpm requirements, build/link commands, and `ax-code doctor` runtime labels |
| Sandbox, autonomous mode, routing, and TUI status labels | Runtime config, TUI command handlers, and status view models under `packages/ax-code/src/` | Defaults, command names, environment variables, persisted config keys, and user-facing labels |
| SDK and OpenAPI integration | `packages/sdk/js/package.json`, `packages/sdk/openapi.json`, SDK exports, and `docs/sdk-http-openapi.md` | Official entry points, version examples, generated-client guidance, and service-boundary limitations |
| Architecture and semantic behavior | Current implementation plus architecture docs such as `semantic-layer.md` | Whether a document describes current behavior, roadmap intent, or historical context |

Prefer updating the specific behavior doc and linking to it from this hub rather than duplicating detailed behavior in multiple front-door pages.
