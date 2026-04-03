# Product Requirements Document (PRD)
# ax-code Revamp — v1.0

**Document Version:** 1.0
**Date:** 2026-03-25
**Author:** Engineering Team
**Status:** Draft — Pending Stakeholder Approval

---

## 1. Overview

### 1.1 Product Name
**ax-code** — The open source AI coding agent

### 1.2 One-Line Description
ax-code is a provider-agnostic, LSP-first AI coding CLI that combines OpenCode's mature platform with ax-cli's high-value differentiators (Grok server-side tools, AX.md context system, planning/self-correction).

### 1.3 Problem Statement
The AI coding tool market has two extremes:
- **Vendor-locked tools** (Claude Code, GitHub Copilot CLI) — tied to a single provider
- **Fragmented open-source tools** — many providers but poor quality, no LSP, no planning

ax-code bridges this gap: production-quality, provider-agnostic, with unique capabilities no competitor offers.

### 1.4 Target Users
| Persona | Description | Primary Need |
|---------|-------------|-------------|
| **Professional Developer** | Full-time engineer using CLI daily | Fast, reliable AI coding assistant across providers |
| **Team Lead / Architect** | Evaluates tools for team adoption | Provider flexibility, security, enterprise paths |
| **Open Source Contributor** | Builds on top of ax-code | Extensibility (plugins, MCP, SDK) |
| **Local-First Developer** | Runs models locally (Ollama, LMStudio) | OpenAI-Compatible provider support |

---

## 2. Goals & Success Criteria

### 2.1 Goals
| # | Goal | Metric |
|---|------|--------|
| G1 | Ship ax-code v1 with clean OpenCode base | All tests pass, 6-8 providers working |
| G2 | Integrate top 5 ax-cli features | AX.md, self-correction, ReAct, planning, key encryption all functional |
| G3 | Reduce maintenance surface by 45% | 20+ providers → 6-8, 20 packages → ~10 |
| G4 | Zero license compliance issues | NOTICE file, all licenses verified |
| G5 | Establish ax-code brand identity | CLI binary, config paths, docs all rebranded |

### 2.2 Non-Goals (Explicitly Out of Scope for v1)
- Web Console with Stripe billing
- Desktop app (Tauri or Electron)
- Enterprise managed config / control plane
- VSCode extension shipping
- Full i18n (11 languages)
- AutomatosX agents (beyond 3-5 core)
- Design check system (CSS linting)

---

## 3. Requirements

### 3.1 Functional Requirements

#### 3.1.1 Core Platform (from OpenCode — Keep As-Is)

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-01 | Multi-agent system with modes (build/plan/general), permissions, model selection | P0 | OpenCode |
| FR-02 | 20+ tools: file ops (read/write/edit/patch), search (glob/grep/codesearch), bash, LSP, web fetch/search, tasks, todos, skills, question, plan | P0 | OpenCode |
| FR-03 | SQLite-backed session persistence with message-v2 format, compaction, and snapshots | P0 | OpenCode |
| FR-04 | LSP integration with multi-server support (Pyright, TypeScript, Go) | P0 | OpenCode |
| FR-05 | MCP client with SSE/stdio/HTTP transports and OAuth | P0 | OpenCode |
| FR-06 | SolidJS terminal UI (TUI) as primary interface | P0 | OpenCode |
| FR-07 | Hono HTTP API server (client/server architecture) | P0 | OpenCode |
| FR-08 | Permission system for tool execution control | P0 | OpenCode |
| FR-09 | Hierarchical configuration (project + global + env vars) | P0 | OpenCode |
| FR-10 | Git worktree management for safe parallel work | P1 | OpenCode |
| FR-11 | Event bus (pub/sub internal messaging) | P1 | OpenCode |
| FR-12 | PTY support for terminal emulation | P1 | OpenCode |
| FR-13 | Plugin system for custom agent plugins | P1 | OpenCode |
| FR-14 | Skill system for custom tool loading | P1 | OpenCode |
| FR-15 | GitHub integration (PR/issue operations) | P1 | OpenCode |

#### 3.1.2 Providers (Trimmed)

| ID | Provider | Priority | Package | Status |
|----|----------|----------|---------|--------|
| PR-01 | OpenAI (GPT-4, GPT-4.5) | P0 | `@ai-sdk/openai` | Keep |
| PR-02 | Google (Gemini) | P0 | `@ai-sdk/google` | Keep |
| PR-03 | XAI/Grok | P0 | `@ai-sdk/xai` | Keep |
| PR-04 | OpenRouter (multi-provider) | P0 | `@openrouter/ai-sdk-provider` | Keep |
| PR-05 | OpenAI-Compatible (Ollama, LMStudio, vLLM) | P0 | `@ai-sdk/openai-compatible` | Keep |
| PR-06 | Google Vertex | P2 | `@ai-sdk/google-vertex` | Review |
| PR-07 | Azure OpenAI | P2 | `@ai-sdk/azure` | Review |
| PR-08 | Amazon Bedrock | P2 | `@ai-sdk/amazon-bedrock` | Review |
| PR-09 | Mistral | P2 | `@ai-sdk/mistral` | Later |
| PR-10 | Groq | P2 | `@ai-sdk/groq` | Later |
| PR-11 | GitHub Copilot | P2 | Custom SDK | Review |

**Cut (9 providers):** DeepInfra, Cerebras, Cohere, Together AI, Perplexity, Vercel Gateway, GitLab AI, Poe, GLM

#### 3.1.3 New Features (from ax-cli)

| ID | Feature | Priority | Description | Migration Complexity |
|----|---------|----------|-------------|---------------------|
| NF-01 | **AX.md context system** | P0 | `/init` command generates single-file AI project context with depth levels (basic/standard/full/security). Auto-injects into prompts via `<project-context>` tags. | Low |
| NF-02 | **Self-correction agent** | P0 | Automatic failure detection (compile errors, test failures, assertions) → reflection → retry loop. Reduces manual intervention. | Low |
| NF-03 | **ReAct agent mode** | P0 | Structured reasoning: Thought → Action → Observation loops. `--react` flag. Improves complex task success rate. | Low |
| NF-04 | **API key encryption** | P0 | AES-256-GCM with PBKDF2 (600K iterations). No plaintext API keys stored on disk. | Low |
| NF-05 | **Planning/task decomposition** | P1 | Break complex tasks into dependency-ordered phases with token estimates. TypeScript verification callbacks via ts-morph. | Medium |
| NF-06 | **Grok server-side tools** | P1 | x_search (X/Twitter search), code_execution (server-side Python sandbox), parallel function calling. Adapter from OpenAI SDK → Vercel AI SDK. | Medium |
| NF-07 | **Grok reasoning modes** | P1 | reasoning_effort parameter, extended thinking, 2M context fast variants. | Low |
| NF-08 | **Programmatic SDK** | P2 | Direct agent instantiation + streaming. 10-40x faster than CLI spawning. Enables future IDE extensions. | Medium |

#### 3.1.4 Rebranding

| ID | Requirement | Priority |
|----|-------------|----------|
| BR-01 | Rename root package `opencode` → `ax-code` | P0 |
| BR-02 | Update CLI binary name | P0 |
| BR-03 | Update config paths (`~/.opencode` → `~/.ax-code`) | P0 |
| BR-04 | Update all internal string references | P0 |
| BR-05 | Update README.md and translated READMEs | P1 |
| BR-06 | Update AGENTS.md, CONTRIBUTING.md, SECURITY.md | P1 |

### 3.2 Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-01 | Startup time | < 500ms to first prompt |
| NFR-02 | Provider response streaming | Real-time token streaming for all kept providers |
| NFR-03 | Session storage | SQLite, no data loss on crash |
| NFR-04 | Security | No plaintext API keys, permission-gated tool execution |
| NFR-05 | License compliance | MIT base, NOTICE file for Apache-2.0 deps, no GPL |
| NFR-06 | Platform support | macOS, Linux, Windows (via Bun) |
| NFR-07 | Package manager | Bun 1.3.11+ |
| NFR-08 | Node compatibility | Bun + Node adapter for SQLite |

---

## 4. Architecture Overview

### 4.1 System Architecture (Retained from OpenCode)

```
┌─────────────────────────────────────────────────┐
│                   ax-code CLI                    │
├─────────────────────────────────────────────────┤
│  TUI (SolidJS + opentui)  │  CLI Commands       │
├─────────────────────────────────────────────────┤
│              Hono HTTP API Server                │
├──────────┬──────────┬──────────┬────────────────┤
│  Agent   │ Session  │  Tools   │  MCP Client    │
│  System  │ Manager  │ Registry │                │
├──────────┴──────────┴──────────┴────────────────┤
│           Provider Abstraction Layer             │
│     (Vercel AI SDK — 6-8 core providers)         │
├─────────────────────────────────────────────────┤
│  Config  │ Auth/Perms │ Storage │ LSP │ Event Bus│
├─────────────────────────────────────────────────┤
│          SQLite (Drizzle ORM) │ File System      │
└─────────────────────────────────────────────────┘
```

### 4.2 New Components (from ax-cli)

```
┌─────────────────────────────────────────────────┐
│              ax-cli Feature Imports              │
├──────────┬──────────┬──────────┬────────────────┤
│  AX.md   │ Planner  │ Self-    │ API Key        │
│ Context  │ Module   │ Correct  │ Encryption     │
│ (/init)  │          │ + ReAct  │ (AES-256-GCM)  │
├──────────┴──────────┴──────────┴────────────────┤
│        Grok Server-Side Tools Adapter            │
│    (x_search, code_execution, parallel calls)    │
└─────────────────────────────────────────────────┘
```

### 4.3 Monorepo Structure (Post-Trim)

```
ax-code/
├── packages/
│   ├── opencode/          # Core CLI application (renamed internally)
│   │   └── src/
│   │       ├── agent/     # + self-correction, ReAct mode
│   │       ├── provider/  # Trimmed to 6-8 providers
│   │       ├── tool/      # 20+ tools (unchanged)
│   │       ├── session/   # + AX.md context injection
│   │       ├── planner/   # NEW — from ax-cli
│   │       ├── context/   # NEW — AX.md system
│   │       ├── lsp/       # Unchanged
│   │       ├── mcp/       # Unchanged
│   │       ├── config/    # Simplified (no enterprise layers)
│   │       ├── auth/      # + API key encryption
│   │       └── ...
│   ├── app/               # Shared web UI components (keep for future)
│   ├── ui/                # UI component library
│   ├── util/              # Utilities
│   ├── plugin/            # Plugin system
│   ├── sdk/js/            # JavaScript SDK (v2)
│   ├── containers/        # Docker definitions
│   └── docs/              # Documentation assets
├── docs/                  # Migration review, PRD, ADR
├── sdks/vscode/           # VSCode extension (v2)
├── specs/                 # API specifications
└── patches/               # Dependency patches
```

**Removed:**
- `packages/web/` (landing page)
- `packages/desktop-electron/` (redundant)
- `packages/storybook/` (internal tool)
- `packages/enterprise/` (separate product)
- `packages/console/` (deferred — discuss)
- `packages/desktop/` (deferred — discuss)
- `infra/` (cloud deploy — discuss)

---

## 5. Implementation Phases

### Phase 1: Foundation (Target: Week 1-2)
**Goal:** Clean, trimmed, rebranded ax-code baseline

| Deliverable | Description |
|-------------|-------------|
| Rebranded repo | All references updated from opencode → ax-code |
| Trimmed packages | 6 packages removed, workspaces updated |
| Trimmed providers | 9 providers removed, deps cleaned |
| Clean baseline | All existing tests pass |
| Updated docs | AGENTS.md, CONTRIBUTING.md, README.md reflect ax-code |
| NOTICE file | Apache-2.0 compliance |

### Phase 2: Core Integrations (Target: Week 3-5)
**Goal:** ax-cli's unique features integrated and working

| Deliverable | Description |
|-------------|-------------|
| AX.md system | `/init` command, depth levels, context injection |
| Self-correction | Agent failure detection + reflection + retry |
| ReAct mode | `--react` flag, Thought/Action/Observation loops |
| API key encryption | AES-256-GCM key storage in auth module |
| Planning system | Task decomposition, dependency ordering, verification |

### Phase 3: Advanced Features (Target: Week 6+)
**Goal:** Full differentiating feature set

| Deliverable | Description |
|-------------|-------------|
| Grok server-side tools | x_search, code_execution via Vercel AI SDK adapter |
| Programmatic SDK | Direct agent instantiation, streaming API |
| AutomatosX agents (3-5) | MCP-based specialized agents |
| Enterprise providers | Vertex, Azure, Bedrock (if approved) |

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Grok SDK adapter doesn't work cleanly with Vercel AI SDK | Medium | High | Prototype adapter early; fallback to custom provider |
| Package pruning breaks cross-package dependencies | Low | Medium | Map dependency graph before deleting; run tests after each removal |
| Rebranding misses internal references | Low | Low | grep -r "opencode" before shipping |
| models.dev goes down | Low | Medium | Build offline model catalog fallback |
| Patched dependencies break on update | Medium | Medium | Pin versions; document patch rationale |
| ax-cli features conflict with OpenCode architecture | Low | High | Port logic, not framework; adapt to OpenCode patterns |

---

## 7. Open Questions (Require Stakeholder Input)

| # | Question | Options | Impact of Decision |
|---|----------|---------|-------------------|
| 1 | Enterprise cloud providers for v1? | Keep / Defer | Scope +3 providers if kept |
| 2 | GitHub Copilot provider? | Keep / Defer | Complex auth if kept |
| 3 | Desktop app (Tauri) in repo? | Keep code / Remove entirely | Build chain if kept |
| 4 | Web Console in repo? | Keep code / Remove entirely | Stripe deps if kept |
| 5 | SST infrastructure config? | Keep / Remove | Cloud deploy if kept |
| 6 | Which AutomatosX agents? | List top 3-5 | Maintenance scope |
| 7 | Programmatic SDK in v1? | v1 / v2 | IDE extension timeline |
| 8 | Branding depth? | Name only / Full visual | Design effort |

---

## 8. Dependencies

| Dependency | Version | License | Risk |
|------------|---------|---------|------|
| Bun | 1.3.11 | MIT | Low |
| TypeScript | 5.8.2 | Apache-2.0 | Low |
| Vercel AI SDK (`ai`) | 5.0.124 | Apache-2.0 | Low |
| SolidJS | 1.9.10 | MIT | Low (patched) |
| Drizzle ORM | 1.0.0-beta.19 | Apache-2.0 | Low (beta stability) |
| Hono | 4.10.7 | MIT | Low |
| MCP SDK | 1.25.2 | MIT | Low |
| Effect.io | Latest | MIT | Low |

---

## 9. Acceptance Criteria for v1 Ship

- [ ] All 6-8 core providers connect and return responses
- [ ] All 20+ tools function correctly
- [ ] TUI launches and is fully interactive
- [ ] Sessions persist across restarts (SQLite)
- [ ] LSP integration works for Python, TypeScript, Go
- [ ] MCP client connects to external servers
- [ ] AX.md `/init` generates project context at all depth levels
- [ ] Self-correction agent detects and retries on failures
- [ ] ReAct mode produces structured reasoning
- [ ] API keys are encrypted at rest (no plaintext)
- [ ] Planning system decomposes complex tasks
- [ ] All existing OpenCode tests pass
- [ ] CLI binary is named `ax-code`
- [ ] Config path is `~/.ax-code`
- [ ] NOTICE file lists all Apache-2.0 dependencies
- [ ] No GPL dependencies in dependency tree
- [ ] README.md accurately describes ax-code

---

*This PRD is based on the migration review document (2026-03-24) and actual codebase analysis. No features were invented. All classifications reference real modules, files, and packages.*
