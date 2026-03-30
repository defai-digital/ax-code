# Changelog

All notable changes to ax-code are documented here.

---

## v1.4.0 (2026-03-30)

### Base: OpenCode (Forked)

ax-code is built on top of [OpenCode](https://github.com/anomalyco/opencode), an open-source AI coding agent. The following core features were inherited from OpenCode:

- **Agent system** — build, plan, react agents with permission-based tool access
- **25+ built-in tools** — read, write, edit, bash, grep, glob, web fetch, tasks, todos
- **Session persistence** — SQLite-backed with fork, revert, compaction, sharing
- **LSP integration** — Pyright, TypeScript, Go, Deno, ESLint, and 20+ language servers
- **TUI** — SolidJS terminal UI with themes, keyboard shortcuts, command palette
- **MCP support** — Model Context Protocol with SSE/stdio/HTTP transports, OAuth
- **Provider abstraction** — Vercel AI SDK for multi-provider LLM access
- **Permission system** — per-agent, per-tool, per-file allow/deny/ask rules
- **Plugin system** — extensible hooks for auth, tools, events, config, chat
- **Hierarchical config** — project, global, and managed config with merge
- **Server** — Hono HTTP server with OpenAPI spec and SSE events
- **PTY** — Terminal sessions within sessions
- **Snapshots** — File change tracking with diff and revert
- **Session sharing** — Share sessions via URL
- **Stats** — Token usage, cost, tool usage tracking
- **Doctor command** — System health checks

### Added (from ax-cli)

Features imported and reimplemented from ax-cli for ax-code's architecture:

- **Programmatic SDK** (`@ax-code/sdk/programmatic`)
  - `createAgent()` — direct agent instantiation without HTTP server
  - `agent.run()` — one-shot prompt with text, tokens, tool calls
  - `agent.stream()` — streaming with `.text()`, `.result()`, `.on()`, `.done()`
  - `agent.session()` — multi-turn conversations with SQLite persistence
  - `agent.models()` — discover 100+ available models
  - `agent.tools()` — discover 15 built-in tools
  - `agent.tool()` — direct tool execution
  - Typed errors: `ProviderError`, `TimeoutError`, `ToolError`, `DisposedError`, `AgentNotFoundError`
  - Auto-retry with exponential backoff on transient errors (429, 500, 504)
  - Timeout support on `createAgent()` and `agent.run()`
  - Direct API key auth: `auth: { provider, apiKey }`
  - Env var auto-detection: `XAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`
  - Language option for translated error messages (11 languages)
  - Event hooks: `onToolCall`, `onToolResult`, `onPermissionRequest`, `onError`

- **4 Specialized AI Agents**
  - Security auditor — vulnerability scanning, secrets detection, OWASP
  - Architecture analyst — system design, dependencies, coupling
  - Debugger — bug investigation, root cause, fixes
  - Performance profiler — bottlenecks, memory, optimization

- **Agent Auto-Routing**
  - Keyword + regex matching to auto-select best agent
  - Toast notification when switching agents
  - Domain agents auto-routed (security, architect, debug, perf)
  - Mode agents require manual switch (plan, react)

- **VS Code Extension** (`sdks/vscode`)
  - Sidebar chat panel with streaming responses
  - Model selector (VS Code QuickPick with all providers)
  - Right-click: Explain Selection, Review Selection, Fix File, Explain File
  - Keyboard shortcuts: Ctrl+Shift+A (chat), Ctrl+Shift+E (explain)
  - Status bar icon, auto server management
  - .vsix package for easy installation

- **MCP Server Templates** (16 pre-configured)
  - Search: Exa, Brave Search
  - Developer Tools: GitHub, GitLab, Linear, Sentry
  - Databases: PostgreSQL, SQLite
  - File System: Filesystem, Google Drive
  - Browser: Puppeteer, Playwright
  - Cloud: Vercel, Cloudflare
  - Design: Figma
  - Communication: Slack

- **MCP Auto-Discovery**
  - Detects locally available servers from env vars and installed tools
  - Opt-in via `ax-code mcp list --discover`

- **Design Check System** (5 rules)
  - no-hardcoded-colors (hex, rgb, hsl detection)
  - no-raw-spacing (px values)
  - no-inline-styles (JSX/HTML)
  - missing-alt-text (accessibility)
  - missing-form-labels (accessibility)
  - CLI: `ax-code design-check [paths..] [--rule name=off]`

- **Memory Warmup**
  - Project scanner (structure, README, config, tech stack)
  - Cached in `.ax-code/memory.json`
  - CLI: `ax-code memory warmup/status/clear`

- **Context Stats**
  - Token breakdown by category (system prompt, tools, history)
  - Cost estimation per provider
  - Status levels (GOOD/MODERATE/HIGH/CRITICAL)
  - CLI: `ax-code context [sessionID]`

- **i18n Module** (11 languages)
  - English, Simplified Chinese, Traditional Chinese, Japanese, Korean
  - Spanish, French, German, Portuguese, Thai, Vietnamese
  - Available via SDK: `createAgent({ language: "ja" })`

- **Global CLI Setup**
  - `bun run setup:cli` installs `ax-code` as global command
  - Works on Windows (PowerShell, cmd, Git Bash), macOS, Linux

- **Groq Provider**
  - Free tier with fast inference (Llama 4, Llama 3.3, Qwen, Gemma, DeepSeek)
  - Note: Requires Dev tier for ax-code (system prompt exceeds free tier token limit)

### Changed

- **Providers reduced** — kept Google Gemini, xAI Grok, Groq, Z.AI (GLM), local models (OpenAI-Compatible)
- **Rebrand** — opencode → ax-code (package names, CLI, config, env vars, database, URLs, documentation)
- **Providers login** — only shows supported providers, not all 100+ from registry

### Fixed

- Auth input validation — sanitize provider IDs, block path traversal
- Status dialog crash — `enabledFormatters` null check
- Database migration message showing every time in dev mode
- Provider login showing all providers from registry
- xAI reasoning detection for "fast" model variants
- Agent router regex for "Analyze" keyword
- Router confidence formula for single keyword matches
- Trailing commas in root package.json (esbuild compatibility)

### Removed

- 7 provider SDKs: OpenAI, OpenRouter, Mistral, Groq (re-added), Vercel, Google Vertex, GitHub Copilot
- Copilot SDK directory (20+ files)
- Copilot and Codex auth plugins
- Dead code (scrap.ts, placeholder scripts)
- Broken test files (copilot, codex)
- OpenRouter patch file
- ~5,989 lines of dead code total

---

## v1.3.2 (2026-03-26)

Initial ax-code release — OpenCode base with first batch of ax-cli features.

### From OpenCode
- Full TUI with SolidJS
- 25+ built-in tools
- Session persistence (SQLite)
- LSP integration
- MCP support
- Provider abstraction
- Permission system

### From ax-cli
- AX.md context system (`/init`)
- Context injection into prompts
- Self-correction agent
- ReAct agent mode
- API key encryption (AES-256-GCM)
- Planning/task decomposition
- Verification callbacks
- Grok server-side tools (x_search, code_execution)
- Grok parallel function calling
- Grok reasoning modes
- Doctor command

---

## Credits

- **Base:** [OpenCode](https://github.com/anomalyco/opencode) by Anomaly
- **Features:** ax-cli by DEFAI Digital
- **Built by:** [DEFAI Digital](https://github.com/defai-digital)
