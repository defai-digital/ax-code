<h1 align="center">AX Code</h1>

<p align="center"><strong>Inspect the run. Verify the change. Decide what stays.</strong></p>

AX Code is an open-source coding-agent runtime for reviewable, reversible work. Every session is recorded as a structured event log with file snapshots, so you can reconstruct what the agent did, compare two runs against each other, and roll back what you do not want. Candidate implementations can be built in isolated Git worktrees and ranked against your repository's own checks — nothing merges automatically.

Built by [DEFAI Digital](https://github.com/defai-digital).

[![Release v7.7.9](https://img.shields.io/badge/Release-v7.7.9-2F6FED)](https://github.com/defai-digital/ax-code/releases/tag/v7.7.9)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-000000?logo=apple&logoColor=white)](https://github.com/defai-digital/ax-code/releases)
[![Windows x64/ARM64](https://img.shields.io/badge/Windows-x64%20%2B%20ARM64-0078D4?logo=windows&logoColor=white)](https://github.com/defai-digital/ax-code/releases)
[![Ubuntu 24.04+ amd64/arm64](https://img.shields.io/badge/Ubuntu%2024.04%2B-amd64%20%2B%20arm64-E95420?logo=ubuntu&logoColor=white)](https://github.com/defai-digital/ax-code/releases)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/gf9UyPxaN2)

---

## The problem

Coding agents now write real code in real repositories. The gap is what happens after the agent says it is done: which files it touched, which decisions it made, whether the result passes your checks, how one attempt compared with another, and how to undo the specific step that went wrong.

Most agents give you a transcript. AX Code gives you an execution record.

## What that looks like

Every session is recorded while it runs. Afterwards you can compare two runs directly:

```console
$ ax-code compare ses_01H8XK ses_01H8XM

  Session Comparison
  ============================================================

  A: ses_01H8XK
     add rate limiting to the ingest API
     Risk: HIGH (53/100) — 8 files changed, rewrite, cross-module change

  B: ses_01H8XM
     add rate limiting to the ingest API (second attempt)
     Risk: CRITICAL (93/100) — 25 files changed, rewrite, security-related files,
                               cross-module change, 15 tool failures

  Risk Comparison
  ----------------------------------------
  Score: 53 → 93 (+40) ↑
  Level: HIGH → CRITICAL
  Files: 8 → 25
  Failures: 0 → 15

  Event Summary
  ----------------------------------------
  tool.call: 12 → 127
  step.finish: 6 → 90
  Total: 69 → 817
```

Or reconstruct a single run step by step, with timings:

```console
$ ax-code graph ses_01H8XK

## Session ses_01H8XK

Duration: 9m 54s | Risk: HIGH (53/100) | Tokens: 167,650 in / 18,494 out
Agents: architect

### Step 1 (8s) | tokens: 12263/587

- read: api.ts → ok (5ms)
- grep: rateLimit → ok (12ms)

### Step 2 (4m 42s) | tokens: 12327/3626

- task: explore rate limiter call sites → ok (215021ms)
```

The output format above is verbatim from these commands; the session IDs and task names are illustrative. The risk score is a deterministic heuristic computed from signals including churn, validation state, tool failures, touched paths, affected API surface, control-plane outcomes, and security-sensitive file patterns — it is a review aid, not a probability, a confidence measure, or a security assurance.

## What you get

**Inspect what the agent did.** `ax-code graph` reconstructs the session as an execution graph with per-step tool calls and timings. `ax-code compare` diffs two runs by risk, decision path, and event counts. `ax-code trace` produces replay-backed diagnostics. The evidence exports out of AX Code as JSONL (`ax-code audit export`), a Markdown report (`ax-code audit report`), or OpenTelemetry spans (`ax-code audit otlp`).

**Undo precisely.** File changes are snapshotted to an out-of-tree Git object store during the run. `ax-code rollback <session> --list` shows recoverable points; `--step N` restores a specific one. Rollback depends on a usable snapshot, so it has real boundaries — see [Execution Evidence](docs/guides/execution-evidence.md).

**Verify competing implementations.** In arena implement mode, each contestant gets an isolated worktree from the same clean base commit, its patch is snapshotted to a branch, your repository's typecheck/lint/test commands run, and candidates that verify rank above candidates that do not. AX Code does not merge the winner for you.

**Understand impact before editing.** With the code-intelligence graph built (`ax-code index`), the agent can compute the blast radius of a proposed change — transitive callers, API boundaries hit, and a bounded risk score — deterministically, with no model call and no file reads.

**Keep repository knowledge durable.** `ax-code wiki` compiles a source-backed wiki: deterministic page planning, source-hash change detection, protected manual sections, atomic writes, and lint checks including dead links. Page prose is model-generated from cited source; the planning, validation, and incremental-update framework around it is deterministic.

## Get started

### macOS (Apple Silicon)

```bash
curl -fsSL -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/defai-digital/ax-code/contents/install?ref=main" | bash
```

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"
```

### Ubuntu 24.04+

```bash
curl -fsSL -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/defai-digital/ax-code/contents/install?ref=main" | bash
```

On macOS, Homebrew remains available as an alternative: `brew install defai-digital/tap/ax-code`.

Then:

```bash
ax-code                  # open the terminal UI
```

Connect a provider from the Desktop onboarding flow, with `/connect` in the terminal UI, or with `ax-code providers login`. No project setup or config file is required.

Release archives are verified with minisign. Platform support, update paths, signature verification, contributor source builds, and troubleshooting live in [Installation and Runtime Channels](docs/getting-started/install-runtime.md).

## When AX Code fits

**Good fit:** consequential changes in Git repositories where the change has to be reviewed — refactors, migrations, cross-module fixes, security-sensitive edits; unattended or scheduled runs whose output someone must audit afterwards; teams that want model choice without handing the review record to a single hosted product.

**Poor fit:** inline autocomplete; a single quick disposable edit; fully managed cloud delegation; workflows where you will not use Git or run repository checks. A lighter editor assistant is the better tool for those.

## Surfaces

The same runtime, session store, and evidence model back every surface.

| Surface              | Entry point                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Desktop app          | AX Code Desktop for macOS, Windows, and Ubuntu 24.04+, from [`desktop/`](desktop/)                     |
| Terminal UI          | `ax-code` — provider, model, agent, session, MCP, and skill flows                                      |
| One-shot / headless  | `ax-code run "review the auth flow"` for scripts, CI, and bots                                         |
| Local service        | `ax-code serve` exposes the runtime over a local HTTP API and OpenAPI contract                         |
| TypeScript embedding | `@ax-code/sdk` provides `createAgent()`, streaming events, sessions, and custom tools                  |
| VS Code              | The [VS Code extension](https://marketplace.visualstudio.com/items?itemName=AutomatosX.ax-code-vscode) |

## Control model

AX Code starts with autonomous mode on and the sandbox off (`full-access`) by default: filesystem writes and network access are unrestricted. This favors a low-friction local CLI experience for trusted projects; enable `workspace-write` or `read-only` before opening untrusted code or running unattended work.

- Enable or change isolation with `/sandbox`, or `--sandbox read-only | workspace-write | full-access`.
- Use `/autonomous` or `AX_CODE_AUTONOMOUS=false` to stop for each permission and question.
- Control external tool surfaces with `ax-code mcp list --tools`, `ax-code mcp trust`, and permission rules.
- Provider and MCP credentials are encrypted at rest; server mode is localhost-only by default.

Verification gates apply where they are enforceable: arena candidates and gated refactor application run your checks before a result is accepted. Ordinary interactive edits are not automatically verified — run `verify_project` or your own commands for those.

See [Sandbox Mode](docs/guides/sandbox.md), [Autonomous Mode](docs/guides/autonomous.md), [MCP Integrations](docs/integrations/mcp.md), and [SECURITY.md](SECURITY.md).

## Providers and models

| Family                   | Providers                                                                                                  | Model source                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Cloud API providers      | Google, GroqCloud, OpenRouter, Hugging Face, UnoRouter, Alibaba plans, MiniMax plans, GitHub Copilot, Z.AI | Hosted provider model catalogs bundled with AX Code               |
| CLI providers            | Claude Code, Codex CLI, Grok Build CLI, Kimi Code CLI                                                      | One model ID per CLI bridge, reusing the local vendor CLI session |
| AX Engine local provider | `ax-engine` on eligible Apple Silicon Macs                                                                 | Curated AXQ 6-bit MLX models served from the live catalog         |

CLI bridges reuse a local vendor CLI and its login session. AX Code records its own tool execution in full; activity that happens inside a vendor CLI process is visible only through that bridge's output.

See [Supported Providers and Models](docs/providers/supported-providers.md) for provider IDs and credentials, [Free-Tier API Quickstart](docs/providers/free-tier-apis.md) to evaluate without buying credits, and [AX Engine Model Selection](docs/providers/ax-engine-model-selection.md) for local inference.

## Commands

Evidence and review:

| Command                      | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `ax-code graph <session>`    | Reconstruct a session as an execution graph         |
| `ax-code compare <a> <b>`    | Compare two runs by risk, decision path, and events |
| `ax-code replay <session>`   | Inspect and reconstruct the recorded event log      |
| `ax-code risk <session>`     | Explainable risk signals and mitigations for a run  |
| `ax-code rollback <session>` | List and restore snapshot points from a run         |
| `ax-code branch <session>`   | Fork session state to try a different strategy      |
| `ax-code trace <session>`    | Replay-backed diagnostics and timeline              |
| `ax-code audit export`       | Export run evidence as JSON Lines                   |
| `ax-code audit report`       | Generate a Markdown audit report for a run          |
| `ax-code audit otlp`         | Export a run as OpenTelemetry trace spans           |
| `ax-code dre-graph`          | Open the local run-report dashboard in a browser    |

Everyday use:

| Command                   | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `ax-code`                 | Open the interactive terminal UI                                |
| `ax-code run "<task>"`    | Run a one-shot headless task                                    |
| `ax-code init`            | Create or update repository `AGENTS.md` (`--wiki` adds AX Wiki) |
| `ax-code index`           | Build the code-intelligence graph                               |
| `ax-code wiki`            | Plan, generate, update, or lint the AX Wiki                     |
| `ax-code providers login` | Configure provider credentials                                  |
| `ax-code models`          | List available provider/model IDs                               |
| `ax-code mcp add`         | Add a local or remote MCP server                                |
| `ax-code agent create`    | Generate a custom project or global agent                       |
| `ax-code serve`           | Start the local HTTP/OpenAPI server                             |
| `ax-code doctor`          | Diagnose install, runtime, storage, and auth                    |

`ax-code --help` lists the full command set.

## Documentation

- [Why AX Code](docs/why-ax-code.md) — what it optimizes for, who it is for, and how it differs from other agents
- [Start Here](docs/getting-started/start-here.md) — product mental model and shortest paths by use case
- [Execution Evidence](docs/guides/execution-evidence.md) — graph, replay, compare, risk, rollback, trace, and audit export
- [Verified Multi-Model Changes](docs/guides/verified-multi-model-change.md) — council review and arena implementation
- [Documentation Hub](docs/README.md) — guides, architecture, providers, and reference
- [Sandbox Mode](docs/guides/sandbox.md) · [Autonomous Mode](docs/guides/autonomous.md) · [MCP Integrations](docs/integrations/mcp.md)
- [Semantic Layer](docs/architecture/semantic-layer.md) — provenance and replay boundaries for graph and LSP answers
- [AX Wiki](docs/integrations/wiki.md) · [Stability](docs/architecture/stability.md)

## Community

Report bugs, feature requests, and questions through [GitHub Issues](https://github.com/defai-digital/ax-code/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for the current contribution policy and [Discord](https://discord.gg/gf9UyPxaN2) for community discussion.

## Provenance

AX Code began on the MIT-licensed [OpenCode](https://github.com/anomalyco/opencode) codebase, and that attribution is preserved here and in [NOTICE](NOTICE). DEFAI's independent work since then is what this README describes: the execution-evidence layer (event log, snapshots, replay reconstruction, run comparison, risk scoring, audit export), the deterministic debug and refactor engine with shadow-worktree verification, the code-intelligence graph and impact analysis, council and arena execution modes, the AX Wiki compiler, OS-level sandboxing, and AX Code Desktop.

The repository also includes code with upstream history from these MIT-licensed projects:

- [OpenCode](https://github.com/anomalyco/opencode): the CLI, runtime, session, provider, and tool foundations. See [NOTICE](NOTICE).
- [OpenChamber](https://github.com/btriapitsyn/openchamber): AX Code Desktop includes derived code. See [desktop/NOTICE](desktop/NOTICE).
- [OpenTUI](https://github.com/anomalyco/opentui): the renderer snapshot underlying AX Code TUI. AX Code owns the `@ax-code/tui` package, integration, patches, and release process.
- [ax-cli](https://github.com/defai-digital/ax-cli): selected AX/CLI capabilities ported from DEFAI's earlier project. See [NOTICE](NOTICE).

These notices preserve license provenance and upstream credit. They do not mean the upstream projects maintain AX Code or current DEFAI modifications.

## License

AX Code is licensed under the [Apache License, Version 2.0](LICENSE) — Copyright (c) 2025 [DEFAI Private Limited](https://github.com/defai-digital).

Portions derived from MIT-licensed projects (notably OpenCode) remain under the [MIT License](LICENSE-MIT). The AX Code TUI package at `packages/ax-code-tui` retains the MIT license and attribution of its upstream renderer lineage. See [NOTICE](NOTICE), [LICENSE-MIT](LICENSE-MIT), [desktop/NOTICE](desktop/NOTICE), and the provenance section above.
