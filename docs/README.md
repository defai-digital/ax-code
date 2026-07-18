# AX Code Documentation

Status: Active
Scope: current-state
Last reviewed: 2026-05-16
Owner: ax-code runtime

The root [README](../README.md) is the shortest path to install and launch AX Code. This documentation hub is the next step once you want a clearer product overview, operational guidance, or architecture detail.

## Entry Points

| Need                                            | Go here                                                         | What you get                                                                |
| ----------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Understand what AX Code is and why teams use it | [Start Here](start-here.md)                                     | Product overview, value proposition, mental model, and next paths           |
| Install and launch quickly                      | [Root README](../README.md)                                     | 60-second setup, supported installer channels, and main entrypoints         |
| Compare install and runtime channels            | [Installation and Runtime Channels](install-runtime.md)         | Platform policy, package names, runtime labels, and local launcher behavior |
| Embed AX Code in TypeScript or JavaScript       | [`@ax-code/sdk`](../packages/sdk/js/README.md)                  | `createAgent()`, streaming, custom tools, testing, and migration notes      |
| Build a desktop/native GUI                      | [gRPC and Native SDK Transport](sdk-grpc-native.md)             | Optional gRPC-shaped headless contract, native transport guidance, fallback |
| Use AX Code from Python, Go, Java, or services  | [HTTP and OpenAPI SDKs](sdk-http-openapi.md)                    | `ax-code serve`, OpenAPI generation, and cross-language guardrails          |
| Use AX Code from VS Code                        | [VS Code integration](../packages/integration-vscode/README.md) | Editor commands, settings, and extension workflow                           |

## Guides

| Document                                                  | Summary                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Sandbox Mode](sandbox.md)                                | Execution isolation, protected paths, network behavior, and configuration                                |
| [Stability](stability.md)                                 | Crash hygiene, aborts vs faults, TUI lifecycle, timeouts, permission latch                               |
| [Installation and Runtime Channels](install-runtime.md)   | Platform policy, package channels, `ax-code doctor` runtime labels, updates, and local launcher behavior |
| [Autonomous Mode](autonomous.md)                          | Unattended execution, approval behavior, headless usage, and safeguards                                  |
| [MCP Integrations](mcp.md)                                | MCP trust, permissions, prompt/resource handling, and server-route security                              |
| [Auto-Route](auto-route.md)                               | Keyword-based specialist routing (active by default) and optional fast-model complexity routing          |
| [Execution Modes](modes.md)                               | Local, cloud, hybrid placement; multi-provider council consensus and arena best-of-N                     |
| [Model Effort](effort.md)                                 | Reasoning / thinking levels (Auto, Fast, Balanced, Deep, Max) as model variants                          |
| [Repo Wiki (OpenWiki)](wiki.md)                           | Semantic multi-page wiki via OpenWiki; complements structural `ax-code index`                            |
| [Supported Providers and Models](supported-providers.md)  | Default Cloud API providers, CLI providers, and AX Engine local models                                   |
| [Custom and Gateway Providers](custom-provider.md)        | Connect any OpenAI- or Anthropic-compatible endpoint or self-hosted gateway via custom provider config   |
| [AX Engine Model Selection](ax-engine-model-selection.md) | Local AX Engine model ranking, memory guidance, and practical default choices                            |
| [Lifecycle Hooks](hooks.md)                               | PreToolUse / PostToolUse / Stop hooks and official packs                                                 |
| [ACP happy path](acp.md)                                  | Agent Client Protocol for IDE hosts (Zed, etc.)                                                          |
| [Skill / plugin catalog](skills/CATALOG.md)               | Built-in skills, project skill locations, plugins, eval harness                                          |

## Architecture

| Document                            | Summary                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| [Semantic Layer](semantic-layer.md) | Current semantic contract for graph and LSP-backed answers, provenance, audit, and replay |
| [Repo Wiki (OpenWiki)](wiki.md)     | OpenWiki semantic wiki layer, AGENTS markers, and routing vs structural index             |

## Specs and Reference

| Document                                            | Summary                                                       |
| --------------------------------------------------- | ------------------------------------------------------------- |
| [Project API Spec](specs/project.md)                | Current project and session API shape                         |
| [gRPC and Native SDK Transport](sdk-grpc-native.md) | Desktop/native GUI transport contract and security posture    |
| [HTTP and OpenAPI SDKs](sdk-http-openapi.md)        | Cross-language HTTP integration and generated-client guidance |
| [Security Policy](../SECURITY.md)                   | Threat model, credential storage, and server security posture |

## Policies

Machine-readable examples live in [`policies/`](policies/). See [policies/README.md](policies/README.md).

## Notes on Scope

This folder is for product-facing documentation. Planning documents, PRDs, ADRs, and temporary reports should stay outside the public docs surface or carry an explicit status so historical or proposed behavior is not mistaken for shipped behavior.

## Doc Freshness Policy

Public docs should stay close to the shipped runtime. Before a release or major documentation refresh, verify the most drift-prone claims against their source of truth:

| Claim area                                                     | Source of truth                                                                                                 | What to check                                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Install, runtime, package manager, and local launcher behavior | Root `package.json`, `packages/ax-code/package.json`, `script/setup-cli.ts`, `packages/ax-code/script/build.ts` | Package names, Bun/pnpm requirements, build/link commands, and `ax-code doctor` runtime labels       |
| Local AX Engine provider and model selection                   | `packages/ax-code/src/provider/ax-engine/` and `docs/ax-engine-model-selection.md`                              | Platform gates, selectable models, quantization, memory guidance, disk requirements, and model ids   |
| Sandbox, autonomous mode, routing, and TUI status labels       | Runtime config, TUI command handlers, and status view models under `packages/ax-code/src/`                      | Defaults, command names, environment variables, persisted config keys, and user-facing labels        |
| Execution modes (local/cloud/hybrid/council/arena)             | `packages/ax-code/src/mode/`, `tool/council.ts`, `tool/arena.ts`, `docs/modes.md`                               | Config keys, tool names, ranking rules, and isolation guarantees                                     |
| SDK and OpenAPI integration                                    | `packages/sdk/js/package.json`, `packages/sdk/openapi.json`, SDK exports, and `docs/sdk-http-openapi.md`        | Official entry points, version examples, generated-client guidance, and service-boundary limitations |
| Architecture and semantic behavior                             | Current implementation plus architecture docs such as `semantic-layer.md`                                       | Whether a document describes current behavior, roadmap intent, or historical context                 |

Prefer updating the specific behavior doc and linking to it from this hub rather than duplicating detailed behavior in multiple front-door pages.
