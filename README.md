```
___________  __     _________________________________
___    |_  |/ /     __  ____/_  __ \__  __ \__  ____/
__  /| |_    /_______  /    _  / / /_  / / /_  __/
_  ___ |    |_/_____/ /___  / /_/ /_  /_/ /_  /___
/_/  |_/_/|_|       \____/  \____/ /_____/ /_____/
```

**AI coding runtime for teams that need control, auditability, and extensibility, not just code suggestions.**

AX Code is an AI execution runtime for software development. It combines agents, tool execution, provider routing, session state, and configurable isolation into one system that can run in the terminal, inside VS Code, through the SDK, or as a headless service.

- Controlled execution with configurable sandbox and permissions
- Provider flexibility across cloud and local model backends
- Persistent sessions, replay, and project context through `AGENTS.md`
- One runtime across TUI, CLI, SDK, VS Code, and server mode
- Extensible with MCP servers, plugins, and custom integrations

Built by [DEFAI Digital](https://github.com/defai-digital).

[![ax-code](https://github.com/defai-digital/ax-code/actions/workflows/ax-code-ci.yml/badge.svg)](https://github.com/defai-digital/ax-code/actions/workflows/ax-code-ci.yml)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/cTavsMgu)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Get Started in 60 Seconds

### Install

```bash
# macOS / Linux (Homebrew) — recommended
brew install defai-digital/ax-code/ax-code

# npm (any platform)
npm i -g @defai.digital/ax-code

# curl (Linux / macOS)
curl -fsSL https://github.com/defai-digital/ax-code/releases/latest/download/ax-code-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/').tar.gz | tar -xz -C /usr/local/bin
```

### Run

```bash
# Set any provider key (pick one)
export ANTHROPIC_API_KEY="your-key"              # Claude
export GOOGLE_GENERATIVE_AI_API_KEY="your-key"  # Gemini
export XAI_API_KEY="your-key"                    # Grok
export OPENAI_API_KEY="your-key"                 # GPT

# Launch
ax-code
```

That's it. No project setup or config file is required to get started. Run `ax-code`, then use `/connect` inside the TUI whenever you want to add or switch providers.

### Update

```bash
ax-code upgrade
brew upgrade ax-code
npm update -g @defai.digital/ax-code
```

### From Source (contributors)

```bash
git clone https://github.com/defai-digital/ax-code.git
cd ax-code && pnpm install && pnpm run setup:cli
```

Requires [pnpm](https://pnpm.io) v9.15.9+ and [Bun](https://bun.sh) v1.3.11+

`setup:cli` builds the current native bundled CLI and installs a launcher to it so the linked command matches npm/Homebrew behavior.
Use `pnpm run setup:cli -- --source` only when you explicitly want the live source/dev launcher.

---

## Why AX Code

Most AI coding tools optimize for a chat loop. AX Code is built as a runtime you can actually operate across repositories, teams, and integration surfaces.

- Use explicit tools instead of opaque background behavior.
- Put boundaries around execution with `full-access`, `workspace-write`, or `read-only`.
- Switch providers or move to local inference without changing the workflow.
- Resume, fork, compact, export, and audit sessions instead of losing work in a tab.
- Reuse the same runtime in the terminal, VS Code, CI jobs, or internal platforms.

AX Code is not just a chat UI. It is the runtime layer behind agent selection, tool orchestration, session persistence, and policy boundaries.

## When It Fits

AX Code is a strong fit when you need one or more of these:

- Large or messy repositories where uncontrolled tool use is risky
- Team workflows that need repeatability, reviewability, or policy boundaries
- Provider choice across hosted and local model backends
- Embeddable agent workflows through a TypeScript SDK or headless server
- Repository-specific context that can live with the code in `AGENTS.md`

## Use It Your Way

| Surface | Best for | Entry point |
| ------- | -------- | ----------- |
| TUI | Interactive repo work | `ax-code` |
| One-shot CLI | Quick tasks and scripts | `ax-code run "review the auth flow"` |
| Server mode | CI, bots, and internal platforms | `ax-code serve` |
| TypeScript SDK | Embedding ax-code in applications | [`packages/sdk/js/README.md`](packages/sdk/js/README.md) |
| VS Code | Editor-native workflow | [`packages/integration-vscode/README.md`](packages/integration-vscode/README.md) |

## Core Workflow

1. Connect a provider with environment variables or `ax-code providers login`.
2. Launch `ax-code` and use `/connect` if you want to switch models from the TUI.
3. Run `ax-code init` so `AGENTS.md` captures project-specific instructions and conventions.
4. Turn on sandboxing with `--sandbox workspace-write` or `/sandbox` when you want bounded execution.
5. Run `ax-code index` on larger repos for faster semantic and code-intelligence workflows.

## Documentation

- [Start Here](docs/start-here.md): understand what AX Code is, where the value comes from, and which docs to read next
- [Documentation Hub](docs/README.md): guides, architecture, specs, and reference docs
- [Sandbox Mode](docs/sandbox.md): isolation modes, protected paths, and network controls
- [Autonomous Mode](docs/autonomous.md): unattended execution behavior and safeguards
- [Auto-Route](docs/auto-route.md): LLM-assisted agent routing and model selection
- [Semantic Layer](docs/architecture/semantic-layer.md): provenance and replay boundaries for graph and LSP-backed answers

## Common Commands

```bash
ax-code
ax-code run "debug why the build is failing"
ax-code providers login
ax-code models
ax-code init
ax-code index
ax-code mcp add
ax-code serve
ax-code doctor
```

## Security and Operations

AX Code includes configurable isolation modes, protected paths for `.git` and `.ax-code` in sandboxed runs, encrypted provider and MCP credentials at rest, and localhost-only server defaults. See [SECURITY.md](SECURITY.md) for the threat model and [docs/sandbox.md](docs/sandbox.md) for isolation behavior and configuration.

## Project Notes

AX Code combines ideas from [ax-cli](https://github.com/defai-digital/ax-cli) and [OpenCode](https://github.com/anomalyco/opencode) into the developer-facing runtime of the broader AutomatosX ecosystem.

## Community

Report bugs, feature requests, and questions through [GitHub Issues](https://github.com/defai-digital/ax-code/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for the current contribution policy and [Discord](https://discord.gg/cTavsMgu) for community discussion.

## License

[MIT](LICENSE) — Copyright (c) 2025 [DEFAI Private Limited](https://github.com/defai-digital). Portions derived from [OpenCode](https://github.com/anomalyco/opencode), Copyright (c) 2025 opencode.
