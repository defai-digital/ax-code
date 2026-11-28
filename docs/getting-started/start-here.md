# Start Here

Status: Active
Scope: current-state
Last reviewed: 2026-11-28
Owner: ax-code runtime

This page explains what AX Code is, how to get from installation to your first reviewed change, and where to go
next for your use case.

## What AX Code is

AX Code is an AI coding runtime. It combines agents for different coding tasks, explicit tool execution, model and
provider choice, persistent sessions, configurable isolation and permissions, and integration surfaces such as the
TUI, headless CLI, SDK, server mode, and MCP.

AX Code optimizes the moment _after_ the agent finishes: deciding whether to keep what it produced.

- **Evidence.** Every session is recorded as a typed event log plus file snapshots, so `ax-code graph`, `compare`,
  `replay`, `risk`, and `audit` can reconstruct what happened after the conversation ends.
- **Verification.** Where a gate is enforceable — Arena candidates, gated refactor application — your repository's
  own typecheck, lint, and test commands decide whether a result is accepted.
- **Reversibility.** Snapshots are recoverable per step, not only per session, from a Git object store kept outside
  your repository.
- **Your decision.** AX Code ranks, scores, and reports. It does not merge for you.

See [Why AX Code](../why-ax-code.md) for positioning and explicit non-claims, and
[Execution Evidence](../guides/execution-evidence.md) for the commands.

## Your first session

1. **Install.** Choose an interface and follow the [installation guide](install-runtime.md):
   - **CLI** for the terminal UI, SSH, scripts, and CI. Use the native installer for your operating system; npm is
     not a supported installation channel.
   - **Desktop app** for a graphical workspace. It bundles a pinned runtime, so a separate CLI or Node.js install is
     not required. Desktop and the CLI update independently.
2. **Start.** Open a terminal in your project and run `ax-code`.
3. **Connect a model.** Use `/connect` or `ax-code providers login`, then pick a model with `/model`. See
   [Connect a Provider](connect-provider.md) and [Choose and Change Models](select-model.md). For a no-cost
   evaluation, use the [Free-Tier API Quickstart](../providers/free-tier-apis.md).
4. **Record conventions.** Run `ax-code init` so `AGENTS.md` captures your repository's conventions.
5. **Make one small change.** Ask the agent for a focused edit, run your project checks, and review the diff before
   committing.

Run `ax-code doctor` if anything in the installation or model configuration looks wrong. Already installed? Read
[Upgrade and Recovery](upgrade.md).

## Common commands

```bash
ax-code                                   # start the TUI in the current project
ax-code providers login                   # connect a provider from the shell
ax-code models [provider]                 # list available model IDs
ax-code run -m <provider/model> "Review this change"   # one-shot headless run
ax-code init                              # create or update AGENTS.md
ax-code index                             # build the code intelligence index
ax-code mcp add                           # add an MCP server
ax-code doctor                            # diagnose the installation
```

## Mental model

Think of AX Code as five layers. The rest of the documentation maps onto them.

| Layer    | What you control                                         | Read                                                                  |
| -------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Provider | Which model backend runs the work                        | [Supported Providers and Models](../providers/supported-providers.md) |
| Agent    | Which agent or execution mode handles the task           | [Execution Modes](../guides/modes.md), [Auto-Route](../guides/auto-route.md) |
| Tool     | The explicit tools the agent can call                    | [MCP Integrations](../integrations/mcp.md)                            |
| Session  | The persisted conversation, decisions, and snapshots     | [Execution Evidence](../guides/execution-evidence.md)                 |
| Control  | Isolation, permissions, hooks, and audit                 | [Sandbox Mode](../guides/sandbox.md), [Lifecycle Hooks](../guides/hooks.md) |

## Choose the next path

### Use it safely in a team or company repository

- AX Code starts with autonomous mode on and sandbox mode off: `full-access` with unrestricted filesystem and network
  access.
- For team, company, untrusted, or unattended work, start with `--sandbox workspace-write` (or `read-only`).
- Read [Sandbox Mode](../guides/sandbox.md), [Autonomous Mode](../guides/autonomous.md), and the
  [Security Policy](../../SECURITY.md).
- Read [Semantic Layer](../architecture/semantic-layer.md) if provenance and replay matter for your workflow.

### Compare models or get a second opinion

- Read [Verified Multi-Model Changes](../guides/verified-multi-model-change.md) for Council reviews and Arena
  candidates ranked by your project's checks.
- Read [Multi-Model Routing Best Practices](../guides/multi-model-routing.md) before splitting work across model
  tiers.

### Run models locally

- On Apple Silicon, follow [AX Engine Model Selection](../providers/ax-engine-model-selection.md) for managed local
  inference.
- For Ollama, LM Studio, MTPLX, oMLX, or another OpenAI-compatible server, see
  [Local Runtimes](../providers/local-mlx-runtimes.md).

### Automate or embed it

- Use the [Headless CLI](../guides/headless-cli.md) for scripts and CI, and
  [Loop Mode and Scheduled Tasks](../guides/loop-mode.md) for recurring work.
- Use [`@defai-digital/ax-code-sdk`](../../packages/sdk/js/README.md) to embed the runtime in a TypeScript
  application.
- Use [HTTP and OpenAPI Compatibility](../sdk/http-openapi.md) for a service boundary and generated clients.

### Understand editions and licensing

**AX Code Standard** is the open-source edition and is free for personal and commercial use. **Business** is a
planned proprietary offering for organization governance through AX Trust and business workflows through
AutomatosX. Using Standard at work does not require a Business license. See [Standard and Business](editions.md).

## When AX Code may not fit

AX Code may be more than you need if:

- You only want inline code suggestions and do not want agents executing tools.
- You need a hosted, SaaS-only experience with no local runtime.
- You do not need session persistence, replay, SDK or server integration, or repository-level instructions.
- Your environment does not allow a local CLI process.

In those cases a lighter editor assistant may be simpler. AX Code is strongest when an agent must work inside real
development workflows with control, continuity, and clear integration boundaries.

For everything else, browse the [documentation index](../README.md).
