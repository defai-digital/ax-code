# AX Code Documentation

Status: Active
Scope: public, current-state
Last reviewed: 2026-11-26
Owner: AX Code maintainers

Choose the [Desktop app or standalone CLI](getting-started/install-runtime.md),
then [connect a provider](getting-started/connect-provider.md) and
[review your first change](getting-started/start-here.md). For an existing installation,
see [Upgrade and recovery](getting-started/upgrade.md). For source builds and the
published SDK, see [Source access and public distribution](getting-started/source-access.md).

## Practical quickstarts

1. [Connect your first provider](getting-started/connect-provider.md)
2. [Choose and change models](getting-started/select-model.md)
3. [Create and use your first AX Wiki](getting-started/wiki-quickstart.md)

## Choose by task

| I want to…                                               | Start here                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Understand AX Code before installing it                  | [Start Here](getting-started/start-here.md)                             |
| Review, compare, or undo what an agent did               | [Execution Evidence](guides/execution-evidence.md)                      |
| Get several models to attempt the same change            | [Verified Multi-Model Changes](guides/verified-multi-model-change.md)   |
| Choose an install or runtime channel                     | [Installation and Runtime Channels](getting-started/install-runtime.md) |
| Connect a hosted, CLI, custom, or local provider         | [Supported Providers and Models](providers/supported-providers.md)      |
| Enable managed local inference on Apple Silicon          | [AX Engine Model Selection](providers/ax-engine-model-selection.md)     |
| Try AX Code with a free-tier model API                   | [Free-Tier API Quickstart](providers/free-tier-apis.md)                 |
| Run an agent with safe filesystem and network boundaries | [Sandbox Mode](guides/sandbox.md)                                       |
| Administer cloud or network infrastructure safely        | [Cloud Operations Mode](guides/cloud-operations.md)                     |
| Run unattended or in CI                                  | [Autonomous Mode](guides/autonomous.md)                                 |
| Call the one-shot `ax-code run` CLI from scripts or CI   | [Headless CLI](guides/headless-cli.md)                                  |
| Run recurring prompts or schedule durable tasks          | [Loop Mode and Scheduled Tasks](guides/loop-mode.md)                    |
| Hear a sound or spoken alert when a run needs attention  | [Audio Notifications](guides/audio-notifications.md)                    |
| Keep scheduled work running across process or host exits | [Long-Running Operations](guides/long-running-operations.md)            |
| Choose local, cloud, hybrid, council, or arena execution | [Execution Modes](guides/modes.md)                                      |
| Connect external tools and data                          | [MCP Integrations](integrations/mcp.md)                                 |
| Let the agent read and act in Chrome through WebMCP      | [WebMCP browser bridge](guides/webmcp-bridge.md)                        |
| Embed AX Code in an application                          | [`@defai-digital/ax-code-sdk`](../packages/sdk/js/README.md)            |
| Generate a client for another language                   | [HTTP and OpenAPI Compatibility](sdk/http-openapi.md)                   |
| Build a desktop or native host                           | [Native SDK Transport](sdk/native-transport.md)                         |

## Getting started

- [Standard and Business](getting-started/editions.md) — open-source Standard, free commercial use, planned proprietary Business, and public-access status.

- [Why AX Code](why-ax-code.md) — what AX Code optimizes for, its intended audience, how it differs, and what it does
  not claim.
- [Start Here](getting-started/start-here.md) — product mental model and the shortest paths by use case.
- [Installation and Runtime Channels](getting-started/install-runtime.md) — supported platforms, packages, updates, and
  contributor launchers.

## Runtime guides

- [Fixed-context questions](guides/fixed-context-questions.md) — ask about selected files through AX Trust.
- [Goal assurance](guides/goal-assurance.md) — set completion criteria and run project checks.
- [Harness controls](guides/harness-controls.md) — configure runtime controls and verification.
- [Current-model reasoning](guides/current-model-reasoning.md) — use the active model for reasoning tools.
- [Terminal rendering](guides/terminal-rendering.md) — diagnose renderer and terminal behavior.

- [Wiki evidence visualization](guides/wiki-visualization.md) — open a local graph of recorded Wiki page/source relationships, or export offline HTML. Includes radial, force, and page-focus screenshots from AX Code's own wiki.
- [Conversation Recap](guides/conversation-recap.md) — catch up on recent work with `/recap` and configure idle banners.
- [Audio Notifications](guides/audio-notifications.md) — system sounds and opt-in spoken alerts when a run needs your attention.
- [Execution Evidence](guides/execution-evidence.md) — graph, compare, replay, risk, rollback, branch, trace, and
  audit export.
- [Verified Multi-Model Changes](guides/verified-multi-model-change.md) — the council and arena workflow end to end.
- [Sandbox Mode](guides/sandbox.md) — isolation modes, protected paths, network controls, and precedence.
- [Cloud Operations Mode](guides/cloud-operations.md) — plan/approve/apply workflow, approval tokens, and the `cloudops` agent posture.
- [Autonomous Mode](guides/autonomous.md) — unattended execution, approvals, headless use, and safeguards.
- [Headless CLI](guides/headless-cli.md) — the one-shot `ax-code run` command for scripting, CI, and agent callers.
- [TUI Languages and Setup](guides/tui-language-and-setup.md) — interface and conversation languages, first-time setup.
- [TUI Animations](guides/tui-animations.md) — opening and ending pairs, terminal capabilities, and rendering fallbacks.
- [Loop Mode and Scheduled Tasks](guides/loop-mode.md) — recurring prompts, durable schedules, and long-run limits.
- [Long-Running Operations](guides/long-running-operations.md) — supervised service examples, recovery semantics, and
  operational checks.
- [Execution Modes](guides/modes.md) — agent, hybrid, council, and arena behavior.
- [Multi-Model Routing Best Practices](guides/multi-model-routing.md) — split premium reasoning and lower-cost support
  work without silently weakening correctness-sensitive tasks.
- [Model recovery](guides/model-recovery.md) — exact model selection, explicit fallback configuration and diagnostics.
- [Auto-Route](guides/auto-route.md) — specialist routing and optional complexity routing.
- [Model Effort](guides/effort.md) — thinking levels and provider-specific behavior.
- [Performance](guides/performance.md) — coding tool profiles and local request-timing diagnostics.
- [AX TUI performance](guides/ax-tui-performance.md) — renderer workloads, CPU profiles, and native/WASM Unicode width evaluation.
- [Memory usage](guides/memory-usage.md) — memory profiles, cache retention, and background output limits.
- [Local Evidence Cache](guides/evidence-cache.md) — optional SQLite and RocksDB evidence reuse, qualification, and rollback.
- [Lifecycle Hooks](guides/hooks.md) — hook events and bundled policy packs.
- [Herdr State Reporting](guides/herdr.md) — map lifecycle hooks to herdr idle/working/blocked state.
- [Project Auto-Accept](guides/project-auto-accept.md) — opt-in approval mode and exactly what it can and cannot approve.
- [Run Report](guides/run-report.md) — workspace usage, activity, model/tool breakdowns, and per-session reports.

## Providers

- [Supported Providers and Models](providers/supported-providers.md) — provider IDs, credentials, and model discovery.
- [Free-Tier API Quickstart](providers/free-tier-apis.md) — compatible no-cost paths, constraints, and safe evaluation.
- [Custom and Gateway Providers](providers/custom-provider.md) — OpenAI- and Anthropic-compatible endpoints.
- [MTPLX and oMLX Setup](providers/local-mlx-runtimes.md) — source-checkout local presets, discovery, tools, and authentication.
- [AX Code Model Downloads](providers/ax-code-model-downloads.md) - reviewed HF collection revisions and verified R2 mirror availability.
- [AX Engine Model Selection](providers/ax-engine-model-selection.md) — local model ranking and memory guidance.

## Integrations

- [TUI MCP sharing](guides/tui-mcp.md) — opt-in navigation of a live terminal UI.
- [WebMCP browser bridge](guides/webmcp-bridge.md) — connect tools exposed by pages in Chrome.

- [MCP Integrations](integrations/mcp.md) — trust, permissions, resources, and server security.
- [ACP](integrations/acp.md) — the Agent Client Protocol happy path for IDE hosts.
- [AX Wiki](integrations/wiki.md) — source-backed repository knowledge and CI workflow.

## SDK and service boundaries

- [`@defai-digital/ax-code-sdk`](../packages/sdk/js/README.md) — first-party TypeScript and JavaScript embedding.
- [Native SDK Transport](sdk/native-transport.md) — gRPC-shaped desktop/native boundary and fallback behavior.
- [HTTP and OpenAPI Compatibility](sdk/http-openapi.md) — server mode and generated clients for other languages.
- [OpenAPI snapshot](../packages/sdk/openapi.json) — authoritative HTTP route and schema contract.

## Historical benchmarks

These reports record dated measurements and their test conditions. For current model support
and setup, see [AX Engine Model Selection](providers/ax-engine-model-selection.md).

- [Tiel versus MTPLX, 20 September 2026](benchmarks/tiel-peer-2026-09-20.md)
- [Tiel native prefill and decode, 19 September 2026](benchmarks/tiel-runtime-phases-2026-09-19.md)
- [Tiel MTP tuning profiles, 19 September 2026](benchmarks/tiel-mtp-profile-2026-09-19.md)
- [AX Code and OpenCode client retest, 19 September 2026](benchmarks/local-client-matrix-2026-09-19.md)
- [Local inference measurements, 19 September 2026](benchmarks/local-inference-results-2026-09-19.md)

## Architecture and reliability

- [Semantic Layer](architecture/semantic-layer.md) — graph and LSP provenance, audit, and replay boundaries.
- [Local Engine Architecture](architecture/local-engine.md) — why AX Code uses an AX Engine sidecar.
- [Runtime Stability](architecture/stability.md) — cancellation, crash, stream, timeout, and TUI reliability contracts.

## Reference

- [Configuration JSON Schema](reference/config.schema.json) — generated configuration input contract.

- [TypeScript Native Support](guides/typescript-native.md) — source compiler, language service, diagnostics, and compatibility.
- [Skill and Plugin Catalog](reference/skills-and-plugins.md) — bundled skills, project skills, plugins, and evals.
- [Isolation Policy Packs](policies/README.md) — machine-readable policy examples.
- [Release Verification](release/README.md) — canonical minisign public key and verification command.
- [Windows Runtime Integrity](guides/windows-runtime-integrity.md) — signatures, installed-file verification, and antivirus evidence.
- [Security Policy](../SECURITY.md) — threat model, credential storage, and supported versions.

## Documentation boundaries

Use `getting-started/` for onboarding, `guides/` for workflows, `providers/` for model
configuration, and `reference/` for contracts. Keep dated benchmark reports and their
supporting data together under `benchmarks/`. Keep local planning and analysis in
the ignored directories below.

| Content                                                              | Location                               |
| -------------------------------------------------------------------- | -------------------------------------- |
| Architecture decisions                                               | `.internal/adr/`                       |
| Product requirements and technical specifications                    | `.internal/prd/` and `.internal/spec/` |
| Roadmaps, implementation plans, release targets, reviews, and audits | `.internal/reports/`                   |
| Released behavior and public integration guidance                    | `docs/`                                |

Every public Markdown page should declare its status, scope, last-reviewed date, and owner near the top. Prefer links to
generated contracts or implementation sources over copied route lists and other high-drift snapshots.

## Maintenance checklist

Before a release or a substantial documentation change:

1. Verify commands, defaults, flags, provider IDs, and runtime labels against their implementation.
2. Update the narrowest authoritative guide instead of repeating the same behavior in several front-door pages.
3. Run `pnpm run test:scripts` to catch broken local links, orphaned pages, and missing page metadata.
4. Update the approved export manifest and run `node script/export-public-docs.mjs --website /path/to/ax-code.app`,
   then run the website check, build and Workers smoke checks. Website builds use the committed snapshot and do not
   require source access. New public pages and assets must be explicitly approved in the manifest.
5. Keep proposals, project-development notes, release targets, and historical decision records under `.internal/`,
   not in the public navigation.
