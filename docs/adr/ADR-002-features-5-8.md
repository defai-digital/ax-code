# ADR-002: Implementation of i18n, Design Check, Memory Warmup, and Context Stats

**Status:** Accepted
**Date:** 2026-03-30
**Updated:** 2026-04-03
**Decision Makers:** Engineering + Leadership

---

## Context

ax-code is built by importing features from ax-cli into the OpenCode base. Four medium/low priority features remained from the ax-cli import tracker:

1. **i18n** — Multi-language support (11 languages)
2. **Design Check** — CSS/React design system linting
3. **Memory Warmup** — Pre-cached project context
4. **Context Stats** — Token usage breakdown and monitoring

These features existed in ax-cli and needed to be adapted for ax-code's architecture (Effect, SolidJS TUI, Hono server).

### Runtime Context (Updated 2026-04-03)

With ax-code positioned as an AI coding runtime (see ADR-004), these features serve the runtime's core values of control, auditability, and extensibility:

- **Memory Warmup** supports session-backed workflows — auto-generated project context that improves first-response quality. Future AX Fabric integration will extend this with cross-session knowledge and RAG.
- **Context Stats** supports auditability — token usage and cost transparency per session. Future AX Trust integration will extend this with enterprise cost allocation and audit trail export.
- **i18n** supports deployment flexibility — enabling adoption in non-English markets.
- **Design Check** is a developer convenience feature — a built-in tool that demonstrates the runtime's extensibility model.

---

## Decisions

### Decision 1: i18n Implementation Approach

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| A. Copy ax-cli's i18n as-is (22 JSON files) | Complete, tested | React-specific, 750+ translation keys, heavy maintenance |
| B. Build simplified i18n (core strings only) | Lightweight, easy to maintain | Fewer translations, needs future expansion |
| C. Use existing library (i18next) | Industry standard, tooling | New dependency, overkill for CLI tool |

**Decision: Option B — Simplified i18n**

**Rationale:**
- ax-cli had 750+ translation keys — many for React/Ink components we don't use
- ax-code uses SolidJS TUI — different component structure
- Start with ~60 core strings (errors, tools, status), expand later
- JSON files per language, loaded at startup with English fallback
- No new dependencies — simple key-value lookup

**Consequences:**
- Faster to implement (hours vs days)
- Some ax-cli translations won't be ported initially
- Easy to expand — just add keys to JSON files

---

### Decision 2: Design Check Approach

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| A. Port ax-cli's design-check (5 rules + auto-fix) | Feature-complete | Niche use case (React/CSS only), complex |
| B. Build as an agent skill | Uses existing agent infrastructure | Less structured than dedicated tool |
| C. Build as CLI command only | Simple, focused | No TUI integration |

**Decision: Option C — CLI command**

**Rationale:**
- Design check is a batch operation, not interactive — CLI is the right interface
- 5 rules with regex-based detection, no AST parsing needed
- Auto-fix for colors and spacing is straightforward string replacement
- Config discovery from `.ax-code/design.json`
- Can be added as a tool later if agents need it

**Consequences:**
- Not available in TUI (use from terminal)
- Simple implementation, easy to test
- Can evolve into agent tool in v2

---

### Decision 3: Memory Warmup Approach

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| A. Port ax-cli's full memory system (generator + store + injector + stats) | Complete, tested | Complex, many files |
| B. Extend existing AX.md system | Reuses existing context injection | AX.md is static, memory is dynamic |
| C. Build standalone with integration | Clean separation | New module to maintain |

**Decision: Option C — Standalone module with system prompt integration**

**Rationale:**
- AX.md is a manual document; memory is auto-generated — different purposes
- Memory should auto-refresh when project changes (content hash)
- Store in `.ax-code/memory.json` (separate from AX.md)
- Inject into system prompt alongside AX.md (not replacing it)
- CLI commands for warmup, status, clear

**Future direction (AX Fabric integration):** When AX Fabric is integrated (see ADR-004 Phase 2), the local memory store will be supplemented by AX Fabric's cross-session knowledge layer. Local memory becomes a cache/fallback for offline/air-gapped scenarios; AX Fabric becomes the primary knowledge source when connected.

**Consequences:**
- Users get both AX.md (manual context) and memory (auto context)
- Memory may overlap with AX.md — acceptable, LLM handles deduplication
- Token budget needs to account for both

---

### Decision 4: Context Stats Approach

**Options considered:**

| Option | Pros | Cons |
|---|---|---|
| A. Port ax-cli's TUI component (React/Ink) | Visual, interactive | React component, needs SolidJS rewrite |
| B. CLI command output only | Simple, works everywhere | Not interactive |
| C. Add to existing TUI as command | Integrated experience | More complex |

**Decision: Option B first, Option C later**

**Rationale:**
- Start with CLI command (`ax-code stats context`) for immediate value
- Context breakdown is calculated, not real-time — CLI output is sufficient
- TUI component can be added in v2 as SolidJS panel
- Cost estimation uses simple per-provider pricing constants
- Token counting uses character-based estimation (1 token ~ 4 chars)

**Future direction (AX Trust integration):** Context stats will feed into AX Trust's audit trail for enterprise cost allocation and compliance reporting. Per-session, per-agent, per-provider cost breakdowns become available to enterprise admins via AX Trust dashboards.

**Consequences:**
- No real-time context monitoring in TUI (v1)
- Simple but useful output
- Easy to upgrade to TUI component later

---

### Decision 5: Implementation Order

**Decision: Context Stats -> Memory Warmup -> i18n -> Design Check**

**Rationale:**
1. **Context Stats** — smallest, most immediately useful (users ask "why is it slow")
2. **Memory Warmup** — next most useful (improves first-response quality)
3. **i18n** — medium effort, expands user base
4. **Design Check** — niche, lowest priority

---

## Technical Architecture

### File Structure

```
packages/ax-code/src/
├── i18n/
│   ├── index.ts              — getTranslations(), setLanguage()
│   ├── types.ts              — Translation interfaces
│   ├── loader.ts             — JSON loader with caching + fallback
│   └── locales/
│       ├── en/ui.json        — English (source of truth)
│       ├── zh-CN/ui.json     — Simplified Chinese
│       ├── ja/ui.json        — Japanese
│       ├── ko/ui.json        — Korean
│       ├── es/ui.json        — Spanish
│       ├── fr/ui.json        — French
│       ├── de/ui.json        — German
│       ├── pt/ui.json        — Portuguese
│       ├── zh-TW/ui.json     — Traditional Chinese
│       ├── th/ui.json        — Thai
│       └── vi/ui.json        — Vietnamese
│
├── design-check/
│   ├── index.ts              — runDesignCheck()
│   ├── config.ts             — Config loader
│   ├── types.ts              — Rule types, result types
│   ├── scanner.ts            — File scanner
│   ├── fixer.ts              — Auto-fix engine
│   └── rules/
│       ├── index.ts          — Rule registry
│       ├── colors.ts         — no-hardcoded-colors
│       ├── spacing.ts        — no-raw-spacing
│       ├── inline-styles.ts  — no-inline-styles
│       ├── alt-text.ts       — missing-alt-text
│       └── form-labels.ts    — missing-form-labels
│
├── memory/
│   ├── index.ts              — Main exports
│   ├── generator.ts          — Project scanner + context generator
│   ├── store.ts              — .ax-code/memory.json read/write
│   ├── injector.ts           — System prompt injection
│   └── types.ts              — Types
│
├── stats/
│   ├── index.ts              — Main exports
│   ├── collector.ts          — Token usage collector
│   ├── breakdown.ts          — Context breakdown calculator
│   ├── cost.ts               — Cost estimation
│   └── types.ts              — Types
│
└── cli/cmd/
    ├── design-check.ts       — ax-code design-check command
    ├── memory.ts             — ax-code memory warmup/status/clear
    └── context.ts            — ax-code stats context
```

### Integration Points

| Feature | Integrates With | Future AutomatosX Integration |
|---|---|---|
| i18n | Config (language setting), TUI (all user-facing text), CLI commands | — |
| Design Check | CLI (standalone command), config (.ax-code/design.json) | — |
| Memory Warmup | System prompt (injector), config (.ax-code/memory.json), CLI | AX Fabric (cross-session knowledge) |
| Context Stats | Session/prompt (collector), CLI (output), session messages | AX Trust (audit trail, cost allocation) |

### Dependencies

| Feature | New Dependencies |
|---|---|
| i18n | None (JSON files + simple loader) |
| Design Check | None (regex-based rules) |
| Memory Warmup | None (uses existing Filesystem, Glob) |
| Context Stats | None (uses existing session token data) |

**Zero new npm dependencies for all 4 features.**

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| i18n translations inaccurate | Users see wrong text | Use English fallback, community review |
| Design check false positives | Annoying violations reported | Rules are configurable, can be disabled |
| Memory warmup stale cache | AI gets outdated context | Content hash invalidation |
| Context stats inaccurate token count | Wrong numbers shown | Use char-based estimate, note it's approximate |
| Features increase system prompt size | More tokens used | Memory warmup has configurable max tokens |

---

## Timeline

| Day | Deliverable | Status |
|---|---|---|
| Day 1 | Context Stats (collector, breakdown, cost, CLI command) | Complete |
| Day 2 | Memory Warmup (generator, store, injector, CLI commands) | Complete |
| Day 3 | i18n (types, loader, English JSON, 10 language JSONs) | Complete |
| Day 4 | Design Check (5 rules, scanner, fixer, CLI command) | Complete |

---

*This ADR documents the architectural decisions for implementing features 5-8 in ax-code. Updated 2026-04-03 to align with ax-code's positioning as an AI coding runtime (ADR-004) and note future AutomatosX integration directions.*
