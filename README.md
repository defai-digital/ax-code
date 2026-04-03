# AX Code

**The open source AI coding agent that works with any model.**

Use Claude, GPT, Gemini, Grok, DeepSeek, or run models locally — ax-code gives you full AI-powered development without vendor lock-in.

Built by [DEFAI Digital](https://github.com/defai-digital).

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/cTavsMgu)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Why AX Code?

Most AI coding tools lock you into a single provider. AX Code doesn't.

**Switch models freely.** Use Claude for complex reasoning, Gemini for long context, Grok for real-time web knowledge, or run Llama locally for privacy — all with the same workflow, the same agents, the same tools.

**Specialized agents, not a generic chatbot.** AX Code ships with 9 purpose-built agents (security auditor, architect, debugger, performance profiler, and more) that auto-activate based on what you're working on. Ask about a vulnerability and the security agent takes over. Hit a crash and the debug agent steps in. No manual switching needed.

**Real code intelligence.** AX Code connects to language servers (TypeScript, Python, Go, Rust, and more) for actual go-to-definition, find-references, and diagnostics — not regex pattern matching.

**Use it everywhere.** Terminal, desktop app, web browser, VS Code sidebar, or embed it in your own apps via the programmatic SDK.

---

## Who Is AX Code For?

- **Developers who use multiple AI models** and want one tool that works with all of them
- **Teams that can't commit to a single vendor** due to cost, compliance, or capability needs
- **Engineers building AI-powered tools** who need a programmatic SDK, not just a chat UI
- **Security-conscious developers** who want encrypted credentials, execution sandboxing, and the ability to run models locally
- **Open source advocates** who want full transparency and customization

---

## Get Started in 60 Seconds

```bash
# Install
git clone https://github.com/defai-digital/ax-code.git
cd ax-code && pnpm install && pnpm run setup:cli

# Set any provider key (pick one)
export GOOGLE_GENERATIVE_AI_API_KEY="your-key"   # Gemini
export XAI_API_KEY="your-key"                     # Grok
export GROQ_API_KEY="your-key"                    # Groq (free tier)

# Launch
ax-code
```

**Prerequisites:** [pnpm](https://pnpm.io) v9.15.9+ and [Bun](https://bun.sh) v1.3.11+

---

## Supported Providers

### Cloud

| Provider | Models | Setup |
|----------|--------|-------|
| **Anthropic** | Claude Opus, Sonnet, Haiku | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-5, GPT-4, o3, o4 | `OPENAI_API_KEY` |
| **Google** | Gemini 3.0, 3.1 | `GOOGLE_GENERATIVE_AI_API_KEY` |
| **xAI** | Grok-2, Grok-3, Grok-4 | `XAI_API_KEY` |
| **DeepSeek** | Chat, Reasoner | `DEEPSEEK_API_KEY` |
| **Groq** | Llama, Qwen, Gemma, DeepSeek | `GROQ_API_KEY` (free) |
| **GitHub Copilot** | Claude, GPT, Gemini via Copilot | `ax-code providers login` |
| **Alibaba Cloud** | Qwen3, Qwen3-Coder | `DASHSCOPE_API_KEY` |
| **Azure** | GPT, Claude, Llama, Phi | `AZURE_API_KEY` |
| **Perplexity** | Sonar, Sonar Pro, Deep Research | `PERPLEXITY_API_KEY` |
| **Z.AI** | GLM-4.5, GLM-4.7, GLM-5 | `ax-code providers login` |

### Local (Offline, Private)

| Provider | Setup |
|----------|-------|
| **AX Studio** | Auto-detected at `localhost:11434` or `AX_STUDIO_HOST` |
| **Ollama** | Auto-detected at `localhost:11434` or `OLLAMA_HOST` |
| **LM Studio** | Configure in `ax-code.json` |

Local providers auto-discover running models — no API key needed. Your code never leaves your machine.

---

## Core Features

### Specialized AI Agents

AX Code doesn't use a single generic assistant. It ships with **9 purpose-built agents**, each with tailored system prompts, tool access, and permission boundaries.

| Agent | What It Does | Auto-routes When You Say... |
|-------|-------------|---------------------------|
| **build** | General development — full tool access | *(default agent)* |
| **security** | Vulnerability scanning, secrets detection, OWASP analysis | "scan for vulnerabilities", "security audit" |
| **architect** | System design analysis, dependency review, coupling detection | "analyze architecture", "review structure" |
| **debug** | Bug investigation, root cause analysis, systematic fixes | "debug this", "why is it crashing" |
| **perf** | Bottleneck detection, memory profiling, optimization | "too slow", "optimize", "performance" |
| **plan** | Read-only task decomposition and planning | *(manual switch via Tab)* |
| **react** | Structured Thought/Action/Observation reasoning | *(manual switch via Tab)* |
| **general** | Parallel multi-step task execution | *(subagent)* |
| **explore** | Fast codebase search and navigation | *(subagent)* |

**Agent auto-routing** analyzes your message and switches to the right agent automatically. A toast notification tells you when it happens. You can also switch manually with **Tab**.

### Language Server Integration (LSP)

AX Code talks to real language servers — the same ones your IDE uses.

- **Go to definition** — Jump to where a function/type is defined
- **Find references** — See every usage across the codebase
- **Hover info** — Get type signatures and documentation
- **Call hierarchy** — Trace incoming and outgoing calls
- **Diagnostics** — Surface real compiler errors and warnings

Supports TypeScript, Python (Pyright), Go (gopls), Rust (rust-analyzer), Ruby (Solargraph), C/C++ (clangd), and more.

### 25+ Built-in Tools

| Category | Tools |
|----------|-------|
| **File operations** | read, write, edit, glob, ls, multiedit |
| **Code search** | grep (regex), codesearch (web), websearch |
| **Shell execution** | bash (with timeout and sandboxing), pty (interactive) |
| **LSP queries** | definition, references, hover, symbols, call hierarchy, diagnostics |
| **Planning** | task, todo, plan enter/exit |
| **Web** | webfetch (URL to markdown), websearch |
| **Batch** | Parallel tool execution |

### Session Persistence

Every conversation is stored in SQLite. You can:

- **Resume** any previous session
- **Fork** a session to explore different approaches
- **Compact** sessions to reduce token usage
- **Export/Import** sessions as JSON

### MCP (Model Context Protocol)

Connect to external tools and services via MCP with 16 pre-configured templates:

| Category | Servers |
|----------|---------|
| **Search & Web** | Exa, Brave Search |
| **Developer Tools** | GitHub, GitLab, Linear, Sentry |
| **Databases** | PostgreSQL, SQLite |
| **Browser** | Puppeteer, Playwright |
| **Cloud** | Vercel, Cloudflare |
| **Design** | Figma |
| **Communication** | Slack |

```bash
ax-code mcp add              # Add from template or custom
ax-code mcp list --discover  # Auto-detect available servers
```

Supports SSE, HTTP, and stdio transports with OAuth authentication.

### AX.md Context System

Generate AI-optimized project context that helps every conversation start informed:

```bash
ax-code init                 # Generate AX.md context
ax-code init --depth full    # Deep analysis with code patterns
ax-code memory warmup        # Pre-cache for faster responses
```

### Design Check

Scan CSS/React code for design system violations:

```bash
ax-code design-check src/
```

Catches hardcoded colors, raw spacing values, inline styles, missing alt text, and missing form labels.

### Self-Correction & ReAct Reasoning

- **Self-correction** — Detects failures, reflects on what went wrong, and retries with a different approach
- **ReAct mode** — Structured Thought → Action → Observation loops for complex multi-step problems
- **Planning system** — Decomposes large tasks into dependency-ordered steps with verification

---

## Use It Your Way

### Terminal (TUI)

```bash
ax-code                      # Launch interactive TUI
ax-code run "fix the login bug"  # One-shot non-interactive mode
```

The terminal UI features a customizable theme system (GitHub default), context stats, agent switching, and real-time streaming.

### Desktop App

Native cross-platform desktop app built with Tauri:

```bash
pnpm --dir packages/desktop tauri dev
```

Available for macOS (Apple Silicon & Intel), Windows, and Linux.

### Web App

```bash
ax-code serve --port 4096          # Start the backend
pnpm --dir packages/app dev        # Start the web UI
```

Full-featured web interface with chat, file explorer, terminal emulator, and model selection.

### VS Code Extension

Use ax-code directly inside VS Code:

1. `Ctrl+Shift+P` → **"Install from VSIX"** → select `sdks/vscode/ax-code-1.4.0.vsix`
2. Open the sidebar panel with `Ctrl+Shift+A`

**Features:** chat panel, explain/review/fix via right-click, code selection actions, integrated terminal.

### Programmatic SDK

Build AI-powered applications with the SDK — no HTTP server needed:

```typescript
import { createAgent } from "@ax-code/sdk/programmatic"

const agent = await createAgent({
  directory: process.cwd(),
  auth: { provider: "xai", apiKey: "your-key" },
})

// One-shot execution
const result = await agent.run("Fix the login bug")
console.log(result.text, result.usage.totalTokens)

// Streaming with callbacks
const stream = agent.stream("Refactor this function")
stream.on("text", (t) => process.stdout.write(t))
stream.on("tool-call", (tool) => console.log("Using:", tool))
await stream.done()

// Multi-turn sessions
const session = await agent.session()
await session.run("Read src/auth/index.ts")
await session.run("Now add input validation")

// Discovery
const models = await agent.models()   // 78+ models
const tools = await agent.tools()     // 15 built-in tools

await agent.dispose()
```

**SDK highlights:**
- In-process execution (< 1s startup, no server)
- Typed errors: `ProviderError`, `TimeoutError`, `ToolError`, `DisposedError`
- Stream helpers: `.text()`, `.result()`, `.on()`, `.done()`
- Auto-retry with exponential backoff
- Agent auto-routing works through SDK
- Hooks: `onToolCall`, `onToolResult`, `onPermissionRequest`, `onError`

---

## Security

### Execution Sandbox

Control what the AI agent can access with three isolation modes:

| Mode | Behavior |
|------|----------|
| **Read-only** | Blocks all file mutations and shell commands |
| **Workspace write** *(default)* | Allows writes only inside the workspace; `.git` and `.ax-code` always protected |
| **Full access** | Disables isolation (explicit opt-in) |

```bash
ax-code --sandbox read-only
```

Network access for tools is disabled by default in read-only and workspace-write modes. Isolation violations trigger an approval prompt.

### Credential Encryption

All API keys, OAuth tokens, and account credentials are encrypted at rest with **AES-256-GCM**. See [SECURITY.md](SECURITY.md) for the full threat model.

### Server Security

- Binds to **localhost only** by default
- Network binding requires `AX_CODE_SERVER_PASSWORD`
- CORS and authentication enforced

---

## Configuration

Create `ax-code.json` in your project root or `~/.config/ax-code/ax-code.json` for global settings:

```json
{
  "provider": {
    "google": {
      "options": { "apiKey": "your-key" }
    }
  }
}
```

Config is hierarchical: remote org defaults → global → custom path → project → `.ax-code/` directory → managed overrides.

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude |
| `OPENAI_API_KEY` | GPT |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini |
| `XAI_API_KEY` | Grok |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `GROQ_API_KEY` | Groq (free) |
| `AX_CODE_ISOLATION_MODE` | Sandbox: `read-only`, `workspace-write`, `full-access` |
| `AX_CODE_SERVER_PASSWORD` | Required for network-bound server |

---

## CLI Reference

```bash
# Core
ax-code                              # Launch TUI
ax-code run "message"                # Non-interactive mode
ax-code serve                        # Headless API server
ax-code --sandbox read-only          # Read-only mode

# Providers & Models
ax-code providers list               # List providers
ax-code providers login              # Add credential
ax-code providers login groq         # Quick setup
ax-code models                       # List models

# Project Context
ax-code init                         # Generate AX.md
ax-code init --depth full            # Full analysis
ax-code memory warmup                # Pre-cache context

# MCP
ax-code mcp add                      # Add MCP server
ax-code mcp list --discover          # Auto-detect servers

# Analysis
ax-code design-check src/            # Design violations
ax-code context                      # Token usage & cost
ax-code stats                        # Usage statistics

# Sessions
ax-code session list                 # List sessions
ax-code export <sessionID>           # Export as JSON
```

---

## Project Structure

```
ax-code/
├── packages/
│   ├── ax-code/           # Core CLI — agents, tools, providers, server
│   ├── app/               # Web UI (SolidJS)
│   ├── desktop/           # Desktop app (Tauri)
│   ├── sdk/js/            # JavaScript/TypeScript SDK
│   ├── plugin/            # Plugin system
│   ├── ui/                # Shared UI components
│   ├── util/              # Shared utilities
│   └── script/            # Build & release scripts
└── docs/                  # Documentation
```

---

## Built With

[Bun](https://bun.sh) | [TypeScript](https://typescriptlang.org) | [Vercel AI SDK](https://sdk.vercel.ai) | [SolidJS](https://solidjs.com) | [Hono](https://hono.dev) | [Drizzle ORM](https://orm.drizzle.team) | [Effect](https://effect.website) | [Tauri](https://tauri.app)

---

## Project History

AX Code was built by combining two open source projects:

1. **[ax-cli](https://github.com/defai-digital/ax-cli)** — DEFAI Digital's original AI coding CLI with specialized agents, auto-routing, design checking, memory warmup, and the programmatic SDK.
2. **[OpenCode](https://github.com/anomalyco/opencode)** — A provider-agnostic, LSP-first AI coding assistant with a rich terminal UI, session persistence, and MCP support.

---

## Contributing

We welcome bug reports and feature requests through [GitHub Issues](https://github.com/defai-digital/ax-code/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Community

Join us on [Discord](https://discord.gg/cTavsMgu).

## Language

The UI is English only. AI responses support any language your chosen model supports.

## Changelog

See [GitHub Releases](https://github.com/defai-digital/ax-code/releases).

## License

[MIT](LICENSE) — Copyright (c) 2025 [DEFAI Private Limited](https://github.com/defai-digital). Portions derived from [OpenCode](https://github.com/anomalyco/opencode), Copyright (c) 2025 opencode.

## Credits

Built by [DEFAI Digital](https://github.com/defai-digital), with thanks to the [OpenCode](https://github.com/anomalyco/opencode) project and its contributors.
