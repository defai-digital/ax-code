# ADR-001: ax-code Revamp — Architecture Decision Record

**Status:** Proposed
**Date:** 2026-03-25
**Deciders:** Engineering Team, Leadership
**Supersedes:** None

---

## Context

We are building **ax-code**, a new AI coding CLI product. Two existing codebases are available:

1. **OpenCode** (github.com/anomalyco/opencode) — A mature, provider-agnostic AI coding platform with 20+ LLM providers, 25+ tools, LSP integration, SolidJS TUI, SQLite sessions, MCP support, and enterprise infrastructure. ~36K LOC, MIT licensed.

2. **ax-cli** (github.com/defai-digital/ax-cli) — A focused AI coding CLI with unique capabilities: Grok server-side tools (x_search, code_execution), AX.md project context system, planning/self-correction, programmatic SDK, 20+ AutomatosX agents. ~337 files, MIT licensed.

The business decision is that ax-code should use OpenCode as the primary base and selectively integrate high-value features from ax-cli.

The key tension is: **how much of each codebase to include, and what to remove to keep maintenance manageable.**

---

## Decision

### AD-1: Use OpenCode as the base, not ax-cli

**Decision:** Fork OpenCode as the foundation. Port selected ax-cli features into it.

**Rationale:**
- OpenCode has 10x the codebase maturity (~36K LOC vs ~337 files)
- OpenCode already has: provider abstraction (Vercel AI SDK), LSP, MCP, SQLite sessions, permissions, multi-agent, 25+ tools
- Rebuilding these on ax-cli's React/Ink/OpenAI SDK stack would take months
- ax-cli's unique features (AX.md, self-correction, ReAct, planning) are portable as logic modules — they don't depend on ax-cli's framework

**Alternatives considered:**
- **ax-cli as base, import OpenCode features** — Rejected. Would require rewriting provider abstraction, LSP, MCP, session management, TUI, and 25+ tools. 3-6 month effort vs 1-2 months.
- **Clean-room rewrite** — Rejected. No business justification when OpenCode already works.
- **Maintain both as separate products** — Rejected. Duplicated effort, brand confusion.

**Consequences:**
- ax-code inherits OpenCode's tech stack: Bun, SolidJS, Vercel AI SDK, SQLite/Drizzle, Hono, Effect.io
- ax-cli's React/Ink UI components cannot be directly reused (different framework)
- ax-cli features must be adapted to OpenCode's patterns (Effect.io services, Zod schemas, etc.)

---

### AD-2: Trim providers from 20+ to 6-8 core

**Decision:** Keep 6 core providers (Anthropic, OpenAI, Google, XAI/Grok, OpenRouter, OpenAI-Compatible). Cut 9 providers. Defer 7 providers (enterprise cloud + niche) to v2.

**Rationale:**
- 6 core providers cover >95% of users:
  - Anthropic + OpenAI + Google = top 3 commercial providers
  - XAI/Grok = differentiator (server-side tools)
  - OpenRouter = catches all others via routing (DeepInfra, Together, Perplexity, etc.)
  - OpenAI-Compatible = covers all local models (Ollama, LMStudio, vLLM)
- The 9 cut providers have low user demand and are covered by OpenRouter
- Each provider adds ~500-2000 lines of maintenance surface
- 45% reduction in provider maintenance

**Cut providers:**
| Provider | Reason |
|----------|--------|
| DeepInfra | OpenRouter covers it |
| Cerebras | Very niche, tiny user base |
| Cohere | Low coding relevance |
| Together AI | OpenRouter covers it |
| Perplexity | Not a coding model |
| Vercel Gateway | Vendor-specific; OpenRouter is better |
| GitLab AI | Very niche; GitLab-specific |
| Poe | Very niche; complex custom auth |
| GLM (from ax-cli) | Officially deprecated |

**Deferred providers (v2, pending demand):**
Google Vertex, Google Vertex Anthropic, Azure OpenAI, Amazon Bedrock, Mistral, Groq, GitHub Copilot

**Consequences:**
- Users of cut providers must use OpenRouter instead (no functionality loss, different auth)
- Enterprise users needing Vertex/Azure/Bedrock must wait for v2 or use OpenRouter
- Reduced CI/testing burden

---

### AD-3: Import 7 high-value features from ax-cli

**Decision:** Port the following ax-cli features into ax-code, in priority order:

| # | Feature | Integration Point | Complexity |
|---|---------|-------------------|-----------|
| 1 | AX.md context system (/init) | New command + prompt injection | Low |
| 2 | Self-correction agent | Agent behavior layer | Low |
| 3 | ReAct agent mode | Agent mode overlay | Low |
| 4 | API key encryption (AES-256-GCM) | Auth module | Low |
| 5 | Planning/task decomposition | New planner module | Medium |
| 6 | Grok server-side tools | Provider extension + SDK adapter | Medium |
| 7 | Programmatic SDK | New SDK interface | Medium |

**Rationale:**
- These 7 features are ax-cli's genuine differentiators — nothing equivalent exists in OpenCode
- They are architecturally portable (logic modules, not framework-coupled)
- They provide clear user value that competitors lack
- Combined migration complexity is manageable (4 Low + 3 Medium)

**Features NOT imported from ax-cli:**
| Feature | Reason |
|---------|--------|
| 11 file/search/bash tools | OpenCode has equivalent or better versions |
| React/Ink TUI | Wrong framework (SolidJS is primary) |
| Checkpoint system | OpenCode has snapshots/revert |
| i18n (11 languages) | English MVP sufficient |
| Design check (CSS linting) | Too niche for v1 |
| 12+ MCP templates | Wait for user demand |
| /model, /lang commands | OpenCode has equivalents |

**Consequences:**
- Phase 2 development focused on feature porting
- ax-cli tools/UI are reference-only, not ported
- AX.md system needs adaptation to OpenCode's prompt builder (72KB module)
- Grok tools need OpenAI SDK → Vercel AI SDK adapter (most complex item)

---

### AD-4: Remove enterprise/console/desktop packages from v1

**Decision:** Remove or defer the following packages:

| Package | Action | Reason |
|---------|--------|--------|
| `packages/web/` | **Remove** | Marketing landing page, not product |
| `packages/desktop-electron/` | **Remove** | Redundant with Tauri |
| `packages/storybook/` | **Remove** | Internal dev tool only |
| `packages/enterprise/` | **Remove** | Separate product concern |
| `src/control-plane/` | **Remove** | Multi-tenant, not needed for single-user CLI |
| `packages/console/` | **Defer (discuss)** | Has Stripe billing — confirm if v2 or cut |
| `packages/desktop/` | **Defer (discuss)** | Tauri desktop — confirm if v2 or cut |
| `infra/` | **Defer (discuss)** | SST/Cloudflare deploy — confirm if needed |

**Rationale:**
- ax-code v1 is a CLI product, not a platform
- Enterprise, console, and desktop are separate products with different deployment models
- Each adds significant build chain complexity (Rust for Tauri, Stripe for billing, Cloudflare Workers for infra)
- Removing them reduces monorepo packages from ~20 to ~10

**Consequences:**
- ax-code v1 ships as CLI-only
- Desktop and web console are v2+ features
- Enterprise features require separate product planning
- SST infrastructure config is not needed for CLI distribution (npm/brew/scoop)

---

### AD-5: Keep Vercel AI SDK as provider abstraction layer

**Decision:** Retain Vercel AI SDK (`ai@5.0.124`) as the provider abstraction.

**Rationale:**
- OpenCode's entire provider system is built on Vercel AI SDK
- All 20+ `@ai-sdk/*` packages use this abstraction
- Replacing it would require rewriting `src/provider/provider.ts` (55KB) and `src/provider/transform.ts` (34KB)
- Vercel AI SDK is Apache-2.0 licensed (compatible with MIT)
- It provides streaming, tool calling, and multi-provider support out of the box
- ax-cli uses OpenAI SDK directly — but Vercel AI SDK wraps OpenAI SDK anyway

**Trade-off:**
- Grok server-side tools from ax-cli use OpenAI SDK directly → need adapter to work through Vercel AI SDK
- This adapter is the single most complex integration item

**Alternatives considered:**
- **Switch to OpenAI SDK** — Rejected. Would break all non-OpenAI providers.
- **Use both SDKs** — Rejected. Two abstraction layers adds complexity.
- **Build custom abstraction** — Rejected. Vercel AI SDK already does this well.

---

### AD-6: Keep SolidJS TUI, do not port React/Ink components

**Decision:** Keep OpenCode's SolidJS + opentui TUI. Do not port ax-cli's React 19 + Ink 6.5 TUI components.

**Rationale:**
- OpenCode's TUI is production-quality (~28KB `app.tsx`, routing, context management, threading)
- React and SolidJS are different frameworks — components cannot be shared
- Porting React → SolidJS means rewriting, not importing
- ax-cli's TUI components (diff renderer, MCP dashboard, phase progress) can be referenced for UX patterns and reimplemented in SolidJS if needed

**Consequences:**
- ax-cli's diff renderer quality should be evaluated — if better, reimplement the UX in SolidJS
- Phase progress UI (for planner) will need new SolidJS implementation
- No React dependency in ax-code

---

### AD-7: Implement three-phase rollout

**Decision:** Execute the revamp in three phases:

**Phase 1 — Foundation (Week 1-2):**
- Fork, rebrand, trim packages, remove cut providers
- Goal: Clean baseline that passes all tests

**Phase 2 — Integrations (Week 3-5):**
- Port AX.md, self-correction, ReAct, planning, key encryption
- Goal: ax-code with its unique differentiators

**Phase 3 — Advanced (Week 6+):**
- Grok server-side tools adapter, SDK, AutomatosX agents
- Goal: Full feature set, enterprise options

**Rationale:**
- Phase 1 is low-risk subtraction (removing code, not adding)
- Phase 2 adds high-value features with low-medium complexity
- Phase 3 handles the most complex integrations after core is stable
- Each phase has a clear, testable outcome
- Phases can be reviewed independently by stakeholders

**Consequences:**
- Grok server-side tools (the most complex item) are deferred to Phase 3
- Phase 1 delivers a shippable (if undifferentiated) product
- Stakeholder review gates between phases

---

### AD-8: License compliance approach

**Decision:** Create NOTICE file, verify all dependency licenses, flag patched packages.

**Findings:**
- No GPL/copyleft dependencies detected in either repo
- Both repos are MIT licensed
- Key dependencies are MIT or Apache-2.0 (compatible)
- 4 patched packages need review (solid-js, standard-openapi, openrouter, xai)
- `packages/docs/` has a separate LICENSE file — verify terms
- models.dev terms of service need verification

**Action items:**
1. Create NOTICE file listing Apache-2.0 dependencies (required by Apache-2.0 license)
2. Verify `packages/docs/LICENSE` terms
3. Review patched dependency modifications for license implications
4. Check models.dev ToS for model metadata usage
5. Add license headers to new files

**Consequences:**
- NOTICE file becomes a required deliverable in Phase 1
- Documentation assets may need separate licensing treatment
- No blocking license risks identified

---

## Decisions Pending Stakeholder Input

| # | Decision | Options | Stakeholder |
|---|----------|---------|-------------|
| PD-1 | Enterprise cloud providers in v1? | Keep Vertex/Azure/Bedrock or defer | Leadership |
| PD-2 | GitHub Copilot provider in v1? | Keep or defer | Leadership |
| PD-3 | Web Console code in repo? | Keep for v2 or remove entirely | Leadership |
| PD-4 | Desktop app (Tauri) code in repo? | Keep for v2 or remove entirely | Leadership |
| PD-5 | SST infrastructure config? | Keep or remove | Leadership |
| PD-6 | Which AutomatosX agents? | Select top 3-5 from 20+ | Engineering + Leadership |
| PD-7 | Programmatic SDK in v1 or v2? | v1 or v2 | Leadership |
| PD-8 | Branding depth? | Name-only or full visual identity | Leadership |

---

## Summary of All Decisions

| ID | Decision | Status |
|----|----------|--------|
| AD-1 | OpenCode as base, not ax-cli | **Accepted** |
| AD-2 | Trim to 6-8 core providers | **Accepted** (pending PD-1, PD-2) |
| AD-3 | Import 7 ax-cli features | **Accepted** |
| AD-4 | Remove enterprise/console/desktop from v1 | **Accepted** (pending PD-3, PD-4, PD-5) |
| AD-5 | Keep Vercel AI SDK | **Accepted** |
| AD-6 | Keep SolidJS TUI, no React port | **Accepted** |
| AD-7 | Three-phase rollout | **Accepted** |
| AD-8 | License compliance with NOTICE file | **Accepted** |

---

*This ADR is based on the migration review document (2026-03-24), actual codebase analysis of both OpenCode and ax-cli, and the product direction established by leadership. All technical claims reference real code, files, and packages.*
