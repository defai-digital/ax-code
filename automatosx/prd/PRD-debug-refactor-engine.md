# Product Requirements Document (PRD)

# AX Code — Debugging & Refactoring Engine

**Document Version:** 0.2 — Draft (post-review)
**Date:** 2026-04-05
**Status:** Draft — Pending review
**Companion ADR:** `automatosx/adr/ADR-debug-refactor-engine.md`
**Depends on:** `automatosx/prd/PRD-lsp-v3-code-intelligence-runtime.md` (v3 Code Intelligence Runtime)

## References (codebase, verified)

- `packages/ax-code/src/code-intelligence/` — v3 runtime (nodes, edges, files, cursor)
- `packages/ax-code/src/code-intelligence/index.ts:23` — `CodeIntelligence` public namespace
- `packages/ax-code/src/code-intelligence/index.ts:74` — `Scope = "worktree" | "none"`
- `packages/ax-code/src/code-intelligence/index.ts:260-301` — `findImports` / `findDependents` (Phase 1 returns empty; Phase 2 populates via `imports` edges)
- `packages/ax-code/src/code-intelligence/schema.sql.ts` — graph schema with nodes, edges, files, cursor
- `packages/ax-code/src/code-intelligence/schema.sql.ts:123` — `completeness` enum: `"full"` = LSP-indexed precise, `"partial"` = tree-sitter symbols only, `"lsp-only"` = LSP gaps
- `packages/ax-code/src/lsp/` — v2.1 LSP client (stable ingestion source)
- `packages/ax-code/src/agent/agent.ts` — agent definitions
- `packages/ax-code/src/agent/permission-presets.ts` — `readOnlyWithWeb`, `readOnlyNoWeb`, `denyAll`
- `packages/ax-code/src/permission/` — rule-based permission model
- `packages/ax-code/src/tool/` — built-in tools (all `snake_case` IDs: `code_intelligence`, `apply_patch`, `external_directory`, etc.)
- `packages/ax-code/src/tool/code-intelligence.ts:14-15` — experimental-flag gating pattern for new CodeIntelligence-backed tools
- `packages/ax-code/src/flag/flag.ts` — `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` flag

---

## 0. TL;DR

ax-code v3 is building a **deterministic code intelligence runtime** (v3 PRD) — a persistent graph of symbols and edges derived from LSP. That is the data layer. It does not, by itself, help the user with the work they actually spend time on: **debugging existing bugs, refactoring existing code, removing duplication, and pulling hardcoded values into configuration**.

This PRD proposes the **Debugging & Refactoring Engine (DRE)** — a thin reasoning layer that sits **on top of** `CodeIntelligence` and turns the graph into five high-value, deterministic-first capabilities:

1. **Root Cause Debugger** — turn a stack trace into a call/definition chain with an explained hypothesis
2. **Refactor Planner** — emit an auditable plan before touching code
3. **Duplicate & Hardcode Detector** — AST + embedding hybrid, project-wide
4. **Change Impact Analyzer** — transitive closure over graph edges with a risk score
5. **Safe Refactor Mode** — plan → typecheck → lint → test → apply (with rollback)

The engine is **not** a new agent, a new tool runtime, or a rewrite. It is a **TypeScript module under `packages/ax-code/src/debug-engine/`** that exposes an internal API the existing agents call as tools. It adds **no new language runtimes** (no Rust core), **no new data stores** (SQLite only), and **no new sandbox tiers**.

The strategic bet:

> We are not building a better AI coding tool.
> We are building the layer that makes AI coding **correct, safe, and auditable** for code that already exists.

---

## 1. Context

### 1.1 What ax-code already has

| Capability | Where | Status |
|---|---|---|
| LSP client (14+ servers) | `packages/ax-code/src/lsp/` | v2.1, hardened |
| Code graph (nodes/edges/files) | `packages/ax-code/src/code-intelligence/` | v3 Phase 2, `calls`/`references` edges landing |
| Worktree-scoped queries | `code-intelligence/index.ts:74` (`Scope = "worktree" \| "none"`) | Shipped |
| Explainable query results | `code-intelligence/index.ts:26` (`Explain` on every record) | Shipped |
| `code_intelligence` tool | `tool/code-intelligence.ts` | Shipped, gated on `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` |
| `debug` agent (ReAct) | `agent/agent.ts` + `prompt/debug.txt` | Shipped (read-only) |
| Permission presets | `agent/permission-presets.ts` | Shipped (read-only variants are hard-coded per preset) |
| Permission / policy engine | `packages/ax-code/src/permission/` | Shipped |
| Replay + audit | `packages/ax-code/src/replay/`, `audit/` | Shipped (auto-captures all tool calls/results) |

**What is already deterministic:** "who calls `processPayment`", "what symbols are in `payment.ts`", "what references point at this node". These are `CodeIntelligence.findCallers / symbolsInFile / findReferences` today.

**What is still guesswork:** "why is this null pointer happening", "is this refactor safe", "how much of this codebase duplicates pricing logic", "will changing this function break anything important".

The v3 PRD deliberately stopped at the data layer. This PRD takes the next step.

### 1.2 What this PRD is and is not

**Is:**
- A product spec for 5 features targeting debug + refactor + cleanup workflows
- A TypeScript subsystem that consumes the existing `CodeIntelligence` API
- An explicit extension of the v3 runtime (not a competing design)

**Is not:**
- A new agent framework — we use the existing `debug` / `build` / `react` agents
- A new code graph — we use the v3 schema unchanged (nodes + edges + files)
- A Rust rewrite — the companion ADR (ADR-001) justifies staying on TypeScript/Bun
- A new permission model — we reuse rule-based permissions and the worktree scope filter
- An attempt to compete with Copilot on autocomplete or Cursor on multi-file edit UX

### 1.3 Why now

v2.1 hardened LSP. v3 Phase 2 is landing cross-file edges (see `cfdaa8d feat(code-intelligence): worktree scope filter for policy-aware queries` and in-flight edits to `builder.ts`). Once cross-file `calls` edges are populated, we can do **call-chain traversal**, which is the prerequisite for four of the five features below. `imports` edges land alongside `calls` edges in Phase 2 — `findImports` / `findDependents` currently return empty and depend on this work (see `code-intelligence/index.ts:260-301`). Building DRE now lets us ship user-visible value on top of the v3 graph in the same quarter v3 becomes queryable.

### 1.4 What users are actually asking for

Internal usage evidence: the three highest-frequency prompts to the `debug` / `build` agents today are all variations of:

1. "Why does X return null / throw here" — root cause investigation
2. "Clean up duplicated Y across the codebase" — dedup / DRY pass
3. "Refactor Z without breaking the callers" — safe refactor

None of these are "write new code". All three are **editing existing code with full context**. This is exactly what the v3 graph enables and exactly where LLM-only approaches hallucinate.

---

## 2. Objectives

### O1 — Debugging that explains *why*, not just *where*

Given an error (manual paste, stack trace, or test failure), the engine produces a structured **root-cause hypothesis**: the call chain from entry point to failure site, the state assumptions that broke, and a confidence score. Every step links to a `CodeIntelligence.Symbol` with the graph's existing `explain` field. No hallucinated function names.

### O2 — Refactors that are *planned* before they are *applied*

Given a refactor intent ("extract service", "rename X", "collapse these three functions"), the engine produces a machine-readable **plan** — list of edits, affected call sites, risk classification — that is reviewed before a single byte is written. Plans are durable artifacts (session store), so agents can re-evaluate after the user edits the plan.

### O3 — Duplication and hardcoding detection that finds *semantic* overlap, not just text

The engine identifies duplicate logic (AST structural match + embedding similarity for near-duplicates) and hardcoded values that belong in config (magic numbers, inline URLs, inline credential shapes). Output is **ranked by refactor value**, not raw count — three copies of pricing logic matter more than three copies of a one-line string constant.

### O4 — Impact analysis that gives a *risk score*, not just a file count

For any proposed change (diff, symbol, or file), the engine computes the transitive call-graph closure and returns: affected symbols, affected files, estimated blast radius, and a classification (`low` / `medium` / `high`). Uses v3 graph edges — no ad-hoc LSP traversal.

### O5 — Safe refactor execution gated by *deterministic* checks, not LLM self-review

The "apply" path is a sequence: generate patch → typecheck (via existing `diagnostics` tool) → lint → run targeted tests → commit or rollback. No step is optional. Safe mode is the **default** for multi-file refactors; the user must opt out for exploratory edits.

### O6 — Every output is explainable and auditable

Every result from DRE carries the same `explain` field that `CodeIntelligence` already attaches (`source`, `indexedAt`, `completeness`, `queryId`) plus a DRE-specific `reasoning` field listing which graph queries and heuristics produced the result. All tool invocations are automatically captured by the session recorder as `tool.call` / `tool.result` events (same pattern as `code_intelligence.ts:10-12`) — no new audit code needed.

### Non-goals (explicit, to prevent scope creep)

- ❌ Full code graph replacement — we use v3 as-is
- ❌ New language runtime (Rust, Go, WASM core) — see ADR-001
- ❌ Autonomous fix-and-commit loops — humans in the loop for every `apply`
- ❌ IDE-style refactoring UX (inline previews, hover cards) — CLI/TUI only in v1
- ❌ Cross-repo analysis — single repo, single worktree in v1 (multi-repo is a v4 problem)
- ❌ Real-time background scanning — on-demand only, piggybacking on the v3 watcher
- ❌ Replacing the `debug` agent — DRE is a **tool source** for agents, not a new agent
- ❌ Modifications to v3 graph schema — see ADR-002 and ADR-004

---

## 3. User stories

### US-1 — Debug a null pointer

> As a senior engineer, when I paste a stack trace into ax-code, I want the agent to show me the **call chain** (entry → failure), identify **where the invariant was broken**, and cite every frame by symbol ID so I can jump to the source. I don't want a rewritten function; I want an explanation.

### US-2 — Plan a refactor before committing

> As a tech lead, when I ask the agent to "extract a PricingService", I want a **plan** listing the symbols to create, the call sites to update, and the risk level. I want to edit the plan before it runs. I want to reject it and have nothing changed.

### US-3 — Find and collapse duplicated pricing logic

> As an engineer cleaning up tech debt, I want to ask "where is pricing logic duplicated in this repo" and get a ranked list of clusters, each with file paths, similarity scores, and a suggested extraction target. I want the result to ignore test files and generated code by default.

### US-4 — Understand the blast radius of a change

> As a reviewer, when the agent proposes a change to `handleRequest`, I want to see which **other symbols transitively depend on it**, with a one-word risk label. I want to reject the change if the label is "high" without reading the diff.

### US-5 — Refactor safely or not at all

> As an engineer, when I run a multi-file refactor, I want the engine to typecheck, lint, and run the relevant tests **before** applying any file writes. If any check fails, I want zero files modified and a clear report of what failed. I do not trust the LLM to self-validate.

### US-6 — Audit what the engine did

> As a team lead, I want every DRE invocation (root cause, plan, apply, dedup scan) recorded in the audit trail with its inputs, outputs, confidence scores, and the graph query IDs it used. I want to replay any past session and see the same reasoning.

---

## 4. Feature specifications

All five features live under a single namespace: `DebugEngine` (module path `packages/ax-code/src/debug-engine/`). Each is implemented as a TypeScript function that returns a structured object and publishes events through the existing `Bus` layer.

### 4.1 Root Cause Debugger (`DebugEngine.analyzeBug`)

**Input**

```ts
{
  error: string                    // raw error message or user description
  stackTrace?: string              // optional; parsed if provided
  entrySymbol?: CodeNodeID         // optional: narrow to a known entry point
  scope?: "worktree" | "none"      // defaults to "worktree"
}
```

**Pipeline**

1. **Parse** stack trace (language-agnostic regex + per-language extractors for TS and Python in v1) → list of `(file, line, symbol?)` frames
2. **Resolve** each frame to a graph node via `CodeIntelligence.findSymbol` or `symbolsInFile` (fallback to nearest node by line range)
3. **Build call chain** by walking `CodeIntelligence.findCallers` / `findCallees` up to depth 5 (configurable, hard cap 8)
4. **Rule-based filtering** — drop frames from node_modules, generated files, test harness unless the error originated there
5. **LLM reasoning step** — constrained prompt: given the resolved chain + signatures, name the most likely broken invariant. Output must cite frame indices; any un-citable claim is dropped
6. **Confidence scoring** — deterministic score from chain completeness (how many frames resolved to real nodes) × LLM self-reported confidence, capped at 0.95 (we never claim certainty)

**Output**

```ts
{
  chain: Array<{
    frame: number
    symbol: CodeIntelligence.Symbol | null    // null if frame could not be resolved
    file: string
    line: number
    role: "entry" | "intermediate" | "failure"
  }>
  rootCauseHypothesis: {
    summary: string                           // one sentence
    brokenInvariant: string                   // what was assumed and violated
    citedFrames: number[]                     // indices into `chain`
  }
  fixSuggestion: string | null                // suggestion only, no auto-apply
  confidence: number                          // 0..0.95
  truncated: boolean                          // true if depth cap or budget hit
  explain: DebugEngine.Explain
}
```

**Acceptance criteria**

- Given a real TS null-pointer stack from the ax-code test suite, the chain must include ≥80% of non-library frames resolved to real graph nodes
- `brokenInvariant` must reference at least one symbol that exists in the graph (no hallucinated names) — enforced at runtime, not just prompt-side
- Runs in <3s for chains ≤5 deep on the ax-code repo (measured via `timer_start`/`timer_stop`)
- Zero LLM calls if `entrySymbol` + `stackTrace` fully resolve and match a known error pattern (pure deterministic path) — measured as a ratio

**Out of scope for v1**

- Runtime state inspection (we have no debugger attach)
- Cross-language chains (e.g. TS calling Rust via FFI)
- Time-travel / historical blame correlation (v2)
- Go / Rust stack trace parsing (v2)

---

### 4.2 Refactor Planner (`DebugEngine.planRefactor`)

**Input**

```ts
{
  intent: string                              // free-text from user or agent
  targets: CodeNodeID[]                       // symbols the refactor touches
  kind?: "extract" | "rename" | "collapse" | "move" | "inline" | "other"
  scope?: "worktree" | "none"
}
```

**Pipeline**

1. For each `target`, pull caller/callee set via `CodeIntelligence.findCallers` + `findReferences`
2. Classify the refactor kind if not provided (rule-based from intent keywords; LLM fallback for ambiguous)
3. Generate an **edit list**: structured operations (`create_symbol`, `replace_call_site`, `delete_symbol`, `move_file`, `update_signature`) — each entry references real node IDs, never raw strings
4. Estimate **risk**: count of cross-file call sites, presence in public API (based on symbol visibility), test coverage of affected files
5. Produce a **human-readable plan** (markdown) plus the machine-readable edit list

**Output**

```ts
{
  planId: string                              // persisted in session store
  kind: "extract" | "rename" | "collapse" | "move" | "inline" | "other"
  summary: string                             // markdown
  edits: Array<{
    op: "create_symbol" | "replace_call_site" | "delete_symbol" | "move_file" | "update_signature"
    target: CodeNodeID | string               // node ID or file path
    detail: string                            // human-readable
  }>
  affectedFiles: string[]
  affectedSymbols: CodeNodeID[]
  risk: "low" | "medium" | "high"
  explain: DebugEngine.Explain
}
```

**Key rule**: `planRefactor` **never writes files**. Applying the plan is a separate call (`DebugEngine.applySafeRefactor`, see 4.5).

**Acceptance criteria**

- For an "extract function" plan on a 10-call-site function, the plan must list all 10 call sites and cite real symbol IDs
- Risk classification must be deterministic: given the same input and the same graph state, the same label
- Plans are persisted in SQLite under a new `debug_engine_refactor_plan` table; retrievable by `planId`
- Plan generation runs without any file writes — verified by hooking `apply_patch` / `write` / `edit` in tests

---

### 4.3 Duplicate & Hardcode Detector (`DebugEngine.detectDuplicates` / `detectHardcodes`)

#### 4.3.1 Duplicates

**Input**

```ts
{
  scope?: "worktree" | "none"
  kinds?: CodeNodeKind[]                       // defaults to function, method
  minLines?: number                            // default 6
  similarityThreshold?: number                 // default 0.85
  excludeTests?: boolean                       // default true
}
```

**Pipeline**

1. For each candidate symbol in scope, extract its **AST signature** (normalized: identifiers stripped, literals bucketed) via a **DRE-owned AST walk** (not via modifications to `CodeGraphBuilder` — see ADR-004)
2. **Bucket by signature hash** → exact structural duplicates go straight to output
3. For near-duplicates, compute **embedding** over normalized body (small local model; no cloud round-trip for scans)
4. **Cluster** by similarity threshold
5. **Rank clusters** by: size × lines × cross-file spread (three copies across three files > three copies in one file)
6. For each cluster, suggest an extraction target (most-shared parent module)

**Output**

```ts
{
  clusters: Array<{
    id: string
    members: CodeIntelligence.Symbol[]
    similarityScore: number                   // 0..1
    sharedLines: number
    suggestedExtractionTarget: string         // file path suggestion
    pattern: string                           // one-line human summary
    tier: "exact" | "structural" | "semantic" // how it was detected
  }>
  totalDuplicateLines: number
  truncated: boolean                          // true if budget exhausted
  explain: DebugEngine.Explain
}
```

#### 4.3.2 Hardcodes

**Input**

```ts
{
  scope?: "worktree" | "none"
  patterns?: Array<"magic_number" | "inline_url" | "inline_path" | "inline_secret_shape">
  excludeTests?: boolean
}
```

**Pipeline**

1. DRE-owned AST walk per file (separate pass from `CodeGraphBuilder` — DRE does not modify v3 ingestion)
2. Apply pattern detectors — magic numbers (non-0/1, not in obvious literal contexts), URLs, absolute paths, secret-shaped strings (entropy threshold, not regex matching on known keys)
3. Suggest target (`config.ts`, `.env`, etc.) based on project layout

**Output**

```ts
{
  findings: Array<{
    file: string
    line: number
    kind: "magic_number" | "inline_url" | "inline_path" | "inline_secret_shape"
    value: string                             // the literal, safely truncated
    suggestion: string                        // "move to config.ts"
    severity: "low" | "medium" | "high"
  }>
  explain: DebugEngine.Explain
}
```

**Acceptance criteria**

- On the ax-code repo itself, duplicate detection finds ≥5 clusters with `similarityScore ≥ 0.85` (baseline captured in the first test run and frozen as a regression floor)
- Hardcode detector <10% false positive rate on a hand-labeled 100-sample set from the repo
- Scan of `packages/ax-code` completes in <30s on a cold cache
- Zero cloud calls for duplicate detection on the default path
- Zero writes to `code_node` / `code_edge` / `code_file` tables from either detector

---

### 4.4 Change Impact Analyzer (`DebugEngine.analyzeImpact`)

**Input**

```ts
{
  changes: Array<
    | { kind: "symbol"; id: CodeNodeID }
    | { kind: "file"; path: string }
    | { kind: "diff"; patch: string }          // parsed to extract touched symbols
  >
  depth?: number                                // default 3, max 6
  scope?: "worktree" | "none"
}
```

**Pipeline**

1. Resolve each change to a **seed set** of symbols
2. For each seed, do **BFS over `calls` and `references` edges** up to `depth`, memoizing visited nodes
3. Classify each reached symbol by distance and edge kind
4. Compute a **risk score**: weighted by (distance, public-API flag, test coverage, affected-file count)
5. Produce a human-readable summary

**Output**

```ts
{
  seeds: CodeNodeID[]
  affectedSymbols: Array<{
    symbol: CodeIntelligence.Symbol
    distance: number                          // BFS depth from nearest seed
    path: CodeNodeID[]                        // shortest path back to seed
  }>
  affectedFiles: string[]
  apiBoundariesHit: number                    // count of public symbols reached
  riskScore: number                           // 0..100
  riskLabel: "low" | "medium" | "high"
  truncated: boolean                          // true if node budget or depth cap hit
  explain: DebugEngine.Explain
}
```

**Acceptance criteria**

- For a known "ripple" symbol in the ax-code codebase (e.g. a widely-used utility), impact includes ≥90% of known callers up to depth 3
- `riskLabel` is deterministic for the same input and same graph state
- If `truncated` is true, `riskLabel` is forced to `high` (absence of evidence is not evidence of safety)
- Completes in <1s for depth=3 on ax-code-sized repos
- Reuses the existing v3 edge tables — no new schema

---

### 4.5 Safe Refactor Mode (`DebugEngine.applySafeRefactor`)

**Input**

```ts
{
  planId: string                              // from planRefactor
  mode?: "safe" | "aggressive"                // default "safe"; "aggressive" opt-in
  testSelector?: string                       // glob to narrow test run; defaults to "auto"
}
```

**Pipeline (safe mode, no step is skippable)**

1. **Load** plan from session store; refuse if plan is stale (any `affectedFile` changed in the graph cursor since plan creation)
2. **Generate patch** from edit list (uses existing `apply_patch` tool internally)
3. **Dry-run** the patch in a **shadow worktree** — scratch `git worktree` created under `automatosx/tmp/dre-shadow/<planId>` via an `InstanceState`-scoped helper
4. **Typecheck** the shadow worktree via the existing `diagnostics` tool (`bun typecheck` for TS; project-configured command for other languages)
5. **Lint** via the project's configured lint command (from `ax-code.json` or autodetected)
6. **Test selection** — from `affectedFiles`, compute the union of test files that import them (uses `CodeIntelligence.findDependents`, which **requires v3 Phase 2 `imports` edges**; if unavailable, safe mode falls back to running the project's full test suite and emits a warning). Run only those tests
7. **Decision gate**: if any of typecheck / lint / test fails, **abort**, write nothing to the real worktree, return a structured failure report
8. On success, **apply** the patch to the real worktree, publish an `audit` event, return the result

**Output**

```ts
{
  applied: boolean
  planId: string
  checks: {
    typecheck: { ok: boolean; errors: string[] }
    lint:      { ok: boolean; errors: string[] }
    tests:     { ok: boolean; ran: number; failed: number; failures: string[]; selection: "targeted" | "full-fallback" }
  }
  filesChanged: string[]
  rolledBack: boolean
  explain: DebugEngine.Explain
}
```

**Aggressive mode** (opt-in, requires user confirmation in the TUI per invocation, not a persistent config flag): skips test selection, still runs typecheck + lint. Never skips typecheck.

**Acceptance criteria**

- Safe mode has **zero path** to file writes without passing all three checks
- A failure at any check leaves the real worktree byte-identical to the pre-call state (verified by `git status` diff in tests)
- Shadow worktree is cleaned up on both success and failure — no orphan worktrees after 1000 runs (stress test)
- Reuses `apply_patch`, `diagnostics`, `bash` tools — no new tool runtimes
- If the project has uncommitted changes at invocation time, safe mode emits an `ask` event before creating a shadow worktree

---

## 5. System integration

### 5.1 Where DRE lives in the ax-code architecture

```text
┌──────────────────────────────────────────────────────────────┐
│  Agents (debug, build, react, plan, ...)                     │
│  — unchanged; DRE surfaces as new tool entries               │
└──────────────────────┬───────────────────────────────────────┘
                       │ tool calls
┌──────────────────────▼───────────────────────────────────────┐
│  DebugEngine namespace (NEW)                                 │
│  src/debug-engine/{analyze-bug, plan-refactor, detect-dup,   │
│                    analyze-impact, apply-safe}.ts            │
└──────────────────────┬───────────────────────────────────────┘
                       │ reads only
┌──────────────────────▼───────────────────────────────────────┐
│  CodeIntelligence (existing, v3)                             │
│  src/code-intelligence/{index, query, builder, watcher}.ts   │
└──────────────────────┬───────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────┐
│  LSP (existing, v2.1 hardened)                               │
│  src/lsp/                                                    │
└──────────────────────────────────────────────────────────────┘
```

**What is new:** one directory (`src/debug-engine/`), five public functions, five tool wrappers in `src/tool/`, one new SQLite table for refactor plans, one new SQLite table for DRE's embedding cache (see ADR-004), migrations for both.

**What is not new:** code graph, LSP client, agent framework, permission system, audit trail, replay system, sandbox model, bus, tool runtime, session processor.

### 5.2 Tool integration

Each DRE function gets a thin tool wrapper in `src/tool/`. **All tool IDs use `snake_case` to match existing conventions** (`code_intelligence`, `apply_patch`, `external_directory`):

| Tool ID | Wraps | Default action | Flag-gated |
|---|---|---|---|
| `debug_analyze` | `DebugEngine.analyzeBug` | `allow` (read-only) | Yes (experimental) |
| `refactor_plan` | `DebugEngine.planRefactor` | `allow` (read-only) | Yes (experimental) |
| `dedup_scan` | `DebugEngine.detectDuplicates` + `detectHardcodes` | `allow` (read-only) | Yes (experimental) |
| `impact_analyze` | `DebugEngine.analyzeImpact` | `allow` (read-only) | Yes (experimental) |
| `refactor_apply` | `DebugEngine.applySafeRefactor` | `ask` | Yes (experimental) |

**Experimental gating.** While DRE and the v3 graph backend mature, all five DRE tools are gated behind an `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE` flag (new, added alongside `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` in `flag/flag.ts`). Tools do not register in the tool registry unless the flag is set. This mirrors the pattern already used for `code_intelligence` (see `tool/code-intelligence.ts:14`).

**Permission preset integration.** The existing `readOnlyWithWeb` and `readOnlyNoWeb` presets in `agent/permission-presets.ts` are hard-coded config objects, not extension points. Adding DRE tools requires editing those preset factories directly to add the new tool IDs as `"allow"`. The four read-only DRE tools go into both presets; `refactor_apply` is never added to a read-only preset.

### 5.3 Agent routing impact

No routing changes required. Agent prompt updates only:

- `prompt/debug.txt` — mention `debug_analyze` and `impact_analyze` as preferred tools for "why" questions
- `prompt/build.txt` — mention `refactor_plan` → `refactor_apply` as the write-path sequence
- `prompt/react.txt` — mention all five as available when constructing reasoning plans

No changes to `agent/router.ts`.

### 5.4 Storage additions

Two new tables, both under `packages/ax-code/src/debug-engine/schema.sql.ts`. Generated via `bun run db generate --name add_debug_engine_tables` from `packages/ax-code`.

#### `debug_engine_refactor_plan`

```text
id TEXT PRIMARY KEY                           (format: "plan_<timestamp>_<rand>")
project_id TEXT NOT NULL                      (FK -> project, cascade delete)
kind TEXT NOT NULL                            (extract | rename | collapse | move | inline | other)
summary TEXT NOT NULL                         (markdown)
edits TEXT NOT NULL                           (JSON blob of edit list)
affected_files TEXT NOT NULL                  (JSON array)
affected_symbols TEXT NOT NULL                (JSON array of CodeNodeID)
risk TEXT NOT NULL                            (low | medium | high)
status TEXT NOT NULL                          (pending | applied | aborted | stale)
graph_cursor_at_creation TEXT                 (commit_sha from code_index_cursor)
time_created INTEGER NOT NULL
time_updated INTEGER NOT NULL

indexes:
  debug_engine_refactor_plan_project_idx (project_id)
  debug_engine_refactor_plan_status_idx (project_id, status)
```

#### `debug_engine_embedding_cache`

```text
node_id TEXT PRIMARY KEY                      (references code_node.id but NO FK — v3 owns that table)
project_id TEXT NOT NULL
signature_hash TEXT NOT NULL                  (invalidation key)
model_id TEXT NOT NULL                        (which embedding model produced this)
embedding BLOB NOT NULL                       (raw float32 array)
time_created INTEGER NOT NULL
time_updated INTEGER NOT NULL

indexes:
  debug_engine_embedding_cache_project_idx (project_id)
  debug_engine_embedding_cache_sig_idx (project_id, signature_hash)
```

**Why no foreign key to `code_node`:** ADR-002 requires that DRE does not modify the v3 schema. A cross-table FK would force a v3 migration. Instead, stale rows are pruned opportunistically: when DRE looks up a cached embedding for a `node_id` and `CodeIntelligence.getSymbol` returns null, DRE deletes the stale cache row before computing a new one.

### 5.5 Event bus

Six new events registered via `BusEvent.define`:

- `debug-engine.analyze.started`
- `debug-engine.analyze.completed`
- `debug-engine.plan.created`
- `debug-engine.apply.started`
- `debug-engine.apply.completed`
- `debug-engine.apply.aborted`

TUI subscribes for progress display. The replay subsystem captures these automatically (same as any other Bus event). No additional audit code required.

### 5.6 Explain field

Every DRE output carries:

```ts
namespace DebugEngine {
  export type Explain = {
    source: "debug-engine"
    tool: "analyze-bug" | "plan-refactor" | "detect-duplicates" | "detect-hardcodes" | "analyze-impact" | "apply-safe-refactor"
    queryId: string
    graphQueries: string[]          // query IDs from CodeIntelligence.Explain.queryId
    heuristicsApplied: string[]     // human-readable tags
    indexedAt: number               // min(indexedAt) across graph queries consulted
    completeness: "full" | "partial" | "lsp-only"  // min() across graph queries (from v3 enum)
    truncated?: boolean             // set on feature outputs where BFS / budget could truncate
  }
}
```

Note on `completeness`: this enum has a **specific v3 meaning** (`"full"` = LSP precise, `"partial"` = tree-sitter symbols only, `"lsp-only"` = LSP gaps). DRE propagates the minimum `completeness` across all graph queries it consulted, but does **not** reuse this enum to signal DRE's own truncation. DRE-side truncation (depth cap, node budget, time budget) is carried as a separate `truncated: boolean` on the feature result and explain fields.

---

## 6. Phased delivery

### Phase 1 — MVP (Sprint 1-3)

**Hard dependency:** v3 Phase 2 cross-file `calls` and `references` edges landed and stable.

**Ships:**

- [ ] `src/debug-engine/` directory, namespace skeleton
- [ ] `analyzeBug` — stack trace parser (TS only) + chain resolution + LLM reasoning step
- [ ] `detectDuplicates` — AST + embedding hybrid for functions/methods
- [ ] `planRefactor` — basic extract/rename plans, persisted in SQLite
- [ ] `debug_engine_refactor_plan` + `debug_engine_embedding_cache` tables and migration
- [ ] Tool wrappers for `debug_analyze`, `dedup_scan`, `refactor_plan` (gated on `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE`)
- [ ] `Explain` field threaded through all outputs
- [ ] `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE` flag added to `flag/flag.ts`
- [ ] Test suite: ≥50 tests, unit + e2e on ax-code self-repo
- [ ] No LLM calls in deterministic paths (measured as a ratio, reported in telemetry)

**Exit gates:**

- `bun test` green from `packages/ax-code`
- `bun typecheck` green
- Self-test on ax-code repo produces non-empty results for all three features
- `debug` agent prompt updated; manual session shows it using `debug_analyze`
- Flag off = zero DRE tools registered (verified by tool registry snapshot test)

### Phase 2 — Impact + Hardcode + Python (Sprint 4-5)

- [ ] `analyzeImpact` with BFS + risk scoring
- [ ] `detectHardcodes` with pattern library
- [ ] Python stack trace parser in `analyzeBug`
- [ ] Improvements to plan risk classification based on Phase 1 telemetry
- [ ] Tool wrapper for `impact_analyze`
- [ ] Event bus integration for TUI progress

**Exit gates:**

- Impact analysis covers ≥90% of known callers on benchmark
- Hardcode detector <10% false positive on labeled set
- `build` agent prompt updated

### Phase 3 — Safe Refactor (Sprint 6-8)

**Soft dependency:** v3 Phase 2 `imports` edges ideally landed, otherwise safe mode falls back to full test suite (§4.5 step 6).

- [ ] Shadow worktree helper (`git worktree` + `InstanceState`)
- [ ] `applySafeRefactor` pipeline: generate → typecheck → lint → test → apply/rollback
- [ ] Test selection via `findDependents` (with full-test fallback)
- [ ] Tool wrapper `refactor_apply` with `ask` permission
- [ ] Audit integration — every apply recorded via existing Bus/recorder
- [ ] Aggressive mode (opt-in, TUI confirmation per call)

**Exit gates:**

- Stress test: 1000 runs, zero orphan worktrees, zero partial applies
- End-to-end: start from a real refactor plan on ax-code repo, apply, verify typecheck + tests pass
- Rollback path exercised in test suite
- Safe mode with uncommitted changes triggers an `ask` event (verified)

### Phase 4 (deferred, separate PRD)

- Cross-repo impact (depends on v3 multi-repo graph)
- AX Control integration — policy-gated refactor scopes, organizational audit
- Historical blame correlation in root cause
- Go / Rust stack trace parsing

---

## 7. Success metrics

### Technical (measured by telemetry via `metrics_query`)

| Metric | Target | Measurement |
|---|---|---|
| DRE tool call share of total tool calls | ≥15% at Phase 3 | `metrics_query` on `tool.call` events |
| Deterministic-path ratio in `analyzeBug` | ≥40% (no LLM call) | DRE internal counter |
| Mean `analyzeBug` latency, chain ≤5 | <3s | `timer_start` / `timer_stop` |
| Refactor plans that reach `apply` | ≥30% | plan status transitions |
| Safe-mode abort rate | 10–30% | plan status = `aborted` (healthy: finding real problems) |
| Orphan shadow worktrees | 0 | git worktree list audit in tests |
| `refactor_apply` real-worktree writes on failed check | 0 | enforced by test, any non-zero is a P0 bug |

### Product

| Metric | Target |
|---|---|
| Users invoking DRE tools ≥1×/week | ≥50% of DAU |
| "Why" prompts routed through `debug_analyze` | ≥70% |
| Dedup scan adoption (weekly) | ≥30% |
| NPS on refactor experience | +10 pts vs. pre-DRE baseline |

### Qualitative (inherited from v3 PRD)

- Replays of past sessions show fewer "I'm not sure" / "based on the code it looks like" hedge phrases in agent output
- Zero "hallucinated function name" incidents in DRE output (verified by `explain.graphQueries` always pointing at real queries)

---

## 8. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| v3 Phase 2 `calls` edges ship late or incomplete | Medium | High — blocks 4 of 5 features | Phase 1 scope-down: ship `detectDuplicates` (only needs nodes) first as proof of value |
| v3 Phase 2 `imports` edges ship later than `calls` edges | Medium | Medium — blocks test selection in safe mode | Full-test fallback spec'd in §4.5 step 6; does not block Phase 3 |
| LLM hallucinates in `analyzeBug` reasoning step | High | Medium | Hard rule: any claim must cite a resolved frame; unresolvable claims dropped at validation (enforced in code, not just prompt) |
| Dedup false positives annoy users | Medium | Medium | Conservative default threshold (0.85); rank by value; include "ignore this cluster" workflow in Phase 2 |
| Safe refactor test selection misses a test | Medium | High | Opt-in "run all tests" flag; test selection shown in plan before apply; full-test fallback if `findDependents` returns empty |
| Shadow worktree disk cost | Low | Low | Auto-clean on disposal; disk-usage telemetry; max 3 concurrent per project |
| Users bypass safe mode and break things | Medium | Medium | Aggressive mode requires explicit TUI confirmation **per invocation**, not a persistent config flag |
| DRE becomes a catch-all for "smart code stuff" | High | Medium | Scope discipline: these 5 features only in v1; new features require a new PRD section |
| Regression in v3 graph query performance under DRE load | Medium | High | Query budgets per DRE call; circuit breaker if graph queries exceed budget; load tests in CI |
| DRE modifies v3 tables (schema drift) | Medium | High | ADR-002 and ADR-004 forbid writes to v3 tables; enforced by test hooks that snapshot `code_node` / `code_edge` / `code_file` row counts before and after every DRE call |

---

## 9. Open questions

1. **Embedding model for dedup** — local (slow, private) vs. provider-mediated (fast, network). Default: local small model, fall back to configured provider only if explicitly enabled. Needs model selection decision (spike) before Phase 1 start.
2. **Language coverage for stack trace parsing** — v1: TypeScript only. v2: Python. v3+: Go, Rust. TS covers >80% of current sessions; Python is the next most common.
3. **Test selection algorithm accuracy** — file-level via `findDependents` + full-test fallback in v1. Function-level tracking is a v2 problem (requires graph extensions in v3).
4. **Plan staleness policy** — recommendation: plan is stale when any row in its `affectedFiles` has changed in `code_file` since the plan's `graph_cursor_at_creation`. Simple, deterministic, uses existing state.
5. **Interaction with existing `plan` tool** — refactor plans vs. `plan.ts` plans serve different purposes (`plan.ts` manages agent plan-enter/exit state). Recommendation: keep separate; refactor plans persist in DRE's own table.
6. **Aggressive mode discoverability** — hidden behind `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE_AGGRESSIVE` flag in v1; promote to first-class only if users ask.
7. **Embedding cache invalidation on graph rebuild** — when v3 reindexes a file, DRE's embedding cache for nodes in that file becomes stale. Simplest: use `signature_hash` as the cache key; a rebuild that produces a matching signature reuses the cached embedding automatically. Cleanup of truly orphaned rows runs on a periodic timer, not synchronously.

---

## 10. Decision principles (inherited from v3 PRD)

1. **Deterministic first, LLM last.** Every DRE pipeline must have a deterministic path; LLM reasoning only as a reasoning step over already-resolved data.
2. **Explainable by construction.** No result without an `explain` field. No claim without a cited graph query or heuristic.
3. **No new runtimes.** TypeScript + Bun + SQLite. Rust is rejected explicitly in ADR-001.
4. **Compose, don't replace.** Build on `CodeIntelligence`, `apply_patch`, `diagnostics`, `bash` — do not build parallel infrastructure.
5. **Humans in the loop on writes.** Read paths can be autonomous; write paths always go through permission `ask` unless the user has explicitly approved.
6. **Scope discipline.** Five features. Not six. Anything else is a new PRD.
7. **Do not modify v3 tables.** DRE reads `code_node` / `code_edge` / `code_file` / `code_index_cursor`. Writes go to DRE-owned tables only.

---

## 11. Appendix A — Relationship to the v3 PRD

| v3 PRD element | DRE dependency |
|---|---|
| O1 — Deterministic code understanding | DRE consumes; all 5 features require resolved symbols |
| O2 — Persistence across sessions | DRE refactor plans persist alongside the graph |
| O3 — Explainable queries | DRE extends with its own `Explain` extension |
| O4 — Policy-aware filtering (worktree scope) | DRE inherits; all DRE tools default to `scope: "worktree"` |
| O5 — No v2.1 regression | DRE runs as a strict consumer; no LSP client changes |

DRE is the **first consumer PRD** built on v3. If DRE surfaces a gap in the graph (missing edge kind, missing node attribute), the fix belongs in the v3 PRD, not here.

---

## 12. Appendix B — Explicit rejections of the source proposal

This PRD intentionally diverges from the upstream proposal in the following ways. Each divergence has a reason rooted in the ax-code codebase as it exists today.

| Source proposal | This PRD | Reason |
|---|---|---|
| Rust core engine | TypeScript/Bun subsystem | ADR-001: core ax-code is 100% TS; zero Rust in `packages/ax-code/`; Rust crosses an architectural boundary that cannot be justified by the performance targets in §7 |
| New code graph / in-memory index | Reuse v3 `CodeIntelligence` | v3 already ships nodes, edges, files, cursor, scoping, explainability; duplicating this is pure cost |
| Adapter layer for LSP | Not needed at DRE level | v3 already wraps LSP; DRE talks to v3, not LSP directly |
| Sandbox tiers (read-only, workspace-write, full-access) | Reuse rule-based permissions + worktree scope | ax-code does not have categorical sandbox tiers; permission is rule-based (`{permission, pattern, action}`), and DRE maps cleanly onto it via preset edits and `ask` actions |
| Standalone "Debugging Engine" product | Subsystem of ax-code | DRE is a set of tools surfaced through existing agents; productizing it separately would fork the agent UX |
| Graph database (Neo4j etc.) eventually | Stay on SQLite | v3 PRD already defers this; no evidence of the workload demanding it |
| Phase 1 includes impact + hardcode | Phase 2 | Phase 1 has a hard dependency on v3 Phase 2 `calls` edges; scope the MVP to what ships fastest |
| "Piggyback on CodeGraphBuilder visitor" for hardcode detection | Separate DRE-owned AST pass | ADR-004: DRE does not modify v3 components; hardcode scan is a standalone pass |
| `kebab-case` tool IDs (`debug-analyze`, etc.) | `snake_case` (`debug_analyze`, etc.) | Matches existing convention (`code_intelligence`, `apply_patch`, `external_directory`) |

The spirit of the source proposal is preserved: deterministic, explainable, debug- and refactor-focused, safe-apply by default. The implementation is grounded in the codebase that already exists.
