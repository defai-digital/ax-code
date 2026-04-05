# ADR — AX Code Debugging & Refactoring Engine

**Document Version:** 0.2 — Draft (post-review)
**Date:** 2026-04-05
**Status:** Draft — Pending review
**Companion PRD:** `automatosx/prd/PRD-debug-refactor-engine.md`
**Related:** `automatosx/prd/PRD-lsp-v3-code-intelligence-runtime.md`

This ADR is a set of twelve architecture decisions for the Debugging & Refactoring Engine (DRE) introduced in the companion PRD. Each entry follows the same structure: **context → options → decision → consequences**, and references the existing ax-code codebase rather than greenfield assumptions.

---

## Codebase ground truth (verified)

Before any decision, these facts about the current state of `packages/ax-code/` are taken as given:

1. **Core is 100% TypeScript/Bun.** No Rust, no Go, no WASM in `packages/ax-code/src/`. Rust only exists in `packages/desktop/src-tauri/` (Tauri wrapper, unrelated to core).
2. **`CodeIntelligence` v3 exists.** `packages/ax-code/src/code-intelligence/` ships nodes, edges, files, cursor, worktree scope filtering, and an `explain` field on every result. Phase 2 (cross-file `calls` edges) is in-flight (see `builder.ts` uncommitted changes, commit `cfdaa8d`). `findImports` / `findDependents` are declared but currently return empty pending Phase 2 `imports` edge ingestion (see `code-intelligence/index.ts:260-301`).
3. **LSP v2.1 is hardened** — retry, health checks, incremental sync, per-client isolation. Not a concern for DRE.
4. **A `debug` agent exists** (`src/agent/agent.ts`, prompt in `prompt/debug.txt`) — it is a read-only ReAct-mode agent, not a debug *engine*. Orthogonal to DRE.
5. **Permission is rule-based**: `{ permission, pattern, action }` where action is `allow | deny | ask`. There are no categorical sandbox tiers. Permission **presets** (`agent/permission-presets.ts`) are hard-coded factories, not extension points — adding tools means editing each preset's config object directly.
6. **Tool IDs are `snake_case`** by convention: `code_intelligence`, `apply_patch`, `external_directory`, `web_fetch`.
7. **Experimental tools are flag-gated** via `flag/flag.ts` env vars (e.g. `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` gates the existing `code_intelligence` tool — see `tool/code-intelligence.ts:14`).
8. **`completeness` enum has specific v3 meaning**: `"full"` = LSP-indexed precise, `"partial"` = tree-sitter symbols only, `"lsp-only"` = LSP-indexed with gaps. It is **not** a generic "truncated result" marker.
9. **Storage is SQLite via Drizzle**, migrations generated from `packages/ax-code` via `bun run db generate --name <slug>`.
10. **Tool invocations are auto-audited** — the session recorder emits `tool.call` / `tool.result` events for every tool call, so new tools get audit trail + replay for free (see comment at `tool/code-intelligence.ts:10-12`).
11. **Effect + Bun APIs** are the style norm. See `CLAUDE.md` for mandatory style rules (no semicolons, single-word locals, namespace modules, Effect.gen patterns).

Decisions below are constrained by these facts. Any option that requires violating them needs explicit justification, not silent assumption.

---

## ADR-001 — Language and runtime: TypeScript/Bun, not Rust

### Status
✅ **Accepted**

### Context
The upstream proposal for DRE suggests a "Rust core engine" for performance on CPU- and memory-bound analysis. The current codebase has zero Rust in `packages/ax-code/` and a mature TypeScript + Effect codebase that DRE must integrate with.

### Options

| Option | Pros | Cons |
|---|---|---|
| A. Rust core, TS thin shell | Peak performance, memory control | New toolchain; FFI boundary; duplicates Effect patterns; crosses a major architectural boundary for no measured need |
| B. Full TypeScript/Bun | Zero friction; reuses Effect, Drizzle, Bus, Instance state, permission system | Theoretical ceiling lower than Rust |
| C. Hybrid via NAPI/WASM for hot paths only | Narrow surface; theoretical best-of-both | Forces a hot-path budget we don't yet have; WASM debugging in Bun is nontrivial |

### Decision
**Option B — TypeScript/Bun.**

### Reasoning
1. The PRD's performance targets (§7) are achievable in TypeScript:
   - `analyzeBug` <3s for chain ≤5 — dominated by graph queries + one LLM call
   - `analyzeImpact` <1s for depth 3 — pure BFS over already-indexed SQLite rows
   - Dedup scan <30s for `packages/ax-code` — AST walk + embedding for a few hundred symbols
2. The heavy lifting (AST parsing, LSP RPC, graph queries, SQLite) is **already in TS** and already performant enough for v3.
3. A Rust core would duplicate `InstanceState`, `Bus`, Effect runtimes, Drizzle access, permission evaluation — every bridge would be a maintenance cost.
4. If a hot path is later measured to need Rust, it can be introduced **per-function** via a NAPI addon without rewriting DRE.
5. "We might need Rust someday" is not an architecture decision; it's a future option.

### Consequences
- DRE lives in `packages/ax-code/src/debug-engine/`, same build, same tests, same `bun typecheck`.
- No new toolchain for developers, no new CI steps.
- Performance is a measured concern, revisited if a benchmark fails (ADR-011).
- Rust remains available for `packages/desktop/src-tauri/` only.

---

## ADR-002 — Build on `CodeIntelligence`, never modify it

### Status
✅ **Accepted**

### Context
`CodeIntelligence` v3 already provides symbol lookup, reference/caller/callee queries, worktree scoping, and explainability. The upstream proposal describes an "in-memory index" and "shallow dependency scan" that would re-implement most of this. A softer failure mode is easier: "just add a column to `code_node` for embeddings" or "hook the `CodeGraphBuilder` visitor to also detect hardcodes". Both would pollute v3.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. DRE builds its own parallel index | Decoupled | Duplicates v3; drift risk; two watchers; two places to update on schema change |
| B. DRE is a strict read-only consumer of `CodeIntelligence` + DRE-owned side tables for its own state | Zero duplication; inherits scope + explain; DRE has its own storage for things v3 doesn't care about | Tightly coupled to v3 API stability |
| C. DRE extends v3 schema (adds columns, hooks builder visitor) | Shared storage | Forces v3 PRD changes for every DRE feature; tightly couples two roadmaps |

### Decision
**Option B — DRE talks only to `CodeIntelligence`'s public namespace** (`packages/ax-code/src/code-intelligence/index.ts:23`). DRE:

- **Reads** from `code_node`, `code_edge`, `code_file`, `code_index_cursor` via the public API (never via `CodeGraphQuery` directly, never via raw SQL)
- **Never writes** to those tables
- **Never adds columns** to those tables
- **Never hooks** `CodeGraphBuilder` visitors or `CodeGraphWatcher` callbacks
- **Stores its own state** (refactor plans, embedding cache) in DRE-owned tables under `debug_engine_*`

### Enforcement
The rule is enforced in tests: every DRE unit test takes a row-count snapshot of `code_node` / `code_edge` / `code_file` before and after the DRE call and asserts no delta.

### Consequences
- Any DRE feature that needs data not currently in v3 (e.g. function body AST, literal positions) must be added **to v3** via a PR against the v3 PRD, not bypassed.
- DRE is blocked on v3 Phase 2 (`calls` and `references` edges) for 4 of 5 features. The PRD phases around this.
- When `CodeIntelligence` evolves, DRE is updated; when DRE evolves, v3 stays still.
- The hardcode detector (PRD §4.3.2) is a separate DRE-owned AST pass, not a builder hook.

---

## ADR-003 — Storage: reuse SQLite + Drizzle, add two tables

### Status
✅ **Accepted**

### Context
DRE needs to persist (a) refactor plans for review, re-apply, and staleness detection, and (b) embedding cache for dedup detection. Both are DRE-owned state per ADR-002.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. JSON files under `.ax-code/debug-engine/` | Easy to inspect | No transactions; stale detection manual; inconsistent with rest of project |
| B. New SQLite tables via Drizzle migration | Consistent; transactional; queryable; participates in existing backup/replay | One migration to write |
| C. Reuse `session` or `code_node` tables with discriminator columns | No new tables | Overloads tables shaped for other purposes; violates ADR-002 for `code_node` |

### Decision
**Option B — two new tables**, both under `packages/ax-code/src/debug-engine/schema.sql.ts`. Migration generated via `bun run db generate --name add_debug_engine_tables`.

**Tables (full schema in PRD §5.4):**
1. `debug_engine_refactor_plan` — persisted refactor plans with status, risk, affected symbols, and `graph_cursor_at_creation` for staleness detection
2. `debug_engine_embedding_cache` — DRE-owned embedding cache for dedup; keyed by `(project_id, node_id)` with `signature_hash` for invalidation

### Consequences
- Follows the existing convention: `*.sql.ts` per subsystem, snake_case tables, `Timestamps` helper for time_created / time_updated.
- No new storage backends. No vector DB (see ADR-004).
- No foreign key from `debug_engine_embedding_cache.node_id` to `code_node.id` — a cross-table FK would force a v3 migration, violating ADR-002. Stale rows are pruned opportunistically on cache miss.
- Staleness detection for plans uses the existing v3 `code_index_cursor` as the watermark.

---

## ADR-004 — No vector DB; embeddings are in-process and cached in DRE's own table

### Status
✅ **Accepted**

### Context
Duplicate detection needs **semantic similarity**, not just AST equality. The obvious answer is embeddings. The obvious overreach is standing up a vector database. A subtler mistake is adding an `embedding BLOB` column to `code_node` — that would violate ADR-002.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. Full vector DB (Qdrant, Chroma, sqlite-vss) | Scales to huge corpora | New runtime dependency; overkill for a few thousand functions; ops burden |
| B. In-process embeddings, ephemeral per-scan | Zero new infrastructure; zero schema changes | Recomputed on every scan; slower |
| C. In-process embeddings, cached in a v3-owned `code_node.embedding` column | Shared cache | Forces v3 schema change; violates ADR-002 |
| D. In-process embeddings, cached in a DRE-owned `debug_engine_embedding_cache` table | No v3 impact; persists across scans | Slightly more glue code for staleness |

### Decision
**Option D** — embeddings computed in-process via a small local model. Cached in `debug_engine_embedding_cache` (see ADR-003) keyed by `(project_id, node_id, signature_hash, model_id)`. Cache is invalidated by `signature_hash` — if v3 reindexes a file and the function's normalized AST signature changes, the cache miss is automatic.

### Reasoning
- Dedup scans operate on symbols already in the graph. At ax-code scale, "a few thousand function-like nodes" is trivially RAM-resident; cache mainly helps on repeated scans.
- `sqlite-vss` is available but adds a runtime dependency; a simple cosine similarity loop over cached vectors is fast enough for the target scale.
- DRE-owned table preserves the ADR-002 boundary cleanly.
- If a user enables a provider-based embedding model via `ax-code.json`, DRE uses it (opt-in only). The `model_id` column means different models can coexist in the cache without collision.

### Consequences
- PRD §4.3.1 pipeline is honest about what happens: AST signature hash → exact/structural duplicates free; near-duplicates via cached embedding cosine.
- Embedding computation only runs on cache miss.
- No new database dependency. No Qdrant, no Chroma, no FAISS, no sqlite-vss.
- If v3 rebuilds the graph (e.g. fresh index), DRE's cache is automatically invalidated by signature hash mismatch — no explicit flush needed.

---

## ADR-005 — Root Cause Debugger: deterministic-first, LLM-last hybrid

### Status
✅ **Accepted**

### Context
The hardest question in AI debugging: how do you reason about causality without hallucinating? Pure LLM approaches hallucinate function names and invariants. Pure rule-based approaches miss anything novel.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. Pure LLM — feed stack trace + code context, ask for root cause | Simple; maximally general | High hallucination rate; non-auditable |
| B. Pure deterministic — stack trace parsing + fixed rule library | Explainable; replayable | Covers only known patterns; brittle |
| C. Hybrid: deterministic pipeline resolves all frames to real graph nodes, LLM does a final reasoning step over the resolved chain | Catches novel bugs without hallucinating frame names; explainable chain | More moving parts |

### Decision
**Option C — Hybrid with a hard invariant: every LLM claim must cite a resolved frame index from the deterministic pipeline.** Unresolvable claims are dropped at validation time before being returned to the caller. This is enforced **in code**, not in the prompt — the prompt asks the LLM to cite; the validator drops anything that doesn't.

### Pipeline (same as PRD §4.1)

```text
1. Parse stack trace (regex + per-language extractor)
2. Resolve each frame to a CodeIntelligence.Symbol
3. Build call chain via findCallers/findCallees (depth ≤ 5)
4. Rule-based filtering (drop node_modules, generated, etc.)
5. Constrained LLM call — "given this resolved chain, what's the broken invariant?"
6. Validate LLM output — drop any claim that doesn't cite a real frame index
7. Compute confidence from chain completeness × LLM self-reported confidence, capped at 0.95
```

### Consequences
- If the stack trace is fully resolvable and matches a known pattern, **no LLM call is made**. This is a measurable metric (PRD §7, "deterministic-path ratio").
- The LLM sees only **resolved symbol signatures**, never raw file bytes it has to interpret from scratch.
- `confidence` is capped below 1.0 by design — we never claim certainty.
- The "cite or drop" invariant is exercised in unit tests with adversarial LLM outputs (mocked responses that make up frame numbers) to prove the validator drops them.

---

## ADR-006 — Refactor execution: Plan → Validate → Apply, never shortcut

### Status
✅ **Accepted**

### Context
The entire point of the "Safe Refactor Mode" is that the engine **never silently modifies files**. Shortcutting any step defeats the feature.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. LLM generates patch, writes directly, runs tests after | Simple | Broken repo if tests fail mid-sequence |
| B. LLM generates patch, writes to shadow copy, validates, promotes | Atomic | Needs a shadow worktree mechanism |
| C. LLM generates plan (no patch), human reviews, then separate apply step runs validation pipeline | Maximal safety; explicit review gate | Two-step UX |

### Decision
**Option C**, with four hard rules:
1. `planRefactor` **never writes files**. Ever. Verified by tests that hook `apply_patch`, `write`, and `edit`.
2. `applySafeRefactor` **always** runs typecheck + lint + targeted tests in a shadow worktree before touching the real worktree.
3. Any check failure in safe mode = **zero files modified in the real worktree**, verified by `git status` diff in tests.
4. Aggressive mode (opt-in) requires a **per-invocation** TUI confirmation. It is not a persistent config flag. Even aggressive mode never skips typecheck.

### Consequences
- DRE needs a **shadow worktree** primitive. See ADR-007.
- `apply_patch`, `diagnostics`, and `bash` are reused — DRE calls them via the existing tool interface, not a new runtime.
- Plans are persisted (ADR-003), so they can be reviewed, edited, and re-applied later.
- Users cannot accidentally turn off safety. Turning it off requires a deliberate act each time.

---

## ADR-007 — Shadow worktree: git worktree + InstanceState, not a new sandbox

### Status
✅ **Accepted**

### Context
Safe refactor mode needs a write-capable copy of the project where validation runs before promotion. The upstream proposal mentions "local execution sandbox" and "execution isolation" — but ax-code already has a permission model and does not have categorical "sandbox tiers". Inventing one would duplicate existing infrastructure.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. Build a new sandbox abstraction (process jail, chroot, container) | Strong isolation | Huge scope; duplicates permission system; new security surface |
| B. Use `git worktree add` to a temp directory; run checks there; promote via `git apply` back to main worktree | Native to git; no new primitive; atomic | Requires clean git state; worktree lifecycle management |
| C. Copy files to `/tmp/`, run there, diff back | Simple | Not atomic; no git semantics; loses mode bits, symlinks |

### Decision
**Option B — `git worktree`**, managed via an `InstanceState`-scoped helper that creates, uses, and tears down a shadow worktree per `applySafeRefactor` call.

### Details
- Shadow worktrees are created under `automatosx/tmp/dre-shadow/<planId>` (respects the `automatosx/tmp/` convention from `CLAUDE.md`).
- Branch name: `ax-code/dre/shadow-<planId>`.
- Tied to `Instance.directory` via `InstanceState`, so per-directory cleanup semantics apply.
- Auto-removal on both success and failure (`Symbol.asyncDispose` pattern, same as the test fixture `tmpdir` helper).
- Hard cap: **3 concurrent shadow worktrees per project**. Over-cap = queue, not error.
- If the project has uncommitted changes at invocation time, safe mode **asks** (via existing permission Bus event) before creating a shadow worktree.

### Consequences
- No new sandbox abstraction. Zero new security surface.
- Reuses `git` as the source of truth for file state.
- Stress test target: 1000 runs, zero orphan worktrees (PRD §6 Phase 3 exit gate).
- Disposal is exercised in tests via forced abort paths (kill, exception, timeout).

---

## ADR-008 — Impact analysis: BFS over v3 edges, bounded, with its own truncation flag

### Status
✅ **Accepted**

### Context
Change impact is transitive closure over `calls` and `references` edges. The v3 graph has these (after Phase 2 edge ingestion lands). The question is how far to walk, how to avoid performance cliffs, and how to signal partial results without hijacking the v3 `completeness` enum.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. Full closure (unbounded BFS) | Complete | Unbounded latency on fan-out hotspots (a utility with 1000+ callers) |
| B. Bounded BFS, fixed depth | Predictable latency | Might miss deep impact |
| C. Bounded BFS with a visit budget and graceful truncation | Predictable latency + coverage tracking | Slightly more complex |

### Decision
**Option C** — BFS with two limits:
- **Depth** — default 3, max 6 (configurable per call)
- **Visit budget** — default 2000 unique nodes, hard cap 10000
- If the budget or depth cap is exhausted, the result sets a **DRE-owned `truncated: boolean` flag** on the output and the explain field, and returns what was found.

### Important: do not reuse v3's `completeness` enum for truncation
The v3 `completeness` enum has a specific, narrow meaning defined in `code-intelligence/schema.sql.ts:123`:
- `"full"` = file was indexed via LSP (precise)
- `"partial"` = file was indexed via tree-sitter (symbols only, no cross-references)
- `"lsp-only"` = LSP was used but the server didn't answer some queries

Hijacking this enum to mean "DRE truncated the BFS" would corrupt its semantics across the codebase. DRE's `Explain` still propagates the minimum `completeness` across graph queries it consulted, but DRE's own truncation is a separate boolean.

### Consequences
- Latency targets in PRD §7 are achievable by construction.
- A user asking "what does `log.info` affect" gets a truthful "this is too big to fully traverse, here's what we found, and `truncated: true`" instead of either a lie or a hang.
- If `truncated` is true, `riskLabel` is forced to **high** (absence of evidence is not evidence of safety).
- The `path: CodeNodeID[]` field gives users a shortest-path chain from any affected symbol back to a seed — useful for "why does this depend on that?" drill-down.

---

## ADR-009 — Duplicate detection: AST structural bucketing, embedding for near-matches, DRE-owned AST pass

### Status
✅ **Accepted**

### Context
Three grades of duplicate: (1) byte-for-byte (useless; `grep` handles it), (2) structural duplicates after normalizing identifiers (the common case), (3) semantic duplicates that look different but do the same thing (the valuable case). The detector also needs to walk the AST — but ADR-002 forbids modifying `CodeGraphBuilder`.

### Options
| Option | Pros | Cons |
|---|---|---|
| A. String/regex match | Trivial | Catches only grade 1 |
| B. AST structural hash only | Catches grades 1–2 | Misses grade 3 |
| C. AST + embedding hybrid, hook into `CodeGraphBuilder` visitor | Reuses one AST walk | Violates ADR-002 |
| D. AST + embedding hybrid, DRE-owned AST pass | Catches 1–3; preserves ADR-002 | Separate AST walk from v3 ingestion |

### Decision
**Option D** — DRE runs its own AST walk over files in scope, using the same parser dependencies v3 uses (tree-sitter or per-language equivalent) but a separate pass. AST signatures are hashed; singletons above minimum body size are embedded and compared.

### Pipeline
1. For each candidate symbol, compute **normalized AST signature hash** — locals renamed, literals bucketed (numbers → N, strings → S unless unique), keyword order preserved
2. Group by hash → every group of size ≥2 is a grade-1 or grade-2 duplicate cluster, zero ML involved
3. For singletons above minimum body size, compute embedding (cached per ADR-004)
4. Pairwise cosine similarity within the singleton pool; threshold default 0.85
5. Rank clusters by `size × lines × cross-file-spread`
6. Each output cluster carries a `tier: "exact" | "structural" | "semantic"` so users can filter

### Consequences
- ~80% of duplicates in a real codebase are grade 1–2 and cost nothing beyond the AST walk.
- Embedding only runs on the residual, which is a small set per project.
- No cloud round-trip in the default path.
- DRE's AST pass is slower than piggybacking on v3's visitor — acceptable trade-off for the ADR-002 boundary. If this becomes a measured bottleneck, the right fix is to add a generic AST-walk hook to v3 (via a v3 PRD change), not to violate the boundary.

---

## ADR-010 — Permission, scope, and registration: reuse v3 patterns, edit presets directly

### Status
✅ **Accepted**

### Context
The upstream proposal mentions categorical sandbox levels ("read-only, workspace-write, full-access"). These **do not exist** in ax-code. The actual permission model is rule-based (`{ permission, pattern, action }`), and `CodeIntelligence` already has a `Scope = "worktree" | "none"` filter. Additionally, the permission presets in `agent/permission-presets.ts` are hard-coded config objects — not extension points.

### Decision

1. **DRE does not introduce sandbox tiers.** The term is banned from the DRE codebase and docs.
2. **DRE tool IDs are `snake_case`**: `debug_analyze`, `refactor_plan`, `dedup_scan`, `impact_analyze`, `refactor_apply`. This matches existing conventions (`code_intelligence`, `apply_patch`, `external_directory`).
3. **Read-only DRE tools** (`debug_analyze`, `refactor_plan`, `dedup_scan`, `impact_analyze`) are added directly to the config objects returned by `readOnlyWithWeb` and `readOnlyNoWeb` in `agent/permission-presets.ts`. This requires editing those preset factories — there is no extension registry.
4. **Write tool** (`refactor_apply`) is not added to any read-only preset. It is gated through the existing permission system with a default action of `ask`, exactly like `edit` and `write`.
5. **Scope** — every DRE tool accepts a `scope` parameter that defaults to `"worktree"`, mapping 1:1 onto `CodeIntelligence.Scope`. Out-of-worktree results are dropped at the DRE layer, not just at the graph layer.
6. **Experimental flag gating** — all five DRE tools are additionally gated on `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE` (new env var in `flag/flag.ts`). Tools do not register in the tool registry unless the flag is set. Mirrors the pattern in `tool/code-intelligence.ts:14` for the `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` flag.
7. **Agent tool lists** — DRE tools become available to existing agents (`debug`, `build`, `react`, `plan`, `architect`) via agent prompt updates + preset edits. No new agents.

### Consequences
- Zero changes to `src/permission/` core logic.
- Edits to `agent/permission-presets.ts` are additive (new allow entries in existing preset configs).
- Users who have existing permission rules (deny lists, project policies) automatically inherit protection over DRE tools.
- Worktree scope is the default everywhere, so DRE cannot accidentally leak information about files outside the instance directory even on the read path.
- When the experimental flag is off, DRE is completely invisible — no tools registered, no commands, no prompts referencing DRE functionality.

---

## ADR-011 — Performance strategy: lazy, bounded, cached, with measurable budgets

### Status
✅ **Accepted**

### Context
DRE runs inside the session loop, on the user's machine, while the user is waiting. Latency matters. Existing tools (`code_intelligence.ts`) already use patterns like a hard `MAX_RESULTS = 50` cap — DRE should align with these conventions rather than invent parallel ones.

### Decision
Three principles, applied uniformly:

1. **Lazy** — DRE does no background work of its own. The v3 watcher keeps the graph fresh. DRE runs only when called.
2. **Bounded** — every DRE operation has a latency budget (PRD §7). Operations that would exceed the budget truncate and set `truncated: true` in the output.
3. **Cached** — embedding cache (ADR-004), plan reuse (ADR-003), memoized BFS visited sets per call.

### Specific budgets

| Operation | Target | Hard timeout |
|---|---|---|
| `analyzeBug` (chain ≤5) | <3s | 10s (abort + return partial + `truncated: true`) |
| `planRefactor` (≤20 call sites) | <1s | 5s |
| `detectDuplicates` (per package) | <30s | 120s |
| `analyzeImpact` (depth 3) | <1s | 5s |
| `applySafeRefactor` (typecheck+lint+tests) | depends on repo | project test timeout + 30s |

### Graph query budget

Each DRE call has a cap of **100 graph queries** via `CodeIntelligence.*`. If the call needs more, it truncates the work and marks `truncated: true`. This cap is enforced in code, not by convention.

### Consequences
- Latency regressions are catchable in CI (benchmark suite runs against the ax-code self-repo).
- When budgets trip, users get truthful partial results with `truncated: true`, never hangs.
- Graph query load is bounded per DRE call; if the limit is hit, circuit breaker returns partial results.
- DRE inherits the existing `MAX_RESULTS`-style output caps from the tool layer where applicable.

---

## ADR-012 — API surface: narrow, stable, deterministic shape; audit comes for free

### Status
✅ **Accepted**

### Context
DRE will have multiple consumers: the tool layer (agents), the TUI (progress display via Bus events), replay, and future AX Control (audit, policy). A wide or mutable API costs us everywhere. Additionally, the session recorder already captures `tool.call` / `tool.result` events for every tool invocation — so audit trail and replay come for free if DRE stays on the tool interface.

### Decision

The full DRE public API is **six functions** plus type exports:

```ts
namespace DebugEngine {
  // Types
  type Explain = { ... }
  type RootCauseResult = { ... }
  type RefactorPlan = { ... }
  type DuplicateReport = { ... }
  type HardcodeReport = { ... }
  type ImpactReport = { ... }
  type ApplyResult = { ... }

  // Functions
  function analyzeBug(projectID, input): Promise<RootCauseResult>
  function planRefactor(projectID, input): Promise<RefactorPlan>
  function detectDuplicates(projectID, input): Promise<DuplicateReport>
  function detectHardcodes(projectID, input): Promise<HardcodeReport>
  function analyzeImpact(projectID, input): Promise<ImpactReport>
  function applySafeRefactor(projectID, input): Promise<ApplyResult>
}
```

Rules:
1. **All inputs take `projectID` as the first positional arg.** Matches `CodeIntelligence` conventions.
2. **All outputs include `explain`.** No exceptions.
3. **Feature outputs that can be partial include `truncated: boolean`.** Separate from v3's `completeness` enum (per ADR-008).
4. **Inputs and outputs are plain objects** (no classes, no Effect types in the public surface). Easier to serialize for Bus events, audit, and replay.
5. **LSP is not exposed.** DRE does not re-export LSP APIs. Consumers that need LSP call LSP directly.
6. **The API is stable** from Phase 1 onwards. New features add new functions; existing signatures do not change without a minor version bump and migration notes.
7. **Audit comes from the tool layer, not DRE.** DRE's namespace functions do not emit audit events themselves — the tool wrappers do, via the session recorder's automatic `tool.call` / `tool.result` capture (same pattern as `tool/code-intelligence.ts:10-12`).

### Consequences
- Tool wrappers in `src/tool/` are thin (each tool maps 1:1 to a DRE function).
- Bus events carry inputs/outputs as-is (serializable).
- Audit trail captures the complete input/output of every DRE call with no additional code.
- Replay can re-run any past DRE call from the recorded input.
- Six functions is the ceiling for v1; new DRE capabilities either extend existing outputs (backward-compatible) or require a new PRD section.

---

## Decisions NOT made here (explicit open questions)

These belong in follow-up ADRs or the PRD §9 open questions list, and are listed here so the omission is intentional:

1. **Which embedding model** — deferred to a Phase 1 spike. Candidates: small sentence transformer via local runtime; optional cloud model if configured.
2. **Cross-language stack trace parsing coverage** — TS in v1, Python in v2, Go + Rust in v3+. Not an architecture decision, a scoping decision.
3. **Plan staleness policy** — leaning toward "stale when any affected file's row in `code_file` has changed since plan creation," but needs validation against real usage.
4. **Test selection algorithm** — file-level via `findDependents` in v1 (with full-test fallback when `imports` edges unavailable); function-level dependency tracking is a v2 problem (requires graph extensions).
5. **AX Control integration** — deferred. When AX Control ships, DRE's audit events and plan persistence are the hookpoints; no protocol defined yet.
6. **Tree-sitter vs LSP-only coverage for dedup** — DRE's AST pass probably uses tree-sitter for parser-independent AST. Exact library selection is a Phase 1 implementation detail.

---

## Summary table — what DRE adds, what DRE does not add

### Adds (net-new)

- `packages/ax-code/src/debug-engine/` directory (one namespace, six functions)
- Five new tools in `src/tool/` with `snake_case` IDs (`debug_analyze`, `refactor_plan`, `dedup_scan`, `impact_analyze`, `refactor_apply`)
- Two new SQLite tables (`debug_engine_refactor_plan`, `debug_engine_embedding_cache`) + one migration
- One shadow-worktree helper (uses existing `git worktree`)
- Six new Bus events (for TUI progress; replay captures them automatically)
- New `AX_CODE_EXPERIMENTAL_DEBUG_ENGINE` flag in `flag/flag.ts`
- Additive edits to `agent/permission-presets.ts` (read-only DRE tools added to `readOnlyWithWeb` and `readOnlyNoWeb` preset config objects)
- Agent prompt updates for `debug`, `build`, `react` (tool list mentions)

### Does not add

- New language runtime (no Rust)
- New code graph or index
- New LSP code
- New permission model or sandbox tiers
- New data store
- New agent framework
- New tool runtime
- New audit subsystem (reuses existing `tool.call`/`tool.result` capture)
- Modifications to v3 tables (`code_node`, `code_edge`, `code_file`, `code_index_cursor`)
- Hooks into `CodeGraphBuilder` or `CodeGraphWatcher`
- Foreign keys into v3 tables from DRE tables
- Auto-apply without user consent
- Background/daemon processes
- Cloud dependencies in the default path
- Replacement for any existing subsystem

---

## Final principle

> DRE is a **reasoning layer**, not an **infrastructure project**.

Every decision above is chosen to keep that true. When a future change proposes new infrastructure in the name of DRE, the burden of proof is on that change to show the reasoning layer cannot do its job without it.
