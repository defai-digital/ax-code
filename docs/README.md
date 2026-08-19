# AX Code Documentation

Status: Active
Scope: public, current-state
Last reviewed: 2026-07-25
Owner: AX Code maintainers

The root [README](../README.md) is the shortest path to install and launch AX Code. Use this hub when you need to
configure a workflow, understand a runtime boundary, or integrate AX Code with another system.

## Choose by task

| I want to…                                               | Start here                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Understand AX Code before installing it                  | [Start Here](getting-started/start-here.md)                             |
| Choose an install or runtime channel                     | [Installation and Runtime Channels](getting-started/install-runtime.md) |
| Connect a hosted, CLI, custom, or local provider         | [Supported Providers and Models](providers/supported-providers.md)      |
| Try AX Code with a free-tier model API                   | [Free-Tier API Quickstart](providers/free-tier-apis.md)                 |
| Run an agent with safe filesystem and network boundaries | [Sandbox Mode](guides/sandbox.md)                                       |
| Run unattended or in CI                                  | [Autonomous Mode](guides/autonomous.md)                                 |
| Run recurring prompts or schedule durable tasks          | [Loop Mode and Scheduled Tasks](guides/loop-mode.md)                    |
| Keep scheduled work running across process or host exits | [Long-Running Operations](guides/long-running-operations.md)            |
| Choose local, cloud, hybrid, council, or arena execution | [Execution Modes](guides/modes.md)                                      |
| Connect external tools and data                          | [MCP Integrations](integrations/mcp.md)                                 |
| Embed AX Code in an application                          | [`@ax-code/sdk`](../packages/sdk/js/README.md)                          |
| Generate a client for another language                   | [HTTP and OpenAPI Compatibility](sdk/http-openapi.md)                   |
| Build a desktop or native host                           | [Native SDK Transport](sdk/native-transport.md)                         |

## Getting started

- [Start Here](getting-started/start-here.md) — product mental model and the shortest paths by use case.
- [Installation and Runtime Channels](getting-started/install-runtime.md) — supported platforms, packages, updates, and
  contributor launchers.

## Runtime guides

- [Sandbox Mode](guides/sandbox.md) — isolation modes, protected paths, network controls, and precedence.
- [Autonomous Mode](guides/autonomous.md) — unattended execution, approvals, headless use, and safeguards.
- [Loop Mode and Scheduled Tasks](guides/loop-mode.md) — recurring prompts, durable schedules, and long-run limits.
- [Long-Running Operations](guides/long-running-operations.md) — supervised service examples, recovery semantics, and
  operational checks.
- [Execution Modes](guides/modes.md) — agent, hybrid, council, and arena behavior.
- [Multi-Model Routing Best Practices](guides/multi-model-routing.md) — split premium reasoning and lower-cost support
  work without silently weakening correctness-sensitive tasks.
- [Auto-Route](guides/auto-route.md) — specialist routing and optional complexity routing.
- [Model Effort](guides/effort.md) — thinking levels and provider-specific behavior.
- [Lifecycle Hooks](guides/hooks.md) — hook events and bundled policy packs.
- [Web Dashboard](guides/dashboard.md) — workspace usage, activity, model/tool breakdowns, and per-session reports.

## Providers

- [Supported Providers and Models](providers/supported-providers.md) — provider IDs, credentials, and model discovery.
- [Free-Tier API Quickstart](providers/free-tier-apis.md) — compatible no-cost paths, constraints, and safe evaluation.
- [Custom and Gateway Providers](providers/custom-provider.md) — OpenAI- and Anthropic-compatible endpoints.
- [AX Engine Model Selection](providers/ax-engine-model-selection.md) — local model ranking and memory guidance.

## Integrations

- [MCP Integrations](integrations/mcp.md) — trust, permissions, resources, and server security.
- [ACP](integrations/acp.md) — the Agent Client Protocol happy path for IDE hosts.
- [AX Wiki](integrations/wiki.md) — source-backed repository knowledge and CI workflow.
- [VS Code Integration](../packages/integration-vscode/README.md) — editor commands, settings, and workflows.

## SDK and service boundaries

- [`@ax-code/sdk`](../packages/sdk/js/README.md) — first-party TypeScript and JavaScript embedding.
- [Native SDK Transport](sdk/native-transport.md) — gRPC-shaped desktop/native boundary and fallback behavior.
- [HTTP and OpenAPI Compatibility](sdk/http-openapi.md) — server mode and generated clients for other languages.
- [OpenAPI snapshot](../packages/sdk/openapi.json) — authoritative HTTP route and schema contract.

## Architecture and reliability

- [Semantic Layer](architecture/semantic-layer.md) — graph and LSP provenance, audit, and replay boundaries.
- [Local Engine Architecture](architecture/local-engine.md) — why AX Code uses an AX Engine sidecar.
- [Runtime Stability](architecture/stability.md) — cancellation, crash, stream, timeout, and TUI reliability contracts.
- [AX Work](architecture/ax-work.md) — Work is a separate product; AX Code stays code-only.

## Reference

- [Skill and Plugin Catalog](reference/skills-and-plugins.md) — bundled skills, project skills, plugins, and evals.
- [Isolation Policy Packs](policies/README.md) — machine-readable policy examples.
- [Release Verification](release/README.md) — canonical minisign public key and verification command.
- [Security Policy](../SECURITY.md) — threat model, credential storage, and supported versions.

## Documentation boundaries

`docs/` contains public guidance for behavior that exists in the current runtime. Planning material and temporary
analysis do not belong here:

| Content                                             | Location             |
| --------------------------------------------------- | -------------------- |
| Architecture decisions                              | `.internal/adr/`     |
| Product requirements                                | `.internal/prd/`     |
| Internal plans, test/QA output, audits, and reports | `.internal/reports/` |
| Shipped behavior and public integration guidance    | `docs/`              |

Every public Markdown page should declare its status, scope, last-reviewed date, and owner near the top. Prefer links to
generated contracts or implementation sources over copied route lists and other high-drift snapshots.

## Maintenance checklist

Before a release or a substantial documentation change:

1. Verify commands, defaults, flags, provider IDs, and runtime labels against their implementation.
2. Update the narrowest authoritative guide instead of repeating the same behavior in several front-door pages.
3. Run `pnpm run test:scripts` to catch broken local links, orphaned pages, and missing page metadata.
4. Keep proposals and historical decision records under `.internal/`, not in the public navigation.
