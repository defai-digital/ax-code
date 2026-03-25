# ax-code

The open source, provider-agnostic AI coding agent.

An AI coding agent by [DEFAI Digital](https://github.com/defai-digital).

---

## What is ax-code?

ax-code is a terminal-based AI coding assistant that works with **any LLM provider** — not locked to a single vendor. It features LSP integration, session persistence, MCP support, and a rich terminal UI.

### Key Features

- **Provider-agnostic** — OpenAI, Google Gemini, Grok, OpenRouter, Mistral, Groq, local models (Ollama, LM Studio)
- **LSP-first** — Real language server integration (Pyright, TypeScript, Go), not regex hacks
- **AX.md context system** — `/init` generates AI-optimized project context with depth levels
- **Self-correction** — Automatic failure detection, reflection, and retry
- **ReAct mode** — Structured Thought/Action/Observation reasoning
- **Planning system** — Task decomposition with dependency ordering and verification
- **Session persistence** — SQLite-backed, forkable, compactable sessions
- **MCP support** — Model Context Protocol with SSE/stdio/HTTP transports
- **25+ built-in tools** — File ops, search, bash, LSP, web fetch, tasks, todos
- **API key encryption** — AES-256-GCM encrypted key storage at rest
- **Grok server-side tools** — x_search, code_execution, parallel function calling

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3.11+
- An API key from any supported provider

### Install & Run

```bash
# Clone the repo
git clone https://github.com/defai-digital/ax-code.git
cd ax-code

# Install dependencies
bun install

# Set an API key (pick one)
export GOOGLE_GENERATIVE_AI_API_KEY="your-key"   # Google Gemini
export OPENAI_API_KEY="your-key"                  # OpenAI
export XAI_API_KEY="your-key"                     # Grok
export OPENROUTER_API_KEY="your-key"              # OpenRouter

# Run
bun run dev
```

### Windows (PowerShell)

```powershell
# Set API key
$env:GOOGLE_GENERATIVE_AI_API_KEY="your-key"

# Run
bun run dev
```

---

## Supported Providers

| Provider | Models | Setup |
|----------|--------|-------|
| **Google** | Gemini 2.5, 2.0 | `GOOGLE_GENERATIVE_AI_API_KEY` |
| **OpenAI** | GPT-4, GPT-4o, GPT-5 | `OPENAI_API_KEY` |
| **XAI/Grok** | Grok-4, Grok-3 | `XAI_API_KEY` |
| **OpenRouter** | 100+ models | `OPENROUTER_API_KEY` |
| **Google Vertex** | Gemini (cloud) | `GOOGLE_CLOUD_PROJECT` |
| **Mistral** | Mistral models | `MISTRAL_API_KEY` |
| **Groq** | Fast inference | `GROQ_API_KEY` |
| **GitHub Copilot** | Via Copilot API | OAuth login |
| **OpenAI-Compatible** | Ollama, LM Studio, vLLM | Config in `ax-code.json` |

### Using Local Models (LM Studio / Ollama)

Create `.ax-code/ax-code.json` in your project:

```json
{
  "provider": {
    "lmstudio": {
      "api": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:1234/v1",
      "models": {
        "*": true
      }
    }
  }
}
```

---

## Commands

```bash
ax-code                    # Launch TUI (default)
ax-code init               # Generate AX.md project context
ax-code init --depth full  # Deep analysis with code patterns
ax-code providers list     # List available providers
ax-code models             # List available models
ax-code run "message"      # Non-interactive mode
ax-code serve              # Headless API server
ax-code --help             # All commands
```

---

## Agents

Switch between agents in the TUI using **Tab**:

| Agent | Mode | Purpose |
|-------|------|---------|
| **build** | Primary | Default — full tool access for development |
| **plan** | Primary | Read-only analysis and planning |
| **react** | Primary | Structured Thought/Action/Observation reasoning |
| **general** | Subagent | Parallel multi-step task execution |
| **explore** | Subagent | Fast codebase search and analysis |

---

## Configuration

Create `ax-code.json` in your project root or `~/.config/ax-code/ax-code.json` for global config:

```json
{
  "provider": {
    "google": {
      "options": {
        "apiKey": "your-key"
      }
    }
  }
}
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `AX_CODE_CONFIG` | Custom config file path |
| `AX_CODE_CONFIG_DIR` | Custom config directory |
| `AX_CODE_DISABLE_MODELS_FETCH` | Disable model registry fetch |
| `AX_CODE_ENABLE_EXPERIMENTAL_MODELS` | Show experimental models |

---

## Project Structure

```
ax-code/
├── packages/
│   ├── ax-code/           # Core CLI application
│   │   └── src/
│   │       ├── agent/     # Agent system (build, plan, react)
│   │       ├── auth/      # Authentication + API key encryption
│   │       ├── cli/       # CLI commands and TUI
│   │       ├── config/    # Hierarchical config system
│   │       ├── context/   # AX.md context generation
│   │       ├── lsp/       # Language server integration
│   │       ├── mcp/       # Model Context Protocol
│   │       ├── planner/   # Task decomposition + verification
│   │       ├── provider/  # LLM provider abstraction
│   │       ├── session/   # Session persistence + correction
│   │       └── tool/      # 25+ built-in tools
│   ├── app/               # Shared UI components
│   ├── ui/                # UI component library
│   ├── plugin/            # Plugin system
│   ├── sdk/               # JavaScript SDK
│   └── util/              # Shared utilities
├── docs/                  # PRD, ADR, migration review
├── sdks/vscode/           # VSCode extension
└── patches/               # Dependency patches
```

---

## Built With

- **Runtime:** [Bun](https://bun.sh)
- **Language:** TypeScript
- **AI SDK:** [Vercel AI SDK](https://sdk.vercel.ai)
- **UI:** [SolidJS](https://solidjs.com) + opentui
- **Database:** SQLite ([Drizzle ORM](https://orm.drizzle.team))
- **Server:** [Hono](https://hono.dev)
- **Effects:** [Effect](https://effect.website)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

- Bug fixes welcome
- Feature PRs need design review
- Use conventional commits: `feat:`, `fix:`, `docs:`, `chore:`

---

## License

[MIT](LICENSE)

---

## Credits

ax-code is built by [DEFAI Digital](https://github.com/defai-digital).
