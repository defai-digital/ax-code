# ADR-004: ax-code Strategic Positioning — AI Coding Runtime

**Status:** Accepted
**Date:** 2026-04-03
**Updated:** 2026-04-03
**Decision Makers:** Leadership
**Supersedes:** ADR-003 §AD-7 (product direction), earlier ADR-004 drafts

---

## Context

ax-code needs a clear market position that:
1. Defines what ax-code **is** — independent of the AutomatosX ecosystem
2. Creates a defensible niche that leads to #1 in its category
3. Guides all engineering, product, and go-to-market decisions

This ADR resolves the open question from ADR-003: **"local CLI tool" vs "enterprise agent platform."**

**Answer: ax-code is a runtime. It is more than a tool; less than a platform. It is the controlled execution layer for AI-powered software development.**

---

## The Positioning Shift

### What Changed

Earlier drafts of this ADR positioned ax-code as "Sovereign AI Coding Infrastructure" — leading with air-gapped deployment, defence buyers, and the AutomatosX stack diagram. This was rejected for three reasons:

1. **Sovereign framing is aspirational, not current.** AX Trust, AX Serving, AX Fabric, and AX Engine exist as separate projects but are not yet integrated into ax-code's runtime. Leading with a stack diagram that ax-code doesn't yet consume creates a credibility gap.

2. **Defence/government buyers are high-value but low-volume.** Positioning for them first narrows adoption. The right sequence is: developers adopt for runtime quality → platform teams adopt for composability → enterprises buy for governance → defence buys for sovereignty.

3. **"Runtime" is a more defensible position than "infrastructure."** Infrastructure implies you need to deploy and operate something. A runtime is something you run. ax-code is the latter today.

### The Final Position

**ax-code is an AI coding runtime for teams that need control, auditability, and extensibility — not just code suggestions.**

---

## Decisions

### AD-1: Product Category — "AI Coding Runtime"

**Decision:** Position ax-code as an **AI coding runtime**, not an AI coding assistant, CLI agent, or infrastructure platform.

**Why "runtime":**

| Term | Problem |
|---|---|
| AI coding assistant | Implies IDE plugin or suggestion tool. Commoditized. |
| AI CLI agent | Implies terminal-only. Too narrow. |
| AI coding infrastructure | Implies something you deploy and operate. Too heavy. |
| AI coding platform | Too vague. Implies a hosted service. |
| **AI coding runtime** | Implies something you run — composable, embeddable, controllable. Correct abstraction. |

**What "runtime" means concretely:**
- The same engine backs the TUI, the SDK, headless server, and internal platforms
- It coordinates agent routing, tool execution, session state, permissions, and provider abstraction
- It is a layer you build on, not just a tool you use

**Consequences:**
- All messaging leads with runtime capabilities, not ecosystem diagrams
- Competitive framing: "more controllable than chat-first tools, more composable than a single CLI, more deployable than cloud-only assistants"

---

### AD-2: Core Differentiators — Control, Composability, Deployment

**Decision:** The three differentiators are, in order:

#### 1. Controlled Execution

What competitors lack: AI coding tools give agents implicit, loosely-governed tool access. ax-code makes tool use explicit, permissioned, and sandbox-aware.

What ax-code has today:
- Three isolation modes (read-only, workspace-write, full-access)
- Per-agent, per-tool, per-file-pattern permission rules
- Tree-sitter-based bash command analysis
- Session-backed state (every action is recorded and resumable)

Why this wins: The first question every engineering manager asks is "what did the AI actually do?" ax-code can answer.

#### 2. Runtime Composability

What competitors lack: Most AI coding tools are bound to one surface (Cursor = IDE, Claude Code = terminal). ax-code is a single runtime that powers multiple surfaces.

What ax-code has today:
- CLI/TUI (terminal)
- Headless API server (Hono)
- Programmatic SDK (in-process, < 1s startup)
- ACP (Agent Client Protocol)
- VS Code extension
- MCP integration

Why this wins: Platform teams can embed the same coding engine into CI/CD pipelines, internal platforms, and developer tooling. No other AI coding tool offers this.

#### 3. Deployment Flexibility

What competitors lack: Cloud-only. Single provider. Can't run offline.

What ax-code has today:
- 13+ cloud providers (Claude, GPT, Gemini, Grok, DeepSeek, Groq, etc.)
- Local providers (AX Engine, AX Studio, Ollama, LM Studio)
- Air-gap-friendly (no external network calls when using local providers)
- Localhost-first server defaults

Why this wins: Teams that can't send code to external APIs have no other option with this level of capability.

**Order matters.** Lead with control (universally valued), then composability (valued by platform teams), then deployment flexibility (valued by restricted environments). This sequence maximizes the addressable audience at each stage.

---

### AD-3: Target Users — Developers First, Enterprises Follow

**Decision:** Primary users are developers and platform teams. Enterprise and defence adoption follows from bottom-up adoption.

#### Primary

1. **Advanced developers** who want more control than suggestion-only coding tools
2. **Platform and infrastructure teams** building internal coding agents, CI workflows, or developer platforms
3. **AI-native engineering teams** that need provider flexibility, automation, and governed execution

#### Secondary

4. **General developers** who want a stronger local and multi-provider alternative to cloud-tied coding assistants

#### Derived (from primary adoption)

5. **Enterprise engineering leadership** who need governance, audit, and cost control over AI coding adopted by their teams
6. **Defence/government** who need air-gapped, sovereign AI coding

**Why developers first:**
- Developers adopt tools bottom-up — they choose what to use daily
- Enterprise sales follow developer adoption, not the reverse
- A runtime that developers love is harder to displace than one imposed top-down
- Open-source + free tier creates distribution that enterprise sales can't buy

**Consequences:**
- README, docs, and landing page lead with developer value, not enterprise governance
- AutomatosX ecosystem is presented as context, not headline
- Defence/sovereignty is a capability, not the identity

---

### AD-4: Competitive Framing — Dimension Shifting

**Decision:** Do not compete on the same dimensions as existing tools. Shift the conversation.

| Competitor | Their Dimension | ax-code's Response (Dimension Shift) |
|---|---|---|
| Claude Code | Best single-provider agent quality | "Use Claude through ax-code — plus every other provider. With controlled execution your team will actually approve." |
| Cursor | Best IDE-integrated coding UX | "Cursor is an IDE. ax-code is a runtime. Run it in your terminal, your CI/CD, your internal platform, your air-gapped network." |
| Copilot | Largest installed base, GitHub integration | "Copilot suggests lines. ax-code runs 9 specialized agents with session state, tool orchestration, and sandbox boundaries." |
| Amazon Q | Enterprise sales channel, AWS integration | "Q locks you into AWS models. ax-code runs any model from any provider, including on your own hardware." |
| Coder.com | Workspace governance and provisioning | "Coder governs the workspace. ax-code governs the AI agent's execution. Different layers, complementary products." |
| Aider / OpenCode | Open-source, multi-provider | "Open-source and multi-provider too — but with 9 agents, session persistence, sandbox, headless API, SDK, and a governed runtime." |

**The shift:** Don't argue about which chatbot is smarter. Argue that AI coding needs a runtime, not just a chatbot. Then demonstrate that ax-code is the only runtime.

---

### AD-5: AutomatosX Ecosystem — Context, Not Headline

**Decision:** Position AutomatosX as the broader ecosystem that ax-code belongs to, but ensure ax-code stands on its own merits first.

**Framing rule:** The README section on AutomatosX comes **after** the product proves its value independently. The ecosystem is where ax-code is going, not what it depends on today.

#### ax-code's Role in the Stack

```
USER ENDPOINTS
  AX Studio — General GenAI workspace
  AX Code   — AI coding runtime (this product)

GOVERNANCE
  AX Trust  — Contract-based execution, policy, audit trail

INFRASTRUCTURE
  AX Serving — Multi-node orchestration
  AX Fabric  — Knowledge infrastructure (RAG, distillation)
  AX Engine  — Mac-native inference (Apple Silicon)
```

#### Integration Roadmap (from ADR-003)

| Integration | What It Adds to ax-code | When |
|---|---|---|
| AX Trust | Contract-based deterministic execution, policy-as-code, audit export | Phase 2 |
| AX Engine | First-class local inference provider (Apple Silicon optimized) | Phase 2 |
| AX Fabric | Cross-session knowledge, RAG, distilled reasoning | Phase 2 |
| AX Serving | Multi-node routing, heterogeneous compute delegation | Phase 2 |

**Key principle:** ax-code is valuable today without any of these integrations. Each integration makes it more valuable, but none is a prerequisite.

**Consequences:**
- ADR-001, ADR-002, ADR-003 ecosystem context sections should reference the stack as future direction, not current dependency
- Marketing and docs never imply that ax-code requires the rest of the stack to function
- Each AutomatosX integration is shipped as a capability upgrade, not a prerequisite

---

### AD-6: Product Identity Statements

**Decision:** The following statements define ax-code's identity. All messaging, docs, and engineering decisions should be consistent with them.

**One-line:**
> AI coding runtime for teams that need control, auditability, and extensibility — not just code suggestions.

**What it is:**
> AX Code is an AI execution system for software development. It combines agent routing, planning, tool orchestration, provider abstraction, session state, and sandboxed execution into one runtime that can run in the terminal, through an SDK, or inside your internal platform.

**Why it's different (the four "more than" claims):**
> - More controllable than chat-first coding tools — tool use is explicit, permissioned, and sandbox-aware
> - More composable than a single CLI — the same runtime backs TUI, SDK, headless automation, and internal platforms
> - More deployable than cloud-only coding assistants — runs against hosted providers, local inference, or sovereign infrastructure
> - More operationally useful for teams — sessions, storage, policy boundaries, and provider abstraction are built into the core runtime

**The problem it solves:**
> AI coding becomes hard to trust when execution is opaque, unsafe, and difficult to reproduce. AX Code addresses that with explicit tools, session-backed workflows, sandboxed execution, and a runtime designed for controlled automation.

---

### AD-7: Engineering Implications

**Decision:** The positioning as "runtime" has specific engineering consequences.

| Principle | Implication |
|---|---|
| Runtime, not tool | Every feature must work across all surfaces (CLI, SDK, server, web). A feature that only works in the TUI is incomplete. |
| Controlled execution | Every tool must go through the permission layer. No raw `fs` / `Bun.file()` bypass. (ADR-003 AD-3 sandbox audit) |
| Session-backed | Every action must be recorded in the session. Stateless operations should still produce session records for auditability. |
| Provider-agnostic | No feature can depend on a specific LLM provider. Agent routing, planning, and tool use must work across all providers. |
| Composable | The SDK and headless API must expose the same capabilities as the TUI. Parity is a hard requirement. |
| Standalone first | ax-code must be fully functional without AX Trust, AX Serving, AX Fabric, or AX Engine. Integrations are additive. |

**Phase priorities (from ADR-003, unchanged):**

Phase 1: Production hardening (sandbox audit, chaos tests, observability, session lifecycle) — 6-8 weeks
Phase 2: AutomatosX integration (AX Trust, AX Engine, AX Fabric, AX Serving) — 8-12 weeks
Phase 3: Enterprise readiness (air-gap cert, audit export, RBAC) — 6-10 weeks

---

## Success Metrics

### Category Leadership: "AI Coding Runtime"

```
#1 validation:
  - Only product with multi-surface runtime (CLI + TUI + SDK + server + ACP + LSP + code graph)
  - Only product with 9 specialized agents + provider-agnostic + sandbox
  - SDK adoption by ≥3 teams building internal coding automation
  - Headless API used in ≥2 CI/CD pipeline deployments
  - Community: >5K GitHub stars (open-source adoption)
```

### Adoption Funnel

```
Developer adoption (leading):
  - Monthly active CLI users
  - Provider diversity per user (avg providers configured)
  - Session count per user (engagement depth)

Platform adoption (lagging):
  - SDK downloads / imports
  - Headless API deployments
  - Plugin/MCP integrations

Enterprise conversion (trailing):
  - Teams requesting governance features
  - Audit log export usage
  - AX Trust integration requests
```

### Product-Market Fit Signals

```
Strong signals:
  - Platform teams embedding ax-code SDK into internal tools
  - Developers choosing ax-code specifically for runtime composability
  - Enterprise security teams approving ax-code where they rejected Claude Code / Cursor
  - Teams running ax-code in CI/CD for automated code review

Weak signals (re-evaluate if these dominate):
  - Adoption driven purely by "it's free" (commoditized, no moat)
  - Users only using one provider and one surface (not leveraging composability)
  - No SDK/server adoption (just another CLI tool)
```

---

## Summary of All Decisions

| ID | Decision | Status |
|----|----------|--------|
| AD-1 | Product category: "AI Coding Runtime" | **Accepted** |
| AD-2 | Core differentiators: control → composability → deployment flexibility | **Accepted** |
| AD-3 | Target users: developers first, enterprises follow | **Accepted** |
| AD-4 | Competitive framing: dimension shifting, not feature comparison | **Accepted** |
| AD-5 | AutomatosX: context not headline, standalone first | **Accepted** |
| AD-6 | Product identity statements (one-line, what/why/problem) | **Accepted** |
| AD-7 | Engineering implications: multi-surface parity, no bypass, session-backed | **Accepted** |

---

*This ADR establishes the definitive positioning for ax-code. It supersedes all earlier positioning drafts (including the "Sovereign AI Coding Infrastructure" and "Governed AI Coding Infrastructure" framings). The positioning was validated against the updated README.md (2026-04-03) which serves as the canonical public expression of this position.*
