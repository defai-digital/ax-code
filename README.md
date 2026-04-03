# ax-code

The open source, provider-agnostic AI coding agent.

An AI coding agent by [DEFAI Digital](https://github.com/defai-digital).

---

## What is ax-code?

ax-code is a terminal-based AI coding assistant that works with **any LLM provider** — not locked to a single vendor. It features LSP integration, session persistence, MCP support, a rich terminal UI, and a programmatic SDK for building custom AI apps.

### Key Features

- **Provider-agnostic** — Google Gemini, xAI Grok, Groq, Z.AI (GLM), local models (Ollama, LM Studio, vLLM)
- **Programmatic SDK** — Direct agent instantiation without HTTP server (`createAgent()` → `agent.run()`)
- **Specialized AI agents** — Security auditor, architecture analyst, debugger, performance profiler — auto-selected based on your prompt
- **Agent auto-routing** — Automatically switches to the best agent for each task with toast notifications
- **LSP-first** — Real language server integration (Pyright, TypeScript, Go), not regex hacks
- **AX.md context system** — `/init` generates AI-optimized project context with depth levels
- **Memory warmup** — Pre-cache project context for faster, more accurate AI responses
- **Self-correction** — Automatic failure detection, reflection, and retry
- **ReAct mode** — Structured Thought/Action/Observation reasoning
- **Planning system** — Task decomposition with dependency ordering and verification
- **Session persistence** — SQLite-backed, forkable, compactable sessions
- **MCP support** — Model Context Protocol with SSE/stdio/HTTP transports, auto-discovery, and 16 pre-configured templates
- **Design check** — Scan CSS/React code for hardcoded colors, spacing, accessibility violations
- **i18n** — 11 languages (English, Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Thai, Vietnamese)
- **Context stats** — Token usage breakdown, cost estimation, context window monitoring
- **25+ built-in tools** — File ops, search, bash, LSP, web fetch, tasks, todos
- **API key encryption** — AES-256-GCM encrypted key storage at rest
- **Grok server-side tools** — x_search, code_execution, parallel function calling

---

## Quick Start

### Prerequisites

- [pnpm](https://pnpm.io) v9.15.9+
- [Bun](https://bun.sh) v1.3.11+
- An API key from any supported provider

### Install & Run

```bash
# Clone the repo
git clone https://github.com/defai-digital/ax-code.git
cd ax-code

# Install dependencies with pnpm
pnpm install

# Set up the global `ax-code` command
pnpm run setup:cli

# Set an API key (pick one)
export GOOGLE_GENERATIVE_AI_API_KEY="your-key"   # Google Gemini
export XAI_API_KEY="your-key"                     # Grok
export GROQ_API_KEY="your-key"                    # Groq (free)

# Run
ax-code                # Global command (after setup:cli)
pnpm run dev           # Direct from repo root (uses Bun runtime)
```

### Windows (PowerShell)

```powershell
# Set API key
$env:XAI_API_KEY="your-key"

# Set up global command
pnpm run setup:cli

# Run
ax-code
```

---

## Supported Providers

| Provider | Models | Setup |
|----------|--------|-------|
| **Google Gemini** | Gemini 1.5, 2.0, 2.5, 3.0, 3.1 | `GOOGLE_GENERATIVE_AI_API_KEY` |
| **xAI/Grok** | Grok-2, Grok-3, Grok-4 | `XAI_API_KEY` |
| **Groq** | Llama 4, Llama 3.3, Qwen, Gemma, DeepSeek | `GROQ_API_KEY` (free) |
| **Z.AI** | GLM-4.6, GLM-4.7, Kimi | `ax-code providers login` |
| **Local models** | Ollama, LM Studio, vLLM, any OpenAI-compatible | Config in `ax-code.json` |

### Using Local Models (Ollama / LM Studio)

Create `ax-code.json` in your project root:

```json
{
  "provider": {
    "ollama": {
      "api": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:11434/v1",
      "models": {
        "*": true
      }
    }
  }
}
```

---

## Commands

### Core
```bash
ax-code                          # Launch TUI (default)
ax-code run "message"            # Non-interactive mode
ax-code serve                    # Headless API server
ax-code --help                   # All commands
```

### Providers & Models
```bash
ax-code providers list           # List available providers
ax-code providers login          # Add provider credential (interactive)
ax-code providers login groq     # Quick API key setup for specific provider
ax-code providers logout         # Remove a credential
ax-code models                   # List all available models
```

### Project Context
```bash
ax-code init                     # Generate AX.md project context
ax-code init --depth full        # Deep analysis with code patterns
ax-code memory warmup            # Pre-cache project context for AI
ax-code memory warmup --dry-run  # Preview without saving
ax-code memory warmup --max-tokens 2000  # Limit context size
ax-code memory status            # Show cached memory info
ax-code memory clear             # Delete cached memory
```

### MCP Servers
```bash
ax-code mcp list                 # List configured MCP servers
ax-code mcp list --discover      # Detect available servers
ax-code mcp add                  # Add server (from template or custom)
ax-code mcp auth <name>          # Authenticate OAuth server
ax-code mcp debug <name>         # Debug connection issues
```

### Analysis
```bash
ax-code design-check src/        # Scan for design violations
ax-code design-check src/ --rule no-inline-styles=off  # Disable a rule
ax-code context                  # Show context window usage + cost
ax-code context <sessionID>      # Show stats for specific session
ax-code stats                    # Show token usage statistics
```

### Sessions
```bash
ax-code session list             # List all sessions
ax-code export <sessionID>       # Export session as JSON
ax-code import <file>            # Import session from JSON
```

---

## Agents

Switch between agents in the TUI using **Tab**, or let auto-routing pick the best agent for your task:

| Agent | Mode | Purpose | Auto-routes on |
|-------|------|---------|----------------|
| **build** | Primary | Default — full tool access for development | (default) |
| **security** | Primary | Scans for vulnerabilities, secrets, OWASP issues | "scan for vulnerabilities", "security audit" |
| **architect** | Primary | Analyzes system design, dependencies, coupling | "analyze architecture", "project structure" |
| **debug** | Primary | Investigates bugs, traces root cause, fixes issues | "debug this", "why is it crashing" |
| **perf** | Primary | Finds bottlenecks, memory issues, optimizations | "performance", "slow", "optimize" |
| **plan** | Primary | Read-only analysis and planning | Manual switch only |
| **react** | Primary | Structured Thought/Action/Observation reasoning | Manual switch only |
| **general** | Subagent | Parallel multi-step task execution | — |
| **explore** | Subagent | Fast codebase search and analysis | — |

### Agent Auto-Routing

When you send a message, ax-code analyzes the content and automatically switches to the most appropriate agent. A toast notification appears when switching occurs. Domain agents (security, architect, debug, perf) are auto-routed; mode agents (plan, react) require manual switching via Tab.

---

## Programmatic SDK

Use ax-code as a library in your own apps — no HTTP server needed:

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

// Create agent (in-process, <1s startup)
const agent = await createAgent({
  directory: process.cwd(),
  auth: { provider: "xai", apiKey: "your-key" },
})

// One-shot
const result = await agent.run("Fix the login bug")
console.log(result.text, result.usage.totalTokens)

// Streaming
const text = await agent.stream("Explain this code").text()

// Streaming with callbacks
const stream = agent.stream("Refactor this function")
stream.on("text", (t) => process.stdout.write(t))
stream.on("tool-call", (tool) => console.log("Using:", tool))
await stream.done()

// Multi-turn session
const session = await agent.session()
await session.run("Read src/auth/index.ts")
await session.run("Now add input validation")

// Discovery
const models = await agent.models()   // 78+ models
const tools = await agent.tools()     // 15 built-in tools

// Cleanup
await agent.dispose()
```

### SDK Features
- **Typed errors** — `ProviderError`, `TimeoutError`, `ToolError`, `DisposedError`, `AgentNotFoundError`
- **Stream helpers** — `.text()`, `.result()`, `.on()`, `.done()`
- **Auto-retry** — `maxRetries` with exponential backoff on transient errors (429, 500)
- **Timeout** — on `createAgent()` and `agent.run()`
- **Direct API key** — `auth: { provider, apiKey }` — no local setup needed
- **Env var detection** — auto-reads `XAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`
- **Hooks** — `onToolCall`, `onToolResult`, `onPermissionRequest`, `onError`
- **Agent auto-routing** — works through SDK (security, architect, debug, perf)
- **Language** — `language: "ja"` for translated error messages (11 languages)

---

## VS Code Extension

Use ax-code directly inside VS Code with a sidebar chat panel.

### Install

1. Open VS Code
2. `Ctrl+Shift+P` → **"Install from VSIX"**
3. Select `sdks/vscode/ax-code-1.4.0.vsix`
4. Restart VS Code

### Features

| Feature | How |
|---|---|
| **Chat panel** | Click AX icon in sidebar, or `Ctrl+Shift+A` |
| **Select model** | Click "Model" button in chat panel |
| **Explain selection** | Select code → right-click → "ax-code: Explain Selection" |
| **Review selection** | Select code → right-click → "ax-code: Review Selection" |
| **Fix file** | Right-click → "ax-code: Fix This File" |
| **Explain file** | Right-click → "ax-code: Explain This File" |
| **Open terminal** | `Ctrl+Escape` or command palette → "ax-code: Open Terminal" |
| **Status bar** | Shows AX icon in bottom-right, click to open chat |

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+A` | Open chat panel |
| `Ctrl+Shift+E` | Explain selected code |
| `Ctrl+Escape` | Open ax-code terminal |

### How It Works

The extension spawns `ax-code serve` in the background and communicates via HTTP. First message takes ~20-30s (server startup), subsequent messages are 3-10s.

---

## Design Check

Scan CSS/React code for design violations:

```bash
ax-code design-check src/
```

### Rules

| Rule | Severity | What It Detects |
|------|----------|-----------------|
| `no-hardcoded-colors` | ERROR | Hex (#fff), rgb(), hsl() not using tokens |
| `no-raw-spacing` | WARN | px values not using spacing tokens |
| `no-inline-styles` | WARN | Inline style attributes in JSX/HTML |
| `missing-alt-text` | ERROR | `<img>` without alt attribute |
| `missing-form-labels` | ERROR | `<input>` without associated label |

Disable rules: `ax-code design-check src/ --rule no-inline-styles=off`

---

## Memory Warmup

Pre-cache project context for faster, more accurate AI responses:

```bash
ax-code memory warmup            # Scan and cache project context
ax-code memory status            # Show what's cached
ax-code memory clear             # Delete cache
```

Caches directory structure, README summary, config files, and detected tech stack in `.ax-code/memory.json`.

---

## Context Stats

Monitor context window usage and costs:

```bash
ax-code context                  # Latest session breakdown
ax-code context <sessionID>      # Specific session
```

Shows: token breakdown (system prompt, tools, history), usage percentage, status (GOOD/MODERATE/HIGH/CRITICAL), and estimated cost per provider.

---

## i18n (Internationalization)

Supports 11 languages for SDK error messages. Set via SDK:

```typescript
const agent = await createAgent({
  directory: ".",
  language: "ja",  // Error messages in Japanese
})
```

| Code | Language |
|------|----------|
| `en` | English |
| `zh-CN` | 简体中文 (Simplified Chinese) |
| `zh-TW` | 繁體中文 (Traditional Chinese) |
| `ja` | 日本語 (Japanese) |
| `ko` | 한국어 (Korean) |
| `es` | Español (Spanish) |
| `fr` | Français (French) |
| `de` | Deutsch (German) |
| `pt` | Português (Portuguese) |
| `th` | ไทย (Thai) |
| `vi` | Tiếng Việt (Vietnamese) |

---

## MCP Server Templates

Add pre-configured MCP servers instantly with `ax-code mcp add`:

| Category | Servers |
|----------|---------|
| **Search & Web** | Exa, Brave Search |
| **Developer Tools** | GitHub, GitLab, Linear, Sentry |
| **Databases** | PostgreSQL, SQLite |
| **File System** | Filesystem, Google Drive |
| **Browser & Testing** | Puppeteer, Playwright |
| **Cloud** | Vercel, Cloudflare |
| **Design** | Figma |
| **Communication** | Slack |

Auto-discovery (`ax-code mcp list --discover`) detects locally available servers based on environment variables and installed tools.

---

## Configuration

Create `ax-code.json` in your project root or `~/.config/ax-code/ax-code.json` for global config:

```json
{
  "language": "en",
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
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Gemini API key |
| `XAI_API_KEY` | xAI Grok API key |
| `GROQ_API_KEY` | Groq API key (free) |
| `AX_CODE_CONFIG` | Custom config file path |
| `AX_CODE_CONFIG_DIR` | Custom config directory |

---

## Project Structure

```
ax-code/
├── packages/
│   ├── ax-code/           # Core CLI application
│   │   └── src/
│   │       ├── agent/     # Agent system (9 agents + auto-routing)
│   │       │   ├── router.ts    # Auto-routing engine
│   │       │   └── prompt/      # Agent-specific system prompts
│   │       ├── auth/      # Authentication + API key encryption
│   │       ├── cli/       # CLI commands and TUI
│   │       ├── config/    # Hierarchical config system
│   │       ├── context/   # AX.md context generation
│   │       ├── design-check/  # CSS/React design linting (5 rules)
│   │       ├── i18n/      # Internationalization (11 languages)
│   │       ├── lsp/       # Language server integration
│   │       ├── mcp/       # Model Context Protocol
│   │       │   ├── discovery.ts   # Auto-discovery of MCP servers
│   │       │   └── templates/     # 16 pre-configured templates
│   │       ├── memory/    # Project memory warmup + cache
│   │       ├── planner/   # Task decomposition + verification
│   │       ├── provider/  # LLM provider abstraction
│   │       ├── sdk/       # Programmatic SDK entry point
│   │       ├── session/   # Session persistence + correction
│   │       ├── stats/     # Context stats + cost estimation
│   │       └── tool/      # 25+ built-in tools
│   ├── app/               # Shared web UI (SolidJS)
│   ├── ui/                # UI component library
│   ├── plugin/            # Plugin system
│   ├── sdk/js/            # JavaScript SDK
│   │   └── src/programmatic/  # Programmatic SDK
│   ├── util/              # Shared utilities
│   ├── script/            # Build/release scripts
│   └── desktop/           # Tauri desktop app (v2)
├── scripts/               # CLI setup scripts
├── docs/                  # PRDs, ADRs, status docs
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

## Project History

AX Code was built by combining two open source projects:

1. **[ax-cli](https://github.com/defai-digital/ax-cli)** — The original AI coding CLI by DEFAI Digital, featuring specialized agents, agent auto-routing, design checking, memory warmup, and the programmatic SDK.
2. **[OpenCode](https://github.com/anomalyco/opencode)** — A provider-agnostic, LSP-first AI coding assistant with a rich terminal UI, session persistence, and MCP support.

AX Code merges the agent intelligence and SDK capabilities of ax-cli with the robust TUI, provider abstraction, and tool ecosystem of OpenCode into a single unified project.

---

## License

[MIT](LICENSE)

Copyright (c) 2025 [DEFAI Private Limited](https://github.com/defai-digital). Portions of this software are derived from [OpenCode](https://github.com/anomalyco/opencode), Copyright (c) 2025 opencode.

---

## Credits

ax-code is built by [DEFAI Digital](https://github.com/defai-digital), with thanks to the [OpenCode](https://github.com/anomalyco/opencode) project and its contributors.
