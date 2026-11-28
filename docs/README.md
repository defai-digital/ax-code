# AX Code Documentation

Status: Active
Scope: public, current-state
Last reviewed: 2026-11-28
Owner: AX Code maintainers

AX Code is an open-source coding agent for the terminal, SSH, and CI. New here? Follow
the four steps below, then use the task table or the section index to find a guide.

1. [Install the CLI](getting-started/install-runtime.md) (or the Desktop app).
2. [Connect a provider](getting-started/connect-provider.md).
3. [Choose a model](getting-started/select-model.md).
4. [Review your first change](getting-started/start-here.md).

Already installed? See [Upgrade and recovery](getting-started/upgrade.md).

## Find a guide by task

| I want to…                                             | Start here                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------- |
| Understand what AX Code is for                         | [Why AX Code](why-ax-code.md)                                         |
| Review, compare, replay, or undo what an agent did     | [Execution Evidence](guides/execution-evidence.md)                    |
| Get several models to attempt or review the same change | [Verified Multi-Model Changes](guides/verified-multi-model-change.md) |
| Restrict filesystem and network access                 | [Sandbox Mode](guides/sandbox.md)                                     |
| Run unattended or in CI                                | [Autonomous Mode](guides/autonomous.md)                               |
| Call `ax-code run` from scripts                        | [Headless CLI](guides/headless-cli.md)                                |
| Run recurring prompts or durable scheduled tasks       | [Loop Mode and Scheduled Tasks](guides/loop-mode.md)                  |
| Connect a hosted, CLI, custom, or local provider       | [Supported Providers and Models](providers/supported-providers.md)    |
| Run models locally on Apple Silicon                    | [AX Engine Model Selection](providers/ax-engine-model-selection.md)   |
| Try AX Code with a free-tier model API                 | [Free-Tier API Quickstart](providers/free-tier-apis.md)               |
| Fix a saved model that no longer resolves              | [Model Recovery](guides/model-recovery.md)                            |
| Connect external tools and data                        | [MCP Integrations](integrations/mcp.md)                               |
| Let the agent read and act in Chrome                   | [WebMCP Browser Bridge](guides/webmcp-bridge.md)                      |
| Embed AX Code in an application                        | [`@defai-digital/ax-code-sdk`](../packages/sdk/js/README.md)          |
| Build a source-backed project wiki                     | [AX Wiki Quickstart](getting-started/wiki-quickstart.md)              |

## Getting started

- [Start Here](getting-started/start-here.md) — product mental model and the shortest path for each use case.
- [Installation and Runtime Channels](getting-started/install-runtime.md) — platforms, installers, signature
  verification, and contributor launchers.
- [Connect a Provider](getting-started/connect-provider.md) — first provider connection in the TUI or CLI.
- [Choose and Change Models](getting-started/select-model.md) — select, switch, and pin models.
- [Upgrade and Recovery](getting-started/upgrade.md) — update channels, concurrent upgrades, and rollback.
- [AX Wiki Quickstart](getting-started/wiki-quickstart.md) — create and use your first project wiki.
- [Standard and Business](getting-started/editions.md) — open-source Standard and the planned Business offering.
- [Source Access and Public Distribution](getting-started/source-access.md) — source builds and the published SDK.
- [Why AX Code](why-ax-code.md) — what AX Code optimizes for, who it is for, and what it does not claim.

## Guides

### Review and verify agent work

- [Execution Evidence](guides/execution-evidence.md) — graph, compare, replay, risk, rollback, branch, trace, and
  audit export.
- [Verified Multi-Model Changes](guides/verified-multi-model-change.md) — the Council and Arena workflow end to end.
- [Goal Assurance](guides/goal-assurance.md) — completion criteria and project checks.
- [Run Report](guides/run-report.md) — workspace usage, activity, and per-session reports.
- [Conversation Recap](guides/conversation-recap.md) — catch up with `/recap` and idle banners.
- [Local Evidence Cache](guides/evidence-cache.md) — optional evidence reuse, qualification, and rollback.

### Safety, permissions, and policy

- [Sandbox Mode](guides/sandbox.md) — isolation modes, protected paths, network controls, and precedence.
- [Autonomous Mode](guides/autonomous.md) — unattended execution, approvals, and safeguards.
- [Project Auto-Accept](guides/project-auto-accept.md) — opt-in approval mode and its exact limits.
- [Cloud Operations Mode](guides/cloud-operations.md) — plan, approve, and apply workflow for infrastructure.
- [Lifecycle Hooks](guides/hooks.md) — hook events and bundled policy packs.
- [Herdr State Reporting](guides/herdr.md) — map lifecycle hooks to herdr idle, working, and blocked states.
- [Harness Controls](guides/harness-controls.md) — runtime controls and verification settings.
- [Isolation Policy Packs](policies/README.md) — machine-readable policy examples.
- [Windows Runtime Integrity](guides/windows-runtime-integrity.md) — signatures, installed-file verification, and
  antivirus evidence.

### Models, modes, and routing

- [Execution Modes](guides/modes.md) — agent, hybrid, Council, and Arena behavior.
- [Auto-Route](guides/auto-route.md) — specialist routing and optional complexity routing.
- [Multi-Model Routing Best Practices](guides/multi-model-routing.md) — split premium reasoning and lower-cost
  support work safely.
- [Model Effort](guides/effort.md) — thinking levels and provider-specific behavior.
- [Current-Model Reasoning](guides/current-model-reasoning.md) — use the active model for reasoning tools.
- [Fixed-Context Questions](guides/fixed-context-questions.md) — ask about selected files through AX Trust.
- [Model Recovery](guides/model-recovery.md) — diagnose model pins and configure retry targets.

### Automation and long-running work

- [Headless CLI](guides/headless-cli.md) — the one-shot `ax-code run` command for scripts, CI, and agent callers.
- [Loop Mode and Scheduled Tasks](guides/loop-mode.md) — recurring prompts, durable schedules, and limits.
- [Long-Running Operations](guides/long-running-operations.md) — supervised services, recovery, and operational
  checks.
- [Audio Notifications](guides/audio-notifications.md) — sounds and spoken alerts when a run needs attention.

### Terminal UI

- [TUI Languages and Setup](guides/tui-language-and-setup.md) — interface and conversation languages, first-time
  setup.
- [TUI Animations](guides/tui-animations.md) — opening and ending animations, capabilities, and fallbacks.
- [Terminal Rendering](guides/terminal-rendering.md) — diagnose renderer and terminal behavior.
- [TUI MCP Sharing](guides/tui-mcp.md) — opt-in navigation of a live terminal UI by another agent.

### Performance and diagnostics

- [Performance](guides/performance.md) — coding tool profiles and request-timing diagnostics.
- [Memory Usage](guides/memory-usage.md) — memory profiles, cache retention, and background output limits.
- [AX TUI Performance](guides/ax-tui-performance.md) — renderer workloads, CPU profiles, and Unicode width evaluation.
- [TypeScript Native Support](guides/typescript-native.md) — compiler, language service, and diagnostics.

## Providers and models

- [Supported Providers and Models](providers/supported-providers.md) — provider IDs, credentials, and model discovery.
- [Free-Tier API Quickstart](providers/free-tier-apis.md) — no-cost evaluation paths and their constraints.
- [Custom and Gateway Providers](providers/custom-provider.md) — OpenAI- and Anthropic-compatible endpoints.
- [Local Runtimes (MTPLX, oMLX, and others)](providers/local-mlx-runtimes.md) — local presets, discovery, tool
  support, and authentication.
- [AX Engine Model Selection](providers/ax-engine-model-selection.md) — managed local models and memory guidance.
- [AX Code Model Downloads](providers/ax-code-model-downloads.md) — reviewed model revisions and mirror availability.
- [Model Download Publication](providers/model-download-publication.md) — how download revisions are reviewed and
  published.

## Integrations

- [MCP Integrations](integrations/mcp.md) — trust, permissions, resources, and server security.
- [WebMCP Browser Bridge](guides/webmcp-bridge.md) — use tools exposed by pages in Chrome.
- [ACP](integrations/acp.md) — Agent Client Protocol setup for IDE hosts.
- [AX Wiki](integrations/wiki.md) — source-backed repository knowledge and CI workflow.
- [Wiki Evidence Visualization](guides/wiki-visualization.md) — graph Wiki page and source relationships, or export
  offline HTML.

## SDK and server

- [`@defai-digital/ax-code-sdk`](../packages/sdk/js/README.md) — first-party TypeScript and JavaScript embedding.
- [HTTP and OpenAPI Compatibility](sdk/http-openapi.md) — server mode and generated clients for other languages.
- [Native SDK Transport](sdk/native-transport.md) — gRPC-shaped desktop and native boundary.
- [OpenAPI snapshot](../packages/sdk/openapi.json) — authoritative HTTP route and schema contract.

## Architecture

- [Semantic Layer](architecture/semantic-layer.md) — graph and LSP provenance, audit, and replay boundaries.
- [Local Engine Architecture](architecture/local-engine.md) — why AX Code uses an AX Engine sidecar.
- [Runtime Stability](architecture/stability.md) — cancellation, crash, stream, timeout, and TUI reliability.

## Reference

- [Configuration JSON Schema](reference/config.schema.json) — generated configuration contract.
- [Skill and Plugin Catalog](reference/skills-and-plugins.md) — bundled skills, project skills, plugins, and evals.
- [Release Verification](release/README.md) — minisign public key, verification command, and release notes.
- [Release Rollback](release/rollback.md) — select and install a previous release.
- [Security Policy](../SECURITY.md) — threat model, credential storage, and supported versions.
- [Changelog](../CHANGELOG.md) — release history.

## Historical benchmarks

Dated measurements with their test conditions. They are not updated after publication; for current
model support, see [AX Engine Model Selection](providers/ax-engine-model-selection.md).

- [Tiel versus MTPLX, 20 September 2026](benchmarks/tiel-peer-2026-09-20.md)
- [Tiel native prefill and decode, 19 September 2026](benchmarks/tiel-runtime-phases-2026-09-19.md)
- [Tiel MTP tuning profiles, 19 September 2026](benchmarks/tiel-mtp-profile-2026-09-19.md)
- [AX Code and OpenCode client retest, 19 September 2026](benchmarks/local-client-matrix-2026-09-19.md)
- [Local inference measurements, 19 September 2026](benchmarks/local-inference-results-2026-09-19.md)

## Maintaining these docs

| Directory          | Contents                                        |
| ------------------ | ----------------------------------------------- |
| `getting-started/` | Onboarding: install, connect, first change      |
| `guides/`          | Task-oriented workflows                         |
| `providers/`       | Provider and model configuration                |
| `integrations/`    | MCP, ACP, Wiki, and other external surfaces     |
| `sdk/`             | Embedding and service boundaries                |
| `architecture/`    | Released design and reliability contracts       |
| `reference/`       | Generated contracts and catalogs                |
| `release/`         | Verification, rollback, and release notes       |
| `benchmarks/`      | Dated reports with their data under `data/`     |

`docs/` contains released behavior and public integration guidance only. Architecture decisions
(`.internal/adr/`), product requirements and specifications (`.internal/prd/`, `.internal/spec/`), and
roadmaps, plans, reviews, and audits (`.internal/reports/`) stay in the ignored `.internal/` tree.

Before a release or a substantial documentation change:

1. Verify commands, defaults, flags, provider IDs, and runtime labels against their implementation.
2. Update the narrowest authoritative guide instead of repeating the same behavior on several front-door pages.
   Prefer links to generated contracts over copied route lists and other high-drift snapshots.
3. Give every page `Status`, `Scope`, `Last reviewed`, and `Owner` lines near the top, and link it from this index.
4. Run `pnpm run test:scripts` to catch broken local links, orphaned pages, and missing page metadata.
5. Add new public pages and assets to `script/public-docs-manifest.json`, run
   `node script/export-public-docs.mjs --website /path/to/ax-code.app`, then run the website check, build, and
   Workers smoke checks. Website builds use the committed snapshot and do not require source access.
