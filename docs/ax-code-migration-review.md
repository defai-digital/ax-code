# AX-CODE MIGRATION REVIEW SHEET

## OpenCode (Base) + ax-cli (Feature Source) → ax-code

**Prepared:** 2026-03-24
**Purpose:** First deliverable — structured feature/module inventory for migration scoping
**Direction:** ax-code = OpenCode as primary base + selected high-value features from ax-cli

---

## 1. EXECUTIVE SUMMARY

### What we're building

**ax-code** merges OpenCode's mature, provider-agnostic platform with ax-cli's high-value differentiators (Grok server-side tools, AX.md context system, planning/self-correction, programmatic SDK).

### OpenCode strengths (why it's the base)

- **20+ LLM providers** via Vercel AI SDK abstraction — not locked to any vendor
- **LSP-first architecture** — real language server integration (pyright, typescript-language-server, sourcekit, etc.), not regex hacks
- **Comprehensive tool system** — 25+ tools with permission controls
- **Session persistence** — SQLite-backed, forkable, compactable sessions
- **Multi-UI** — TUI (primary), web console, desktop (Tauri + Electron)
- **MCP support** — Model Context Protocol with SSE/stdio/HTTP transports
- **Enterprise-ready config** — hierarchical 6-layer config, managed deployments
- **MIT license**, active community, 20 translated READMEs

### ax-cli strengths (what to import)

- **Grok provider with server-side tools** — x_search, code_execution (server-side Python sandbox), parallel function calling
- **AX.md project context system** — `/init` generates single-file AI context with depth levels (basic/standard/full/security)
- **Planning & self-correction** — task decomposition with dependency ordering, automatic failure reflection/retry
- **Programmatic SDK** — 10-40x faster than CLI spawning, enables IDE integration
- **AutomatosX agents** — 20+ specialized agents (frontend, backend, security, architecture, etc.)
- **Design check system** — CSS/design token linting with auto-fix
- **Encrypted API key storage** — AES-256-GCM with PBKDF2

### Key decisions needed

1. **Provider count**: OpenCode has 20+ providers. Do we keep all or trim to 5-8 core?
2. **GLM provider**: Deprecated in ax-cli. Cut entirely?
3. **Desktop apps**: Tauri + Electron + Web Console — pick one or defer all?
4. **Enterprise features**: Keep or strip for v1?
5. **AutomatosX agents**: Import 2-3 core agents or all 20+?
6. **Design check**: Niche (React/CSS only) — keep or defer?

### Numbers at a glance

| Metric          | OpenCode             | ax-cli                      |
| --------------- | -------------------- | --------------------------- |
| Language        | TypeScript (Bun)     | TypeScript (Node 24+)       |
| Core LOC        | ~36,000              | ~337 files                  |
| Packages        | ~15 (monorepo)       | 4 (monorepo)                |
| LLM Providers   | 20+                  | 3 (Grok, GLM, local)        |
| Tools           | 25+                  | 11                          |
| License         | MIT                  | MIT (DEFAI Private Limited) |
| Package Manager | Bun                  | pnpm                        |
| UI Framework    | SolidJS + TUI        | React 19 + Ink 6.5          |
| AI SDK          | Vercel AI SDK (`ai`) | OpenAI SDK (`openai`)       |
| Database        | SQLite (Drizzle ORM) | JSON files                  |
| MCP Support     | Yes (full)           | Yes (12+ templates)         |

---

## 2. CATEGORY BREAKDOWN — OPENCODE (14 Categories)

| #   | Category                         | Key Packages/Folders                                     | Module Count  | Complexity | Notes                                                                      |
| --- | -------------------------------- | -------------------------------------------------------- | ------------- | ---------- | -------------------------------------------------------------------------- |
| 1   | **Agent System**                 | `src/agent/`                                             | 1 major       | Medium     | Multi-agent with modes (subagent/primary/all), temperature, model choice   |
| 2   | **Provider/LLM**                 | `src/provider/`                                          | 20+ providers | High       | Vercel AI SDK abstraction, models.dev registry, auth, transform (34KB)     |
| 3   | **Tool System**                  | `src/tool/`                                              | 25+ tools     | High       | Registry-based, Zod schemas, permission-aware, truncation                  |
| 4   | **Session Management**           | `src/session/`                                           | 4 modules     | High       | SQLite, message-v2, prompting (72KB), compaction, sharing                  |
| 5   | **LSP Integration**              | `src/lsp/`                                               | 3 modules     | High       | Multi-server, diagnostics, hover, go-to-def, symbols, call hierarchy       |
| 6   | **Configuration**                | `src/config/`                                            | 3 modules     | High       | 6-layer hierarchy, JSONC, enterprise managed config                        |
| 7   | **MCP (Model Context Protocol)** | `src/mcp/`                                               | 1 major       | Medium     | SSE/stdio/HTTP, OAuth, tool discovery                                      |
| 8   | **CLI/Commands**                 | `src/cli/`                                               | 20+ commands  | Medium     | yargs-based, account/agent/export/github/import/mcp/models/pr/etc.         |
| 9   | **TUI (Terminal UI)**            | `src/cli/tui/` + opentui                                 | 3 packages    | Medium     | SolidJS TUI, attach, thread modes                                          |
| 10  | **Web Console**                  | `packages/console/`                                      | 1 package     | Medium     | SolidStart, Stripe, analytics                                              |
| 11  | **Desktop Apps**                 | `packages/desktop/`, `desktop-electron/`                 | 2 packages    | Medium     | Tauri (Rust) + Electron                                                    |
| 12  | **Storage/DB**                   | `src/storage/`                                           | 2 adapters    | Low        | SQLite, Drizzle ORM, Bun+Node adapters                                     |
| 13  | **Security/Permissions**         | `src/permission/`                                        | 1 module      | Medium     | Rule-based, read/write/bash/external controls                              |
| 14  | **Infrastructure**               | `src/server/`, `src/auth/`, `src/bus/`, `src/env/`, etc. | 15+ modules   | Medium     | Hono server, OAuth, event bus, env vars, file ops, git worktree, snapshots |

**Additional sub-modules:** IDE integrations (5 editors), plugin system, skill system, sharing, patch system, project management, installation tracking, ULID generation, PTY support.

---

## 3. CATEGORY BREAKDOWN — AX-CLI (12 Categories)

| #   | Category            | Key Folders     | Module Count   | Complexity | Notes                                                    |
| --- | ------------------- | --------------- | -------------- | ---------- | -------------------------------------------------------- |
| 1   | **Agent System**    | `agent/`        | 1 major        | Medium     | ReAct loops, execution, self-correction                  |
| 2   | **Provider/LLM**    | `provider/`     | 3 providers    | Medium     | Grok, GLM (deprecated), local (Ollama). OpenAI SDK.      |
| 3   | **Tool System**     | `tools/`        | 11 tools       | Medium     | bash, file ops, search, todos, agent delegation          |
| 4   | **Planning**        | `planner/`      | 1 module       | Medium     | Task decomposition, dependency ordering, verification    |
| 5   | **UI/TUI**          | `ui/`           | 12+ components | Medium     | React 19 + Ink 6.5, diffs, MCP dashboard, phase progress |
| 6   | **MCP Integration** | `mcp/`          | 1 major        | Medium     | Auto-discovery, 12+ templates (Figma, GitHub, etc.)      |
| 7   | **Memory/Context**  | `memory/`       | 1 module       | Low        | Context caching, injection, warmup, stats                |
| 8   | **Checkpoints**     | `checkpoint/`   | 1 module       | Low        | Session save/restore/rewind                              |
| 9   | **Design Check**    | `design-check/` | 1 module       | Low        | CSS linting, design tokens, a11y, auto-fix               |
| 10  | **i18n**            | `i18n/locales/` | 11 languages   | Low        | Full localization system                                 |
| 11  | **SDK**             | `sdk/`          | 1 module       | Low        | Programmatic API, streaming, TypeScript types            |
| 12  | **Commands**        | `commands/`     | 8+ commands    | Low        | /init, /model, /lang, /doctor, /help, MCP mgmt, memory   |

**Additional:** IPC system, security guards, permission manager, schemas package (SSOT Zod types), VSCode extension.

---

## 4. EXCEL-STYLE FEATURE INVENTORY TABLE

### Legend

- **Keep** = Include in ax-code v1
- **Cut** = Remove, do not include
- **Later** = Defer to v2/v3
- **Review** = Needs team discussion before deciding

---

### 4A. OPENCODE MODULES (Base Platform)

| Category  | Module / Feature            | Source   | Subsystem / Folder                  | What It Does                                                      | User Value | Tech Importance | Dependency / Provider             | Keep/Cut/Later/Review | Reason                                 | Maintenance Impact | License Risk | Notes                          |
| --------- | --------------------------- | -------- | ----------------------------------- | ----------------------------------------------------------------- | ---------: | --------------- | --------------------------------- | --------------------- | -------------------------------------- | ------------------ | ------------ | ------------------------------ |
| Agent     | Agent system                | OpenCode | `src/agent/`                        | Defines agents with modes, permissions, model choice, temperature |       High | Critical        | Effect.io                         | **Keep**              | Core execution engine                  | Low                | None (MIT)   | Multi-agent architecture       |
| Agent     | Subagent support            | OpenCode | `src/agent/`                        | Spawn child agents for sub-tasks                                  |       High | High            | —                                 | **Keep**              | Enables complex workflows              | Low                | None         | —                              |
| Provider  | OpenAI provider             | OpenCode | `src/provider/`                     | GPT-4, GPT-4.5                                                    |       High | Critical        | `@ai-sdk/openai`                  | **Keep**              | Market leader                          | Low                | None         | —                              |
| Provider  | Google provider             | OpenCode | `src/provider/`                     | Gemini models                                                     |       High | High            | `@ai-sdk/google`                  | **Keep**              | Strong competitor, large context       | Low                | None         | —                              |
| Provider  | Google Vertex               | OpenCode | `src/provider/`                     | Cloud-hosted Gemini                                               |     Medium | Medium          | `@ai-sdk/google-vertex`           | **Review**            | Enterprise use only                    | Low                | None         | Overlaps with direct Google    |
| Provider  | Google Vertex Anthropic     | OpenCode | `src/provider/`                     | Cloud-hosted Claude via Vertex                                    |     Medium | Medium          | `@ai-sdk/google-vertex/anthropic` | **Review**            | Enterprise use only                    | Low                | None         | Overlaps with direct Anthropic |
| Provider  | Azure OpenAI                | OpenCode | `src/provider/`                     | Azure-hosted GPT models                                           |     Medium | Medium          | `@ai-sdk/azure`                   | **Review**            | Enterprise use; overlaps OpenAI        | Low                | None         | Corp compliance path           |
| Provider  | Amazon Bedrock              | OpenCode | `src/provider/`                     | AWS-hosted models                                                 |     Medium | Medium          | `@ai-sdk/amazon-bedrock`          | **Review**            | Enterprise AWS shops                   | Medium             | None         | Complex AWS auth               |
| Provider  | XAI (Grok)                  | OpenCode | `src/provider/`                     | Grok models via AI SDK                                            |     Medium | Medium          | `@ai-sdk/xai`                     | **Keep**              | Differentiated; pairs with ax-cli Grok | Low                | None         | Has patch applied              |
| Provider  | Mistral                     | OpenCode | `src/provider/`                     | Mistral AI models                                                 |        Low | Low             | `@ai-sdk/mistral`                 | **Later**             | Niche; low demand                      | Low                | None         | —                              |
| Provider  | Groq                        | OpenCode | `src/provider/`                     | Fast inference                                                    |        Low | Low             | `@ai-sdk/groq`                    | **Later**             | Speed niche only                       | Low                | None         | —                              |
| Provider  | DeepInfra                   | OpenCode | `src/provider/`                     | Model inference API                                               |        Low | Low             | `@ai-sdk/deepinfra`               | **Cut**               | Low differentiation                    | Low                | None         | —                              |
| Provider  | Cerebras                    | OpenCode | `src/provider/`                     | Fast transformers                                                 |        Low | Low             | `@ai-sdk/cerebras`                | **Cut**               | Very niche                             | Low                | None         | —                              |
| Provider  | Cohere                      | OpenCode | `src/provider/`                     | Cohere API                                                        |        Low | Low             | `@ai-sdk/cohere`                  | **Cut**               | Low coding relevance                   | Low                | None         | —                              |
| Provider  | OpenRouter                  | OpenCode | `src/provider/`                     | Multi-provider routing                                            |     Medium | Medium          | `@openrouter/ai-sdk-provider`     | **Keep**              | Catches all others via routing         | Low                | None         | Has patch applied              |
| Provider  | Together AI                 | OpenCode | `src/provider/`                     | Open source model hosting                                         |        Low | Low             | `@ai-sdk/togetherai`              | **Cut**               | OpenRouter covers this                 | Low                | None         | —                              |
| Provider  | Perplexity                  | OpenCode | `src/provider/`                     | Reasoning/search models                                           |        Low | Low             | `@ai-sdk/perplexity`              | **Cut**               | Niche                                  | Low                | None         | —                              |
| Provider  | Vercel Gateway              | OpenCode | `src/provider/`                     | Vercel's provider gateway                                         |        Low | Low             | `@ai-sdk/gateway`                 | **Cut**               | Vendor-specific routing                | Low                | None         | —                              |
| Provider  | GitLab AI                   | OpenCode | `src/provider/`                     | GitLab Code Suggestions                                           |        Low | Low             | `gitlab-ai-provider`              | **Cut**               | Very niche                             | Low                | None         | —                              |
| Provider  | GitHub Copilot              | OpenCode | `src/provider/`                     | Copilot API via custom SDK                                        |     Medium | Low             | Custom (`./sdk/copilot`)          | **Later**             | Nice to have; complex auth             | Medium             | None         | Custom implementation          |
| Provider  | OpenAI-Compatible           | OpenCode | `src/provider/`                     | Generic compatible endpoints                                      |       High | High            | `@ai-sdk/openai-compatible`       | **Keep**              | Covers Ollama, LMStudio, vLLM          | Low                | None         | Critical for local models      |
| Provider  | Poe                         | OpenCode | `src/provider/`                     | Poe auth integration                                              |        Low | Low             | Custom (`opencode-poe-auth`)      | **Cut**               | Very niche                             | Low                | None         | —                              |
| Provider  | Model registry (models.dev) | OpenCode | `src/provider/models.ts`            | Dynamic model catalog from models.dev                             |     Medium | Medium          | External service                  | **Review**            | Network dependency; needs fallback     | Medium             | None         | Consider self-hosted catalog   |
| Tool      | File read                   | OpenCode | `src/tool/read`                     | Read file contents with highlighting                              |       High | Critical        | —                                 | **Keep**              | Core functionality                     | Low                | None         | —                              |
| Tool      | File write                  | OpenCode | `src/tool/write`                    | Create/write files                                                |       High | Critical        | —                                 | **Keep**              | Core functionality                     | Low                | None         | —                              |
| Tool      | File edit                   | OpenCode | `src/tool/edit`                     | Precise multi-edit support                                        |       High | Critical        | —                                 | **Keep**              | Core functionality                     | Low                | None         | —                              |
| Tool      | Apply patch                 | OpenCode | `src/tool/apply_patch`              | Apply unified diffs                                               |       High | High            | —                                 | **Keep**              | Essential for code changes             | Low                | None         | —                              |
| Tool      | Multi-edit                  | OpenCode | `src/tool/multiedit`                | Multiple sequential edits                                         |     Medium | Medium          | —                                 | **Keep**              | Batch efficiency                       | Low                | None         | —                              |
| Tool      | Glob                        | OpenCode | `src/tool/glob`                     | File pattern matching                                             |       High | High            | —                                 | **Keep**              | Core search                            | Low                | None         | —                              |
| Tool      | Grep                        | OpenCode | `src/tool/grep`                     | Regex content search                                              |       High | High            | —                                 | **Keep**              | Core search                            | Low                | None         | —                              |
| Tool      | List (ls)                   | OpenCode | `src/tool/list`                     | Directory listing                                                 |     Medium | Medium          | —                                 | **Keep**              | Basic file nav                         | Low                | None         | —                              |
| Tool      | Code search                 | OpenCode | `src/tool/codesearch`               | Code-aware search                                                 |     Medium | Medium          | —                                 | **Keep**              | Advanced search                        | Low                | None         | —                              |
| Tool      | Bash                        | OpenCode | `src/tool/bash`                     | Shell command execution                                           |       High | Critical        | —                                 | **Keep**              | Core functionality                     | Low                | None         | —                              |
| Tool      | LSP tool                    | OpenCode | `src/tool/lsp`                      | Language server queries                                           |       High | High            | LSP servers                       | **Keep**              | Differentiator from competitors        | Low                | None         | —                              |
| Tool      | Web fetch                   | OpenCode | `src/tool/webfetch`                 | Fetch & parse web content                                         |     Medium | Medium          | —                                 | **Keep**              | Useful for research                    | Low                | None         | —                              |
| Tool      | Web search                  | OpenCode | `src/tool/websearch`                | Web search queries                                                |     Medium | Medium          | —                                 | **Keep**              | Research capability                    | Low                | None         | —                              |
| Tool      | Task management             | OpenCode | `src/tool/task`                     | Create/update/complete tasks                                      |     Medium | Medium          | —                                 | **Keep**              | Workflow tracking                      | Low                | None         | —                              |
| Tool      | Todo read/write             | OpenCode | `src/tool/todoread`, `todowrite`    | Todo list management                                              |     Medium | Low             | —                                 | **Keep**              | Task tracking                          | Low                | None         | —                              |
| Tool      | Skill execution             | OpenCode | `src/tool/skill`                    | Run custom skills                                                 |     Medium | Medium          | —                                 | **Keep**              | Extensibility                          | Low                | None         | —                              |
| Tool      | Question/ask user           | OpenCode | `src/tool/question`                 | Ask user for input                                                |       High | High            | —                                 | **Keep**              | Interactive flow                       | Low                | None         | —                              |
| Tool      | Batch processing            | OpenCode | `src/tool/batch`                    | Batch process commands                                            |     Medium | Low             | —                                 | **Later**             | Power user feature                     | Low                | None         | —                              |
| Tool      | Plan enter/exit             | OpenCode | `src/tool/plan_enter`, `plan_exit`  | Read-only planning mode toggle                                    |     Medium | Medium          | —                                 | **Keep**              | Planning workflow                      | Low                | None         | —                              |
| Session   | Session CRUD                | OpenCode | `src/session/index.ts`              | Create, read, update, delete sessions                             |       High | Critical        | SQLite, Drizzle                   | **Keep**              | Core persistence                       | Low                | None         | 28KB module                    |
| Session   | Message V2                  | OpenCode | `src/session/message-v2.ts`         | Rich message format with attachments                              |       High | Critical        | —                                 | **Keep**              | Message representation                 | Low                | None         | 30KB module                    |
| Session   | Prompt building             | OpenCode | `src/session/prompt.ts`             | Dynamic prompt construction                                       |       High | Critical        | —                                 | **Keep**              | LLM interaction                        | Low                | None         | 72KB — largest module          |
| Session   | Session compaction          | OpenCode | `src/session/`                      | Compress conversation history                                     |       High | High            | —                                 | **Keep**              | Long conversation support              | Low                | None         | —                              |
| Session   | Session sharing             | OpenCode | `src/share/`                        | Share sessions via URL                                            |        Low | Low             | —                                 | **Later**             | Nice to have                           | Low                | None         | —                              |
| Session   | Snapshots                   | OpenCode | `src/snapshot/`                     | Save session snapshots                                            |     Medium | Medium          | —                                 | **Keep**              | Undo/revert support                    | Low                | None         | —                              |
| LSP       | LSP client                  | OpenCode | `src/lsp/`                          | Multi-server LSP management                                       |       High | High            | vscode-languageserver-types       | **Keep**              | Major differentiator                   | Medium             | None         | 66KB module                    |
| LSP       | Pyright server              | OpenCode | `src/lsp/server.ts`                 | Python language server                                            |       High | High            | pyright                           | **Keep**              | Python support                         | Low                | None         | —                              |
| LSP       | TypeScript server           | OpenCode | `src/lsp/server.ts`                 | TS/JS language server                                             |       High | High            | typescript-language-server        | **Keep**              | TS/JS support                          | Low                | None         | —                              |
| LSP       | Go server                   | OpenCode | `src/lsp/server.ts`                 | Go language server                                                |     Medium | Medium          | go-langserver                     | **Keep**              | Go support                             | Low                | None         | —                              |
| LSP       | Swift server                | OpenCode | `src/lsp/server.ts`                 | Swift language server                                             |        Low | Low             | sourcekit-lsp                     | **Later**             | Niche platform                         | Low                | None         | —                              |
| LSP       | Ruff server                 | OpenCode | `src/lsp/server.ts`                 | Python linting                                                    |     Medium | Low             | ruff                              | **Later**             | Redundant with pyright                 | Low                | None         | —                              |
| Config    | Hierarchical config         | OpenCode | `src/config/config.ts`              | 6-layer config loading                                            |       High | Critical        | —                                 | **Keep**              | Flexible deployment                    | Medium             | None         | 57KB — complex                 |
| Config    | Enterprise managed config   | OpenCode | `src/config/`                       | System-level overrides (/etc/opencode)                            |        Low | Low             | —                                 | **Later**             | Enterprise only                        | Low                | None         | —                              |
| Config    | Remote well-known           | OpenCode | `src/config/`                       | Org defaults via .well-known/opencode                             |        Low | Low             | —                                 | **Later**             | Enterprise only                        | Low                | None         | —                              |
| MCP       | MCP client                  | OpenCode | `src/mcp/`                          | MCP protocol support                                              |       High | High            | `@modelcontextprotocol/sdk`       | **Keep**              | Extensibility standard                 | Medium             | None         | 31KB module                    |
| MCP       | OAuth support               | OpenCode | `src/mcp/`                          | MCP server authentication                                         |     Medium | Medium          | —                                 | **Keep**              | Secure integrations                    | Low                | None         | —                              |
| CLI       | Core CLI                    | OpenCode | `src/cli/`                          | CLI entry point, commands                                         |       High | Critical        | yargs                             | **Keep**              | Primary interface                      | Low                | None         | —                              |
| CLI       | Account management          | OpenCode | `src/cli/commands/account`          | User accounts                                                     |        Low | Low             | —                                 | **Later**             | Console feature                        | Low                | None         | —                              |
| CLI       | GitHub integration          | OpenCode | `src/cli/commands/github`           | GitHub PR/issue ops                                               |     Medium | Medium          | Octokit                           | **Keep**              | Developer workflow                     | Low                | None         | —                              |
| CLI       | Export/Import               | OpenCode | `src/cli/commands/export`, `import` | Session portability                                               |        Low | Low             | —                                 | **Later**             | Nice to have                           | Low                | None         | —                              |
| CLI       | Stats                       | OpenCode | `src/cli/commands/stats`            | Usage statistics                                                  |        Low | Low             | —                                 | **Later**             | Nice to have                           | Low                | None         | —                              |
| TUI       | Terminal UI                 | OpenCode | opentui packages                    | SolidJS terminal UI                                               |       High | High            | @opentui/core, @opentui/solid     | **Keep**              | Primary user interface                 | Medium             | None         | Custom framework               |
| Web       | Web console                 | OpenCode | `packages/console/`                 | Web-based UI                                                      |        Low | Low             | SolidStart, Stripe                | **Later**             | Separate product                       | Medium             | None         | Payments integration           |
| Web       | Landing page                | OpenCode | `packages/web/`                     | Marketing site                                                    |        Low | Low             | —                                 | **Cut**               | Not needed for ax-code                 | Low                | None         | —                              |
| Desktop   | Tauri app                   | OpenCode | `packages/desktop/`                 | Native desktop app                                                |        Low | Low             | Tauri, Rust                       | **Later**             | Heavy to maintain                      | High               | None         | Rust build chain               |
| Desktop   | Electron app                | OpenCode | `packages/desktop-electron/`        | Electron desktop app                                              |        Low | Low             | Electron                          | **Cut**               | Redundant with Tauri                   | High               | None         | Pick one if needed             |
| SDK       | JavaScript SDK              | OpenCode | `packages/sdk/js/`                  | Embedding API                                                     |     Medium | Medium          | —                                 | **Later**             | IDE integration path                   | Low                | None         | —                              |
| Extension | Plugin system               | OpenCode | `packages/plugin/`                  | Custom agent plugins                                              |     Medium | Medium          | —                                 | **Keep**              | Extensibility                          | Low                | None         | —                              |
| Extension | Skill system                | OpenCode | `src/skill/`                        | Custom tool loading                                               |     Medium | Medium          | —                                 | **Keep**              | Extensibility                          | Low                | None         | —                              |
| Extension | Zed plugin                  | OpenCode | `packages/extensions/zed/`          | Zed editor integration                                            |        Low | Low             | —                                 | **Later**             | Niche editor                           | Low                | None         | —                              |
| Extension | Slack integration           | OpenCode | `packages/slack/`                   | Slack bot/notifications                                           |        Low | Low             | —                                 | **Later**             | Team feature                           | Low                | None         | —                              |
| Infra     | Hono HTTP server            | OpenCode | `src/server/`                       | API server                                                        |       High | High            | Hono                              | **Keep**              | Client/server arch                     | Low                | None         | —                              |
| Infra     | Event bus                   | OpenCode | `src/bus/`                          | Pub/sub messaging                                                 |     Medium | High            | —                                 | **Keep**              | Internal communication                 | Low                | None         | —                              |
| Infra     | Auth system                 | OpenCode | `src/auth/`                         | API keys, OAuth tokens                                            |       High | High            | @openauthjs/openauth              | **Keep**              | Security                               | Low                | None         | —                              |
| Infra     | Permission system           | OpenCode | `src/permission/`                   | Tool execution control                                            |       High | High            | —                                 | **Keep**              | Security                               | Low                | None         | —                              |
| Infra     | Git worktree                | OpenCode | `src/worktree/`                     | Git worktree management                                           |     Medium | Medium          | —                                 | **Keep**              | Safe parallel work                     | Low                | None         | —                              |
| Infra     | PTY support                 | OpenCode | `src/pty/`                          | Pseudo-terminal                                                   |     Medium | Medium          | bun-pty                           | **Keep**              | Terminal emulation                     | Low                | None         | —                              |
| Infra     | File watching               | OpenCode | —                                   | File system monitoring                                            |     Medium | Medium          | chokidar, @parcel/watcher         | **Keep**              | Real-time updates                      | Low                | None         | —                              |
| Infra     | ID generation               | OpenCode | `src/id/`                           | ULID-based IDs                                                    |        Low | High            | ulid                              | **Keep**              | Data integrity                         | Low                | None         | —                              |
| Docs      | Docs site                   | OpenCode | `packages/docs/`                    | Documentation website                                             |        Low | Low             | —                                 | **Later**             | Separate effort                        | Low                | Check        | Has own LICENSE file           |

---

### 4B. AX-CLI MODULES (Feature Import Candidates)

| Category   | Module / Feature               | Source | Subsystem / Folder  | What It Does                               | User Value | Tech Importance | Dependency / Provider | Keep/Cut/Later/Review | Reason                                                   | Maintenance Impact | License Risk | Notes                                             |
| ---------- | ------------------------------ | ------ | ------------------- | ------------------------------------------ | ---------: | --------------- | --------------------- | --------------------- | -------------------------------------------------------- | ------------------ | ------------ | ------------------------------------------------- |
| Provider   | Grok provider                  | ax-cli | `provider/`         | xAI Grok models with server-side tools     |       High | High            | OpenAI SDK, xAI API   | **Keep**              | Differentiated; server-side code execution, x_search     | Medium             | None (MIT)   | Most complex provider                             |
| Provider   | Grok server-side tools         | ax-cli | `provider/`         | x_search, code_execution, web_search       |       High | High            | xAI Agent Tools API   | **Keep**              | Unique capability — server-side Python sandbox           | Medium             | None         | web_search deprecated (HTTP 410)                  |
| Provider   | Grok parallel function calling | ax-cli | `provider/`         | Execute multiple tools simultaneously      |     Medium | Medium          | xAI API               | **Keep**              | Performance optimization                                 | Low                | None         | —                                                 |
| Provider   | Grok reasoning modes           | ax-cli | `provider/`         | reasoning_effort param, extended thinking  |     Medium | Medium          | xAI API               | **Keep**              | Quality control                                          | Low                | None         | 2M context fast variants                          |
| Provider   | GLM provider                   | ax-cli | `provider/`         | Z.AI GLM models                            |        Low | Low             | Z.AI API              | **Cut**               | Officially deprecated; users directed to OpenCode        | Low                | None         | Already sunset                                    |
| Provider   | Local/Ollama provider          | ax-cli | `provider/`         | Local models via Ollama/LMStudio/vLLM      |     Medium | Medium          | OpenAI-compatible API | **Review**            | OpenCode already has OpenAI-Compatible                   | Low                | None         | May be redundant                                  |
| Provider   | API key encryption             | ax-cli | config              | AES-256-GCM with PBKDF2 (600K iterations)  |       High | High            | Node crypto           | **Keep**              | Security best practice                                   | Low                | None         | No plaintext key storage                          |
| Agent      | ReAct agent mode               | ax-cli | `agent/`            | Thought → Action → Observation loops       |       High | High            | —                     | **Keep**              | Structured reasoning                                     | Low                | None         | `--react` flag                                    |
| Agent      | Self-correction                | ax-cli | `agent/`            | Auto-detect failures, reflect, retry       |       High | High            | —                     | **Keep**              | Reduces manual intervention                              | Low                | None         | Compile errors, test failures, assertions         |
| Agent      | AutomatosX agents              | ax-cli | MCP integration     | 20+ specialized AI agents                  |     Medium | Medium          | MCP, AutomatosX       | **Review**            | High value but high maintenance; start with 3-5          | High               | None         | Bob (backend), Frank (frontend), Steve (security) |
| Planning   | Task decomposition             | ax-cli | `planner/`          | Break tasks into dependency-ordered phases |       High | High            | —                     | **Keep**              | Complex task handling                                    | Low                | None         | Token estimates per phase                         |
| Planning   | Verification callbacks         | ax-cli | `planner/`          | TypeScript type checking after execution   |     Medium | Medium          | ts-morph              | **Keep**              | Quality assurance                                        | Low                | None         | —                                                 |
| Context    | AX.md system (/init)           | ax-cli | `commands/init`     | Generate single-file AI project context    |       High | High            | —                     | **Keep**              | Novel; fast project understanding                        | Low                | None         | Depth: basic/standard/full/security               |
| Context    | Context injection              | ax-cli | `memory/`           | Auto-inject project context into prompts   |       High | High            | —                     | **Keep**              | Improves response quality                                | Low                | None         | `<project-context>` tags                          |
| Context    | Memory warmup                  | ax-cli | `memory/`           | Pre-cache context before session           |     Medium | Low             | node-cache            | **Later**             | Optimization; not critical for v1                        | Low                | None         | —                                                 |
| Context    | Context stats                  | ax-cli | `memory/`           | Token usage visualization                  |        Low | Low             | —                     | **Later**             | Nice diagnostic                                          | Low                | None         | —                                                 |
| Checkpoint | Session save/restore           | ax-cli | `checkpoint/`       | Save and restore conversation points       |     Medium | Medium          | —                     | **Later**             | OpenCode has snapshots already                           | Low                | None         | May be redundant                                  |
| Checkpoint | Session rewind                 | ax-cli | `checkpoint/`       | Roll back to previous state                |     Medium | Medium          | —                     | **Later**             | OpenCode has revert already                              | Low                | None         | May be redundant                                  |
| Tool       | bash (persistent shell)        | ax-cli | `tools/`            | Terminal with background task support      |       High | High            | —                     | **Review**            | OpenCode has bash already; check if bg tasks differ      | Low                | None         | —                                                 |
| Tool       | bash-output                    | ax-cli | `tools/`            | Monitor background processes               |     Medium | Medium          | —                     | **Review**            | Unique if OpenCode lacks this                            | Low                | None         | —                                                 |
| Tool       | view-file                      | ax-cli | `tools/`            | Read files, list dirs                      |       High | High            | —                     | **Cut**               | OpenCode has read + ls already                           | Low                | None         | Redundant                                         |
| Tool       | create-file                    | ax-cli | `tools/`            | Create new files                           |       High | High            | —                     | **Cut**               | OpenCode has write already                               | Low                | None         | Redundant                                         |
| Tool       | str-replace-editor             | ax-cli | `tools/`            | Edit/replace file contents                 |       High | High            | —                     | **Cut**               | OpenCode has edit already                                | Low                | None         | Redundant                                         |
| Tool       | multi-edit                     | ax-cli | `tools/`            | Batch file edits                           |     Medium | Medium          | —                     | **Cut**               | OpenCode has multiedit already                           | Low                | None         | Redundant                                         |
| Tool       | search (ripgrep)               | ax-cli | `tools/`            | Full-text search                           |       High | High            | ripgrep-node          | **Cut**               | OpenCode has grep already                                | Low                | None         | Redundant                                         |
| Tool       | create-todo-list               | ax-cli | `tools/`            | Create todo lists                          |     Medium | Medium          | —                     | **Cut**               | OpenCode has todowrite                                   | Low                | None         | Redundant                                         |
| Tool       | update-todo-list               | ax-cli | `tools/`            | Update/mark todos                          |     Medium | Medium          | —                     | **Cut**               | OpenCode has todoread/write                              | Low                | None         | Redundant                                         |
| Tool       | ask-user                       | ax-cli | `tools/`            | Ask for user input                         |       High | High            | —                     | **Cut**               | OpenCode has question tool                               | Low                | None         | Redundant                                         |
| Tool       | ax-agent delegation            | ax-cli | `tools/`            | Delegate to specialized agents             |     Medium | Medium          | —                     | **Review**            | OpenCode has subagents but this is MCP-based             | Low                | None         | —                                                 |
| Tool       | ax-agents-parallel             | ax-cli | `tools/`            | Parallel agent delegation                  |     Medium | Medium          | —                     | **Review**            | Unique parallel dispatch                                 | Low                | None         | —                                                 |
| Design     | Design check system            | ax-cli | `design-check/`     | CSS/design token linting & auto-fix        |        Low | Low             | colord                | **Later**             | Niche (React/CSS only)                                   | Low                | None         | `.ax-cli/design.json` config                      |
| Design     | Hardcoded color detection      | ax-cli | `design-check/`     | Find & fix hardcoded colors                |        Low | Low             | —                     | **Later**             | Subset of design check                                   | Low                | None         | —                                                 |
| Design     | Spacing token enforcement      | ax-cli | `design-check/`     | Enforce design system spacing              |        Low | Low             | —                     | **Later**             | Subset of design check                                   | Low                | None         | —                                                 |
| Design     | A11y validation                | ax-cli | `design-check/`     | Alt text, form labels                      |        Low | Low             | —                     | **Later**             | Subset of design check                                   | Low                | None         | —                                                 |
| UI         | React/Ink TUI                  | ax-cli | `ui/`               | Terminal chat interface                    |     Medium | Medium          | React 19, Ink 6.5     | **Cut**               | OpenCode TUI is primary                                  | Medium             | None         | Different framework (React vs SolidJS)            |
| UI         | Diff renderer                  | ax-cli | `ui/components/`    | Visual code diffs in terminal              |     Medium | Medium          | —                     | **Review**            | Check if OpenCode has equivalent quality                 | Low                | None         | —                                                 |
| UI         | MCP dashboard                  | ax-cli | `ui/components/`    | MCP server status display                  |        Low | Low             | —                     | **Later**             | Nice to have                                             | Low                | None         | —                                                 |
| UI         | Phase progress                 | ax-cli | `ui/components/`    | Planning phase visualization               |     Medium | Low             | —                     | **Later**             | Pairs with planner                                       | Low                | None         | —                                                 |
| UI         | Context breakdown              | ax-cli | `ui/components/`    | Token usage visualization                  |        Low | Low             | —                     | **Later**             | Diagnostic                                               | Low                | None         | —                                                 |
| i18n       | 11-language support            | ax-cli | `i18n/locales/`     | Full UI localization                       |        Low | Low             | —                     | **Later**             | English MVP is fine                                      | Medium             | None         | 11 locale files to maintain                       |
| SDK        | Programmatic API               | ax-cli | `sdk/`              | Direct agent instantiation, streaming      |       High | High            | —                     | **Keep**              | 10-40x faster than CLI spawning; enables IDE integration | Low                | None         | Key for VSCode extension                          |
| SDK        | VSCode extension               | ax-cli | `vscode-extension/` | Full sidebar chat in VSCode                |     Medium | Medium          | VSCode API            | **Later**             | Start CLI-only, add later                                | Medium             | None         | Heavy to maintain                                 |
| MCP        | 12+ templates                  | ax-cli | `mcp/`              | Figma, GitHub, Vercel, Puppeteer, etc.     |        Low | Low             | —                     | **Later**             | User-driven demand first                                 | Low                | None         | Each template needs maintenance                   |
| MCP        | Auto-discovery                 | ax-cli | `mcp/`              | Find local MCP servers automatically       |     Medium | Medium          | —                     | **Review**            | Convenience feature                                      | Low                | None         | —                                                 |
| Security   | Guard system                   | ax-cli | `guard/`            | Access control gates                       |     Medium | Medium          | —                     | **Review**            | OpenCode has permissions; compare                        | Low                | None         | —                                                 |
| Security   | Approval manager               | ax-cli | `permissions/`      | User approval for dangerous ops            |     Medium | Medium          | —                     | **Review**            | OpenCode has permissions; compare                        | Low                | None         | —                                                 |
| Commands   | /init (AX.md)                  | ax-cli | `commands/`         | Generate project context                   |       High | High            | —                     | **Keep**              | Novel high-value feature                                 | Low                | None         | —                                                 |
| Commands   | /model                         | ax-cli | `commands/`         | Switch models                              |     Medium | Medium          | —                     | **Cut**               | OpenCode has model switching                             | Low                | None         | Redundant                                         |
| Commands   | /lang                          | ax-cli | `commands/`         | Change language                            |        Low | Low             | —                     | **Cut**               | Depends on i18n, which is deferred                       | Low                | None         | —                                                 |
| Commands   | /doctor                        | ax-cli | `commands/`         | System health check                        |     Medium | Medium          | —                     | **Review**            | Useful diagnostic                                        | Low                | None         | —                                                 |
| IPC        | Inter-process comm             | ax-cli | `ipc/`              | IPC layer                                  |        Low | Medium          | —                     | **Later**             | Needed for IDE integration                               | Low                | None         | —                                                 |
| Schemas    | Zod SSOT types                 | ax-cli | `packages/schemas/` | Centralized type definitions               |     Medium | High            | Zod                   | **Review**            | Good pattern; OpenCode uses Zod too                      | Low                | None         | Could inform ax-code schema design                |

---

## 5. TOP HIGH-VALUE AX-CLI FEATURES TO KEEP

**Priority 1 — Import into ax-code v1:**

| #   | Feature                               | Why It's High-Value                                                                                                                 | Migration Complexity                                     |
| --- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | **Grok provider + server-side tools** | Unique: server-side Python sandbox (code_execution), X/Twitter search (x_search), parallel function calling. No other CLI has this. | Medium — needs adapter from OpenAI SDK to Vercel AI SDK  |
| 2   | **AX.md project context system**      | Novel: single-command project understanding with depth levels. Auto-injects context. Nothing equivalent in OpenCode.                | Low — self-contained /init command                       |
| 3   | **Self-correction agent**             | Automatic failure detection + reflection + retry. Reduces manual intervention significantly.                                        | Low — logic layer, framework-agnostic                    |
| 4   | **ReAct agent mode**                  | Structured reasoning (Thought → Action → Observation). Improves complex task success rate.                                          | Low — pattern overlay on existing agent                  |
| 5   | **Planning/task decomposition**       | Breaks complex tasks into dependency-ordered phases with token estimates and verification.                                          | Medium — needs integration with OpenCode's session/agent |
| 6   | **Programmatic SDK**                  | 10-40x faster than CLI spawning. Enables IDE integrations without subprocess overhead.                                              | Medium — API surface design needed                       |
| 7   | **API key encryption**                | AES-256-GCM with PBKDF2. No plaintext API keys on disk. Security best practice.                                                     | Low — standalone crypto module                           |
| 8   | **Grok reasoning modes**              | Extended thinking, 2M context fast variants, reasoning_effort control.                                                              | Low — provider config parameters                         |

**Priority 2 — Import into ax-code v2:**

| #   | Feature                        | Why                                                                     | Complexity                    |
| --- | ------------------------------ | ----------------------------------------------------------------------- | ----------------------------- |
| 9   | **AutomatosX agents (subset)** | Start with 3-5 core agents (backend, frontend, security). Expand later. | Low — MCP-based, configurable |
| 10  | **Design check system**        | CSS/design linting with auto-fix. Useful for frontend teams.            | Low — self-contained module   |
| 11  | **VSCode extension**           | IDE integration via SDK.                                                | High — separate product       |
| 12  | **MCP auto-discovery**         | Convenience for MCP users.                                              | Low — discovery logic         |

---

## 6. FEATURES / PACKAGES / PROVIDERS TO CUT

### Providers to Cut (from OpenCode's 20+)

| Provider              | Reason                                            | Impact |
| --------------------- | ------------------------------------------------- | ------ |
| DeepInfra             | Low differentiation; OpenRouter covers it         | None   |
| Cerebras              | Very niche; tiny user base                        | None   |
| Cohere                | Low coding relevance                              | None   |
| Together AI           | OpenRouter covers it                              | None   |
| Perplexity            | Niche; not a coding model                         | None   |
| Vercel Gateway        | Vendor-specific routing; OpenRouter is better     | None   |
| GitLab AI             | Very niche; GitLab-specific                       | None   |
| Poe                   | Very niche; custom auth complexity                | None   |
| **GLM (from ax-cli)** | Officially deprecated; users directed to OpenCode | None   |

**Result:** Cut 9 providers → Keep ~8 core providers. **Maintenance reduction: ~45% fewer providers.**

### Packages to Cut (from OpenCode)

| Package                        | Reason                                   |
| ------------------------------ | ---------------------------------------- |
| `packages/web/` (landing page) | Marketing site, not product              |
| `packages/desktop-electron/`   | Redundant with Tauri; pick one if needed |
| `packages/storybook/`          | Internal dev tool                        |
| `packages/enterprise/`         | Separate product concern                 |
| `src/control-plane/`           | Multi-tenant; not needed for single-user |
| SST/Wrangler config            | Cloud deploy infrastructure              |

### ax-cli Modules to Cut (redundant with OpenCode)

| Module                        | Reason                                     |
| ----------------------------- | ------------------------------------------ |
| All 11 file/search/bash tools | OpenCode has equivalent or better versions |
| React/Ink TUI                 | OpenCode's SolidJS TUI is primary          |
| /model command                | OpenCode has model switching               |
| /lang command                 | i18n deferred                              |
| GLM provider                  | Deprecated                                 |

---

## 7. FEATURES / PACKAGES / PROVIDERS TO DEFER

### Providers — Defer to Later

| Provider                | Reason                    | When                      |
| ----------------------- | ------------------------- | ------------------------- |
| Google Vertex           | Enterprise-only path      | v2 (if enterprise demand) |
| Google Vertex Anthropic | Enterprise-only path      | v2 (if enterprise demand) |
| Azure OpenAI            | Corp compliance path      | v2 (if enterprise demand) |
| Amazon Bedrock          | AWS-only path             | v2 (if enterprise demand) |
| Mistral                 | Low demand                | v2 (if requested)         |
| Groq                    | Speed niche only          | v2 (if requested)         |
| GitHub Copilot          | Complex auth; custom impl | v2                        |

### Features — Defer to Later

| Feature                   | Source   | Reason                         | When |
| ------------------------- | -------- | ------------------------------ | ---- |
| Web console               | OpenCode | Separate product; needs Stripe | v2+  |
| Desktop app (Tauri)       | OpenCode | Heavy build chain (Rust)       | v2+  |
| Session sharing           | OpenCode | Nice to have, not critical     | v2   |
| Enterprise managed config | OpenCode | Enterprise only                | v2   |
| Remote well-known config  | OpenCode | Enterprise only                | v2   |
| Account management        | OpenCode | Console feature                | v2   |
| Export/Import             | OpenCode | Nice to have                   | v2   |
| Stats command             | OpenCode | Nice to have                   | v2   |
| Swift LSP                 | OpenCode | Niche platform                 | v2   |
| Ruff LSP                  | OpenCode | Overlaps pyright               | v2   |
| Zed extension             | OpenCode | Niche editor                   | v2   |
| Slack integration         | OpenCode | Team feature                   | v2   |
| JavaScript SDK            | OpenCode | IDE integration                | v2   |
| Batch tool                | OpenCode | Power user feature             | v2   |
| Memory warmup             | ax-cli   | Optimization                   | v2   |
| Context stats             | ax-cli   | Diagnostic                     | v2   |
| Checkpoint system         | ax-cli   | OpenCode has snapshots         | v2   |
| Design check              | ax-cli   | Niche (CSS only)               | v2   |
| i18n (11 languages)       | ax-cli   | English MVP first              | v2   |
| VSCode extension          | ax-cli   | Start CLI only                 | v2   |
| MCP templates (12+)       | ax-cli   | User-driven demand             | v2   |
| IPC layer                 | ax-cli   | Needed for IDE only            | v2   |
| Phase progress UI         | ax-cli   | Pairs with planner             | v2   |

---

## 8. LICENSE RISK SUMMARY

| Item                      | License          | Owner                 | Risk Level | Notes                                                                                                                                                  |
| ------------------------- | ---------------- | --------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OpenCode repo**         | MIT              | opencode (anomalyco)  | **Low**    | Standard MIT, permissive                                                                                                                               |
| **ax-cli repo**           | MIT              | DEFAI Private Limited | **Low**    | Standard MIT, permissive                                                                                                                               |
| **OpenCode docs package** | Separate LICENSE | Unknown               | **Review** | Has its own LICENSE file — verify terms before including docs                                                                                          |
| **Vercel AI SDK**         | Apache-2.0       | Vercel                | **Low**    | Permissive; compatible with MIT                                                                                                                        |
| **OpenAI SDK**            | Apache-2.0       | OpenAI                | **Low**    | Permissive; compatible                                                                                                                                 |
| **Effect.io**             | MIT              | Effect-TS             | **Low**    | —                                                                                                                                                      |
| **Drizzle ORM**           | Apache-2.0       | Drizzle Team          | **Low**    | Beta version — stability risk, not license risk                                                                                                        |
| **SolidJS**               | MIT              | SolidJS               | **Low**    | —                                                                                                                                                      |
| **React**                 | MIT              | Meta                  | **Low**    | —                                                                                                                                                      |
| **Ink**                   | MIT              | Vadim Demedes         | **Low**    | —                                                                                                                                                      |
| **Tauri**                 | MIT/Apache-2.0   | Tauri Programme       | **Low**    | Dual-licensed                                                                                                                                          |
| **Electron**              | MIT              | OpenJS Foundation     | **Low**    | —                                                                                                                                                      |
| **Hono**                  | MIT              | Yusuke Wada           | **Low**    | —                                                                                                                                                      |
| **MCP SDK**               | MIT              | Anthropic             | **Low**    | —                                                                                                                                                      |
| **@openauthjs/openauth**  | MIT              | OpenAuth              | **Low**    | v0.0.0-latest — stability concern                                                                                                                      |
| **tree-sitter**           | MIT              | Max Brunsfeld         | **Low**    | Native bindings                                                                                                                                        |
| **ts-morph**              | MIT              | David Sherret         | **Low**    | —                                                                                                                                                      |
| **Patched packages**      | Various          | Various               | **Review** | 4 patches in OpenCode (solid-js, standard-openapi, openrouter, xai) — patches may diverge from upstream license terms if modifications are substantial |
| **models.dev**            | Unknown          | Unknown               | **Review** | External service dependency — verify ToS for model metadata usage                                                                                      |

### License Action Items

1. **Verify** `packages/docs/LICENSE` terms before including documentation
2. **Review** patched dependency licenses — custom patches may create derivative works
3. **Check** models.dev terms of service for model registry data usage
4. **Document** all third-party licenses in ax-code NOTICE file (Apache-2.0 requires this)
5. **No copyleft (GPL) dependencies detected** in either repo — low viral license risk

---

## 9. RECOMMENDATION: WHAT AX-CODE V1 SHOULD INCLUDE

### Core Platform (from OpenCode)

| Layer             | What to Include                                                                         |
| ----------------- | --------------------------------------------------------------------------------------- |
| **Runtime**       | Bun-based TypeScript, Effect.io service architecture                                    |
| **Agent**         | Multi-agent system with modes, permissions, model selection                             |
| **Providers (8)** | Anthropic, OpenAI, Google, XAI/Grok, OpenRouter, OpenAI-Compatible, + 2 review slots    |
| **Tools (20+)**   | All file ops, search, bash, LSP, web fetch/search, tasks, todos, skills, question, plan |
| **Session**       | SQLite persistence, message-v2, prompt building, compaction, snapshots                  |
| **LSP**           | Pyright (Python), TypeScript, Go language servers                                       |
| **Config**        | Project-level + global + env var config (defer enterprise layers)                       |
| **MCP**           | Full MCP client with SSE/stdio/HTTP, OAuth                                              |
| **CLI**           | Core commands, GitHub integration, model/provider management                            |
| **TUI**           | SolidJS terminal UI (primary interface)                                                 |
| **Server**        | Hono HTTP API                                                                           |
| **Security**      | Permission system, auth, encrypted key storage (from ax-cli)                            |
| **Infra**         | Event bus, file watching, git worktree, PTY, ID generation                              |

### High-Value Imports (from ax-cli)

| Feature                    | Integration Approach                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| **Grok server-side tools** | Add as provider extension — x_search, code_execution, parallel calling |
| **AX.md context system**   | Port as new `/init` command — self-contained module                    |
| **Self-correction agent**  | Add as agent behavior — failure detection + reflection loop            |
| **ReAct mode**             | Add as agent mode — Thought/Action/Observation pattern                 |
| **Planning/decomposition** | Add as planner module — dependency ordering, verification              |
| **API key encryption**     | Add to auth module — AES-256-GCM key storage                           |
| **Programmatic SDK**       | Port SDK interface — enables future IDE extensions                     |

### Estimated Scope

| Metric            | Count        |
| ----------------- | ------------ |
| Categories        | 14           |
| Modules (Keep)    | ~55          |
| Modules (Cut)     | ~25          |
| Modules (Later)   | ~30          |
| Modules (Review)  | ~15          |
| Providers (Keep)  | 6-8          |
| Providers (Cut)   | 9            |
| Providers (Later) | 7            |
| Tools (Keep)      | 20+          |
| New from ax-cli   | 7-8 features |

### Suggested Implementation Order

1. **Phase 1** — Fork OpenCode, strip cut items, rebrand to ax-code
2. **Phase 2** — Trim providers to core 6-8, remove enterprise/console/desktop packages
3. **Phase 3** — Import AX.md context system (lowest risk, highest standalone value)
4. **Phase 4** — Import self-correction + ReAct agent modes
5. **Phase 5** — Import Grok server-side tools (needs AI SDK adapter work)
6. **Phase 6** — Import planning/decomposition system
7. **Phase 7** — Add API key encryption to auth
8. **Phase 8** — Port SDK interface for programmatic access

---

_This document is the first deliverable. All classifications are based on actual repo structure, source code, package manifests, and documentation — no features were invented. Ready for team review and Keep/Cut/Later decision finalization._
