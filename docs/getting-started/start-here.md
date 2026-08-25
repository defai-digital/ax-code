# Start Here

Status: Active
Scope: current-state
Last reviewed: 2026-08-21
Owner: ax-code runtime

If the root [README](../../README.md) is the fastest way to install AX Code, this page is the fastest way to understand it.

## What AX Code Is

AX Code is an AI coding runtime. It combines:

- agents for different coding tasks
- explicit tool execution
- model and provider selection
- persistent session state
- configurable isolation and permissions
- integration surfaces such as the TUI, SDK, server mode, and MCP

That matters because AI coding is only useful in real repositories when you can control what the agent is allowed to do, preserve context across sessions, and reuse the same workflow outside a single chat window.

## Where the Value Comes From

AX Code optimizes the moment _after_ the agent finishes: deciding whether to keep what it produced.

- **Evidence.** Every session is recorded as a typed event log plus file snapshots, so `ax-code graph`, `compare`, `replay`, `risk`, and `audit` can reconstruct what happened after the conversation ends.
- **Verification.** Where a gate is enforceable — arena candidates, gated refactor application — your repository's own typecheck, lint, and test commands decide whether a result is accepted.
- **Reversibility.** Snapshots are recoverable per step, not only per session, from a Git object store kept outside your repository.
- **Your decision.** AX Code ranks, scores, and reports. It does not merge for you.

Supporting these: explicit tools with permission rules and isolation modes, durable sessions, `AGENTS.md` for repository conventions, provider portability, and one runtime behind the TUI, CLI, VS Code extension, SDK, headless server, and MCP integrations. Those are foundations rather than the reason to choose AX Code — see [Why AX Code](../why-ax-code.md).

For the commands themselves, see [Execution Evidence](../guides/execution-evidence.md).

## Mental Model

Think of AX Code as five layers:

1. Provider layer: choose the model backend you want to run against.
2. Agent layer: pick the right agent for the task, or let routing help.
3. Tool layer: the agent acts through explicit tools rather than hidden capabilities.
4. Session layer: the conversation, decisions, and state persist.
5. Control layer: isolation, permissions, and audit behavior define the boundary.

The rest of the documentation maps onto those layers.

## Choose the Next Path

### I want to try it quickly

- Start with the [root README](../../README.md) for install and first launch.
- Supported install paths use the compiled runtime:
  - Bash release installer for macOS Apple Silicon and Linux: `curl -fsSL -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/defai-digital/ax-code/contents/install?ref=main" | bash`
  - Homebrew alternative for macOS CLI:
    `brew tap defai-digital/tap && brew trust defai-digital/tap && brew install defai-digital/tap/ax-code`
  - GitHub release installer for Windows PowerShell: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"`
- The Bash installer is not the canonical Windows setup path.
- npm packages are no longer supported install or upgrade channels. See [Installation and Runtime Channels](install-runtime.md) for platform policy, runtime labels, and the local launcher matrix.
- Use `/connect` or `ax-code providers login` to set a model. See [Supported Providers and Models](../providers/supported-providers.md) for Cloud API providers, CLI providers, AX Engine, and model IDs. For a no-cost evaluation path, use the [Free-Tier API Quickstart](../providers/free-tier-apis.md).
- Run `ax-code init` after opening a real project so `AGENTS.md` captures local conventions.
- If you want tighter safety boundaries, enable [Sandbox Mode](../guides/sandbox.md) before broader edits.

### I want to use it safely in a team or company repo

- AX Code starts with autonomous mode on and sandbox mode off: `full-access` with unrestricted filesystem and network access.
- For team, company, untrusted, or unattended work, enable `--sandbox workspace-write` (or `read-only`) before starting the task.
- Read [Sandbox Mode](../guides/sandbox.md) for execution boundaries.
- Read [Autonomous Mode](../guides/autonomous.md) if the agent will run unattended.
- Read [Security Policy](../../SECURITY.md) for threat model and credential storage details.
- Read [Semantic Layer](../architecture/semantic-layer.md) if provenance and replay matter for your workflow.

### I want to embed or automate it

- Use [`@ax-code/sdk`](../../packages/sdk/js/README.md) for in-process TypeScript integration.
- Use [HTTP and OpenAPI Compatibility](../sdk/http-openapi.md) for a service boundary, generated clients, and the authoritative OpenAPI contract.
- Use `ax-code mcp add` when the agent needs external tools or services.

### I want to understand the repo or contribute feedback

- Read the [Documentation Hub](../README.md) for the rest of the public docs.
- Read [CONTRIBUTING.md](../../CONTRIBUTING.md) for the current external contribution policy.

## When AX Code May Not Fit

AX Code is intentionally more than autocomplete or a hosted chat box. It may be too much if:

- You only need inline code suggestions and do not want agents executing tools.
- You need a hosted SaaS-only experience with no local runtime.
- You do not need session persistence, replay, SDK/server integration, or repository-level instructions.
- You are working in an environment where no local CLI process is allowed.

In those cases, a lighter editor assistant may be simpler. AX Code is strongest when the agent needs to operate inside real development workflows with control, continuity, and integration boundaries.

## Common First Commands

```bash
ax-code
ax-code providers login
ax-code init
ax-code index
ax-code mcp add
ax-code doctor
```

Grok runs exclusively through `Grok Build CLI`. Select `grok-build-cli` in `/connect`; AX Code invokes the local `grok` command and reuses its CLI login/session. The former direct `xai` cloud API provider is no longer supported.

## Doc Map

| Topic                    | Start here                                                                                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why choose AX Code       | [Why AX Code](../why-ax-code.md)                                                                                                                                  |
| Product overview         | [Start Here](start-here.md)                                                                                                                                       |
| Review / undo agent work | [Execution Evidence](../guides/execution-evidence.md)                                                                                                             |
| Multi-model changes      | [Verified Multi-Model Changes](../guides/verified-multi-model-change.md)                                                                                          |
| Install/runtime channels | [Installation and Runtime Channels](install-runtime.md)                                                                                                           |
| Providers and models     | [Supported Providers and Models](../providers/supported-providers.md)                                                                                             |
| Free-tier API evaluation | [Free-Tier API Quickstart](../providers/free-tier-apis.md)                                                                                                        |
| Sandbox and permissions  | [Sandbox Mode](../guides/sandbox.md)                                                                                                                              |
| Unattended execution     | [Autonomous Mode](../guides/autonomous.md)                                                                                                                        |
| Routing and model tier   | [Auto-Route](../guides/auto-route.md)                                                                                                                             |
| SDK embedding            | [`@ax-code/sdk`](../../packages/sdk/js/README.md)                                                                                                                 |
| HTTP/OpenAPI clients     | [HTTP and OpenAPI Compatibility](../sdk/http-openapi.md)                                                                                                          |
| VS Code integration      | [VS Code integration](../../packages/integration-vscode/README.md) · [Marketplace](https://marketplace.visualstudio.com/items?itemName=AutomatosX.ax-code-vscode) |
| Architecture             | [Semantic Layer](../architecture/semantic-layer.md)                                                                                                               |
