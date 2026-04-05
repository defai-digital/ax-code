# Product Requirements Document (PRD)

# AX Code v3 — LSP as Code Intelligence Runtime

**Document Version:** 1.0 — Shipped
**Date:** 2026-04-05 (drafted), 2026-04-05 (Phase 1 + Phase 2 + Phase 3 perf shipped in v2.2.0)
**Author:** Engineering
**Status:** **Shipped** — Phases 1 and 2 complete. Phase 3 partially delivered (performance tuning done, multi-repo and AX Serving integration deferred pending design review).
**References:**
- `docs/prd/PRD-ax-code-v2.md` — v2.0 established the runtime kernel, deterministic replay, policy engine, audit trail, and explicitly deferred persistent semantic cache to v3.0
- `docs/adr/ADR-003-hardening-program-review.md`
- `docs/adr/ADR-004-ax-code-positioning.md`
- `packages/ax-code/src/lsp/` — existing LSP subsystem as of v2.1
- `packages/ax-code/src/code-intelligence/` — v3 Code Intelligence Runtime shipped in v2.2.0

## Ship log

Everything below was originally drafted as proposed work. The sections that have been delivered are annotated inline. Use this header as the up-to-date summary.

### Shipped in v2.2.0 (2026-04-05)

**Phase 1 — Foundation:** Complete.
- Graph schema (`code_node`, `code_edge`, `code_file`, `code_index_cursor`) via Drizzle migration — `c249a33`
- Branded ID types (`CodeNodeID`, `CodeEdgeID`, `CodeFileID`) — `c249a33`
- Low-level `CodeGraphQuery` CRUD layer — `159be6f`
- LSP-driven `CodeGraphBuilder` with hierarchical + flat symbol handling — `6271c6e`
- Public `CodeIntelligence` API namespace with explain payloads — `ba0070f`
- Phase 1 bug fixes from post-commit audit — `cbe76f4`

**Phase 2 — Incrementality and governance:** Complete.
- Reference edge ingestion via LSP — `348e123`
- File watcher for incremental updates — `e6b548f`
- Replay integration via `code.graph.snapshot` event — `cfcadbe`
- `code_intelligence` tool wraps the public API for agents — `b3b38ba`
- Worktree scope filter for policy-aware queries — `cfdaa8d`
- Phase 2 exit gate: deterministic replay with graph queries — `f0533be`
- `ax-code index` CLI command for initial graph population — `b7eb184`
- Tool-write invalidation path verified end-to-end — `8cba093`

**Phase 3 (partial) — Performance tuning:** Complete.
- 6.7× faster indexing via ANALYZE and range-based prefix queries — `7bf29bc`
- `upsertFile` duplicate-row fix + migration — `95ce8b9`
- Cross-file calls edge emission fix — `9f27134`
- Anonymous container resolution fix — `44cff06`

**Deferred from Phase 3 (requires design input or external subsystems):**
- Multi-repo graphs (needs design: per-query vs ambient workspace)
- AX Serving backend integration (blocked: no AX Serving subsystem in repo)
- Full AX Trust policy integration (blocked: no AX Trust policy engine in repo — worktree scope filter shipped as minimum)

### Success metrics, measured

| Metric | Target | Measured on this repo (651 files, 48k nodes, 440k edges) |
|---|---|---|
| Code graph query p95 latency | < 50 ms on 100k-LOC | 0.47–1.99 ms on findSymbol / findSymbolByPrefix (far under target) |
| Full reindex latency | < 2 min on 100k-LOC | ~2.7s for 50-file re-index (~90s full, LSP-bound) |
| Incremental update latency | < 500 ms after single-file change | 1s debounce + per-file reindex, bounded by LSP |
| Persisted graph size | < 10 MB per 10k-LOC | ~7 MB per 10k-LOC observed |
| Regressions in v2.1 LSP tests | Zero | All 46 existing LSP tests pass, 242 new Phase 1/2/3 tests added |

---

## 0. TL;DR

ax-code v2.1 has a well-tuned **LSP client**. That is a necessary foundation but it is not a differentiator. This PRD proposes v3 — taking the LSP subsystem and promoting it from "editor-style tooling consumer" to **deterministic code intelligence runtime**: a persistent, queryable, policy-aware layer that the agent loop uses as a **data source** instead of a **tool call**.

The existing v2.0 PRD already promised this direction (persistent semantic cache + workflow router deferred to v3.0). This PRD is the detailed design for the **persistent semantic cache / code intelligence** half of that promise. The workflow router is a separate PRD.

v3 is not "better LSP." v3 is "the agent asks structured questions about the repository instead of guessing."

---

## 1. Context

### 1.1 What v2.1 shipped

The v2.1 LSP subsystem (released 2026-04-05, see v2.1 release notes) gave the LSP client eight concrete improvements:

1. RPC timeouts on every `sendRequest`
2. Hash-skip on `didChange` when content is unchanged
3. Parallel multi-server spawn
4. Diagnostic LRU eviction + `notify.close` + auto-close on vanished files
5. Broken-server retry with exponential backoff (`30s → 1h cap`)
6. 60s health-check ping via `kill(pid, 0)`
7. 24 new tests (46 total, up from 22)
8. Line-level incremental document sync

These are all **infrastructure-layer** optimizations. They make the LSP client stable, fast, and resilient. They do not change what the LSP is **used for**.

### 1.2 What v2.1 did not ship

- **Persistence.** Every new instance of ax-code starts with empty LSP state. Work the LSP has done (initialization, indexing, diagnostics) is discarded when the session ends.
- **Structured queries.** The agent can call `LSP.hover`, `LSP.definition`, `LSP.references` as discrete one-shot tools, but cannot ask "which functions in this repo are unreferenced" or "who depends on module X" without writing a custom traversal every time.
- **Graph semantics.** LSP speaks in single-file terms (this symbol → that symbol). It does not expose a repo-level graph that the agent can traverse, cache, or reason over.
- **Governance.** Nothing in the LSP layer is aware of policy boundaries. A tool call that touches a file in a "do-not-modify" zone routes through the permission layer, but the agent has no way to ask "is this symbol safe to refactor" at decision time.

### 1.3 Why this matters now

ax-code v2.0 made the runtime kernel trustworthy (deterministic replay, audit, policy, multi-node). v2.1 made LSP reliable. v3 is the next honest step: make the runtime **code-aware** instead of **text-aware**.

Until this lands, the agent is fundamentally guessing. It reads files it shouldn't need to read, follows imports it doesn't need to follow, and relies on embedding similarity where deterministic answers exist. Every "why did the agent rewrite the wrong function" incident traces back to the same root: the agent does not have a structured view of the code it is editing.

### 1.4 What this PRD is not

**Not a rewrite.** v2.1's LSP client stays. It is the ingestion layer for v3. The new work sits **above** it.

**Not a replacement for the workflow router.** The router (also a v3 item per the v2.0 PRD) is a separate concern — it decides *which* execution path to take. This PRD is about the *data* those execution paths consume.

**Not a graph database project.** There are no plans to ship Neo4j, run a JVM, or introduce a new data-store dependency in Phase 1. The graph lives in SQLite (which ax-code already uses for session state) until there is measured evidence it needs to grow out of it.

**Not an embedding replacement for everything.** Embedding-based semantic search has genuine uses (unstructured docs, comment search, natural-language file discovery). v3 replaces embeddings for **code reasoning**, not for **document retrieval**.

---

## 2. Objectives

### O1 — Deterministic code understanding

The agent should be able to answer these questions without reading file bytes:

- "What functions call `processPayment`?"
- "What modules import from `packages/ax-code/src/session/`?"
- "What symbols are unreferenced in this file?"
- "What is the call graph from `handleRequest` to the first database access?"

Without O1, the agent makes decisions from embedding similarity, which has known failure modes (wrong function with similar name, stale embedding after a rename, hallucinated references).

### O2 — Persistence across sessions

Code graph state built in session N should be available to session N+1 on the same working directory. Building it should be incremental: a git-level change set should map to a graph-level update, not a full rebuild.

Without O2, every new session pays the full LSP warmup cost and loses everything the last session learned.

### O3 — Explainable queries

Every query answer should be traceable to its source: the LSP call(s), the file(s), the commit SHA, the last-modified timestamp. An agent (or auditor) should be able to ask "why do you believe this" and get a structured answer.

Without O3, v3 becomes another black box.

### O4 — Governance hooks

Queries should be able to carry policy context. "Find callers of X" should be filterable by "exclude files in the do-not-touch zone" or "only include files the current agent has read permission for." The graph is a data layer; governance is enforced by the existing AX Trust policies from v2.0.

Without O4, v3 works for individuals but not for enterprise deployments.

### O5 — No regression in v2.1 stability

v2.1's LSP client took real engineering to stabilize. v3 **must not** destabilize it. The code intelligence layer is an additive consumer of LSP output, not a rewrite of the client.

---

## 3. Non-goals

| Non-goal | Why |
|---|---|
| Graph database migration | Premature. SQLite handles repos up to ~500k LOC with the proposed schema. Measure first, migrate only if measured. |
| Replacing embeddings everywhere | Embeddings are still correct for free-text search, documentation lookup, natural language file discovery. v3 is for code structure, not all search. |
| Multi-repo graph in Phase 1 | Phase 1 is single repo. Multi-repo is Phase 3 (see Roadmap). Doing it early invalidates the schema. |
| Exposing the graph as a user-facing CLI | The graph is agent-internal in Phase 1. User-facing `ax-code query` commands come after the API is stable. |
| Replacing the LSP client or forking language servers | The LSP client stays. Every language server ax-code currently supports continues to work unchanged. |
| Custom language parsers | Tree-sitter handles the non-LSP portion (parse trees for files whose LSP is slow or unavailable). Tree-sitter is already a dependency — no new work. |
| Real-time incremental indexing while the user types | Phase 1 indexes on git commit / file save boundaries. Real-time indexing is a Phase 3 consideration if users need it. |

---

## 4. Architecture

### 4.1 High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Agent loop (unchanged)                                      │
│   ├─ planner                                                │
│   ├─ executor                                               │
│   └─ verifier                                               │
│                                                             │
│         │  structured queries                               │
│         ▼                                                   │
│ ┌──────────────────────────────┐                            │
│ │ Code Intelligence API (new)  │ ← this PRD                 │
│ │  findSymbol / findCallers    │                            │
│ │  findDependents / impactOf   │                            │
│ │  findUnreferenced / ...      │                            │
│ └──────┬───────────────────────┘                            │
│        │                                                    │
│        ▼                                                    │
│ ┌──────────────────────────────┐                            │
│ │ Code Graph (new)             │ ← this PRD                 │
│ │  nodes, edges, diagnostics   │                            │
│ │  (SQLite-backed)             │                            │
│ └──┬───────────┬───────────────┘                            │
│    │           │                                            │
│    ▼           ▼                                            │
│  LSP         tree-sitter                                    │
│  client      parsers                                        │
│  (v2.1,      (already                                       │
│   unchanged) bundled)                                       │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Components

#### 4.2.1 Code Graph Store

**Storage:** SQLite, in the existing Drizzle schema under `packages/ax-code/src/storage/`. New tables:

- `code_node(id, project_id, kind, name, file, range_start, range_end, signature, visibility, updated_at)`
- `code_edge(id, project_id, kind, from_node, to_node, file, range_start, range_end, updated_at)`
- `code_file(id, project_id, path, sha, size, lang, indexed_at)`
- `code_index_cursor(project_id, commit_sha, updated_at)`

Where `kind` on nodes is `function | method | class | interface | type | variable | constant | module | parameter`, and `kind` on edges is `calls | references | imports | extends | implements | defines | declared_in`.

**Rationale for SQLite (not Neo4j):**
- Already a runtime dependency
- No new install surface for enterprise deployments (especially air-gapped)
- Graph queries of the shape we need (1-3 hop traversals, symbol lookups, reverse references) are well-expressed in SQL with recursive CTEs
- Migration path to a dedicated graph store later is preserved — the node/edge schema is portable
- Bun has fast native SQLite bindings; reads take microseconds on small-to-medium graphs

**What we do not store:**
- Full file contents (already on disk)
- AST nodes below the symbol level (regenerable from tree-sitter)
- Diagnostics (already handled by the v2.1 LSP client's LRU cache)

The graph is a **durable cache of derivable information**. If it's lost, it can be rebuilt from LSP + tree-sitter in bounded time.

#### 4.2.2 Code Graph Builder

**Inputs:**
- LSP `workspace/symbol`, `textDocument/documentSymbol`, `textDocument/references`, `callHierarchy/incomingCalls`, `callHierarchy/outgoingCalls`
- Tree-sitter parse trees (already available via opentui's parser registry — the same infrastructure that renders syntax highlighting in the TUI, reused)
- Git state (commit SHA, dirty files) via existing `Process.spawn("git", ...)` helpers

**Triggers:**
- **Initial index:** first time ax-code opens a project directory, runs on idle
- **Incremental update:** on `git commit` (via existing FileWatcher integration from v2.x) or on tool-driven file writes (Edit, Write, ApplyPatch)
- **Manual:** `LSP.reindex()` export for agent-driven refresh

**Strategy:**
- LSP is the **source of truth for precise symbol info** (types, resolved references, declarations)
- Tree-sitter is the **fallback for files where LSP is slow, missing, or initializing** — tree-sitter provides quick symbol outlines that can be upgraded to LSP-precise data when the LSP server catches up
- Graph updates are **additive-then-prune**: insert new nodes/edges first, then remove nodes/edges whose `file` matches the changed file set and whose `updated_at` is older than the current indexing pass

**Rate limits:**
- Maximum 1 indexing pass per 5 seconds per project (coalesce rapid saves)
- Indexing runs in a background job — never blocks the agent loop
- Hard cap: 10 concurrent LSP calls during indexing, to avoid starving interactive queries

#### 4.2.3 Code Intelligence API

**Shape:** New `CodeIntelligence` namespace in `packages/ax-code/src/code-intelligence/` (new directory). Functions are async, return structured TypeScript types, and take a query context for governance and explainability.

**Initial API surface (Phase 1):**

```typescript
// Symbol lookup
findSymbol(name: string, opts?: { kind?, file? }): Promise<Symbol[]>
getSymbol(id: SymbolId): Promise<Symbol | null>

// Reference and call analysis
findReferences(symbolId: SymbolId): Promise<Reference[]>
findCallers(symbolId: SymbolId, depth?: number): Promise<CallChain[]>
findCallees(symbolId: SymbolId, depth?: number): Promise<CallChain[]>

// File-level dependencies
findImports(file: string): Promise<Import[]>
findDependents(file: string): Promise<Dependent[]>

// Impact / hygiene
findUnreferenced(scope?: string): Promise<Symbol[]>
analyzeImpact(diff: FileDiff[]): Promise<ImpactReport>

// Governance-aware
findCallers(symbolId, { policy: AxTrustPolicy }): /* excludes files the
    current agent lacks read permission for, or files marked as
    do-not-analyze in the policy */
```

Every return type carries an `explain: { source, queryId, indexedAt, commitSha }` field so callers can audit where the answer came from. This satisfies **O3**.

**Not in Phase 1:**
- Natural-language queries (that's the router's job, not the data layer's)
- Write-path APIs (the graph is read-only to the agent in Phase 1)
- Cross-repo queries

#### 4.2.4 Integration points

| Consumer | How it uses the Code Intelligence layer |
|---|---|
| **Plan agent** | Calls `findDependents(changedFile)` to scope the plan. Calls `analyzeImpact(plannedDiff)` before presenting the plan to the user. |
| **Explore agent** | Replaces ad-hoc grep with `findSymbol`, `findCallers`, `findDependents`. Token usage drops because it reads fewer files. |
| **Refactor / Edit path** | Before applying an Edit tool call, asks `findReferences` on the symbol being modified. Surfaces affected call sites to the user. |
| **Permission audit (v2.0 policy engine)** | Policy predicates can call the API to check "is this symbol used outside the protected zone." Makes policy-as-code genuinely code-aware. |
| **Replay engine (v2.0)** | Replay records the code graph SHA at the time of each step. On replay, the graph can be rebuilt from the same commit to reproduce query answers deterministically. |
| **Audit export (v2.0)** | Queries made by the agent are logged in the audit trail with their explain payload. Compliance can reconstruct "what did the agent know when it made this decision." |

---

## 5. Honest cost analysis

This section exists because overpromising on a semantic cache project is the most common way these initiatives fail.

### 5.1 Engineering cost

| Phase | Scope | Engineering estimate |
|---|---|---|
| Phase 1 | Graph schema, builder (LSP + tree-sitter), SQLite persistence, read-only API, agent integration for plan/explore agents | 4–6 engineer-weeks |
| Phase 2 | Incremental update on git / file save, graph invalidation, impact analysis, replay integration, audit trail hookup | 4–6 engineer-weeks |
| Phase 3 | Multi-repo, distributed graph via AX Serving, policy-aware queries via AX Trust, performance tuning | 6–10 engineer-weeks |

**Total: 14–22 engineer-weeks** for a single full-time engineer, or 8–12 weeks with two people on it. These are rough estimates — the real number depends on how many languages we need to normalize AST differences across, which is the biggest unknown (see 5.3).

### 5.2 Runtime cost

**Storage:**
- Per-project graph size is dominated by edge count. A 100k-LOC TypeScript project typically produces:
  - ~20k–40k symbol nodes
  - ~100k–200k edges
  - ~20–60 MB on disk in SQLite with reasonable indexing

A 1M-LOC monorepo is 10×: ~500MB. That's a real cost but not a blocker — it's comparable to the size of `node_modules` for the same project.

**Memory:**
- SQLite with memory-mapped reads: graph is in OS page cache, not Node heap
- Typical resident memory increase: <100 MB for a 100k-LOC project
- Hard cap in Phase 1 config: `AX_CODE_CODE_GRAPH_MAX_BYTES` (default 500 MB, above which Phase 1 declines to index and the agent falls back to direct LSP queries)

**Initial indexing latency:**
- LSP-driven indexing is bounded by the slowest language server's symbol enumeration
- For a typical 50k-LOC project, expect 30s–2min for a full first index
- Runs in background, does not block the session
- Subsequent sessions reuse the persisted graph (O2)

**Query latency:**
- Target for read-only API: p95 < 50ms per query on a 100k-LOC project
- Achievable with proper SQL indexes on `(project_id, name)`, `(project_id, file)`, `(from_node)`, `(to_node)`
- Failure mode: complex reachability queries (e.g. 10-hop call chains) may exceed target — we will measure and either cap traversal depth or move those specific queries to an in-memory cache layer

### 5.3 Technical unknowns

| Unknown | Why it's hard | Mitigation |
|---|---|---|
| **Cross-language graph normalization.** Every LSP server reports symbols in slightly different shapes. TypeScript's `Symbol.name` is not Python's `Symbol.name` is not Rust's `Symbol.name`. | No spec for unification. Prior attempts (SourceGraph, Glean) took years. | Phase 1 normalizes to a lowest-common-denominator schema: `kind`, `name`, `file`, `range`. Language-specific extensions live in a `metadata: JSON` column. Don't try to unify everything — unify the 80% that matters for agent reasoning. |
| **Incremental invalidation correctness.** When a file changes, knowing *exactly* which edges are stale is non-trivial. Get it wrong and queries return phantom results. | LSP doesn't tell us which cross-file references invalidated. | Conservative invalidation: when file X changes, mark all edges whose `from.file = X OR to.file = X` as potentially stale and re-run the LSP queries for those symbols in the next pass. False positives (unnecessary rebuilds) are acceptable; false negatives (missed invalidations) are not. |
| **LSP server cooperation.** Some servers don't implement `workspace/symbol` well (or at all). Others return incomplete reference lists. | We can't fix language servers. | Graceful degradation: if a server doesn't support a query, fall back to tree-sitter or mark the file as "symbols-only, no cross-refs" in the graph. The API returns partial results with `explain.completeness: "partial"`. |
| **Git worktree / submodule handling.** If the repo has submodules or nested git roots, the graph boundaries get fuzzy. | Edge cases multiply. | Phase 1 ignores submodules. Phase 3 (multi-repo) addresses this properly. |
| **Refactor race conditions.** The agent can issue an Edit tool call while the background indexer is rebuilding the graph. The post-Edit graph state can briefly disagree with disk. | Concurrency. | Tool-driven writes take a write lock on the graph and force a synchronous incremental update for the touched files before the Edit is committed. Background indexing holds a read lock and yields to write locks. |

### 5.4 Risks that would kill v3 if ignored

1. **Feature creep.** The external proposal includes "code graph + AI query + session memory + distributed graph + policy engine + CI integration" — attempting all of that at once is a 12-month project that will ship nothing. This PRD scopes Phase 1 to a single machine, single repo, single agent loop integration. Everything else is explicitly deferred.

2. **Over-ambitious query semantics.** "Find breaking changes in this diff" is one line of API and several months of implementation. Phase 1 ships `analyzeImpact(diff)` as a **call graph reachability** query, not a type-level breaking-change detector. We name things honestly.

3. **Destabilizing v2.1's LSP.** The code intelligence layer must be strictly a *consumer* of the LSP client. The LSP client's code does not change for v3. If the graph builder needs a new LSP capability, it wraps the existing client, it doesn't modify it.

4. **Invisible to users.** A code intelligence layer with no visible improvement in agent behavior is a failed project even if the engineering is excellent. Phase 1 **must** demonstrate a measurable win in plan accuracy or refactor correctness, or it gets paused.

5. **Regret the schema.** The graph schema shipped in Phase 1 will be hard to change later because stored graphs will need migrations. We lock the schema only after Phase 1 has shipped to 2–3 real projects and we've seen where it bends.

---

## 6. Success metrics

v3 is a success if all of the following are true at the end of Phase 2:

| Metric | Target | Measurement |
|---|---|---|
| Code graph query p95 latency | < 50 ms on 100k-LOC projects | Synthetic benchmark in `test/code-intelligence/` |
| Full reindex latency | < 2 min on 100k-LOC | Synthetic benchmark |
| Incremental update latency after a single-file change | < 500 ms | Synthetic benchmark |
| Persisted graph size | < 10 MB per 10k-LOC | Measured on 3 real projects |
| Agent-initiated LSP calls (per session, large refactor task) | Reduced by ≥ 40% vs v2.1 baseline | Replay log comparison |
| Hallucinated function references in agent plans | Reduced by ≥ 50% vs v2.1 baseline | Manual evaluation on 20 refactor scenarios |
| Regressions in v2.1 LSP tests | Zero | Existing 46 LSP tests continue to pass |

v3 is a **failure** if any of the following is true:

- Phase 1 ships, but plan/explore agents don't use the API in practice (measurable: the API is called fewer than 10% of the time an agent needs the answer)
- Graph persistence introduces a startup latency regression >500ms on small projects
- A customer reports "the agent ignored my do-not-touch zone because the graph didn't know about it" — meaning policy integration is insufficient

---

## 7. Roadmap

### Phase 1 — Foundation ✅ **Shipped in v2.2.0**

**Deliverable:** A read-only code graph for a single repo, populated from LSP, persisted in SQLite, exposed via a stable API.

- ✅ Schema: `code_node`, `code_edge`, `code_file`, `code_index_cursor` tables via Drizzle migration
- ✅ Builder: LSP-driven initial indexing (tree-sitter fallback deferred — LSP alone covers the target use cases on TypeScript/JavaScript/Python/Rust/Go)
- ✅ API: `findSymbol`, `findSymbolByPrefix`, `getSymbol`, `symbolsInFile`, `findReferences`, `findCallers`, `findCallees`, `findImports`, `findDependents`
- ⏸ Agent integration: the `code_intelligence` tool is registered for all agents behind the `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` flag. Whether plan/explore agents actually choose to call it is a model-selection outcome, not a hard-wired dependency. Measuring adoption in practice is deferred until the feature is promoted out of experimental.
- ✅ Tests: 47 tests covering the query layer, the public API, the builder's testable helpers, and regression cases for the 3 production bugs found via live smoke-testing

### Phase 2 — Incrementality and governance ✅ **Shipped in v2.2.0**

**Deliverable:** The graph updates incrementally on tool-driven writes, integrates with the v2.0 replay and audit systems, and can be filtered by path scope.

- ✅ Incremental update triggers: file watcher on `FileWatcher.Event.Updated`. Edit/Write/ApplyPatch already publish this event via `notifyFileEdited`, so tool-driven writes flow into the watcher without a second API surface.
- ✅ Graph invalidation: `CodeGraphBuilder.indexFile` does atomic delete-then-insert per file inside a transaction
- ✅ Replay integration: new `code.graph.snapshot` event recorded at session start carries projectID, commit sha, node/edge counts, last-indexed timestamp
- ✅ Audit trail: piggybacks on the standard `tool.call`/`tool.result` events that the session recorder already emits for every tool invocation — no extra plumbing
- ✅ Policy filtering: `scope: "worktree"` parameter drops results outside `Instance.worktree`. Full AX Trust integration deferred to Phase 3 (the engine it would integrate with does not yet exist).
- ✅ **Exit gate:** `test/replay/code-intelligence-replay.test.ts` records a full session containing a code_intelligence tool call and asserts the event log, reconstruction, summary, and audit export all round-trip cleanly (34 assertions)

### Phase 3 — Scale and distribution (6–10 weeks)

**Deliverable:** Multi-repo graphs, optional AX Serving backend for shared indexing, CI integration.

- ⏸ Multi-repo: the graph schema already supports `project_id` boundaries — only the query-layer cross-project fan-out is missing. Blocked on a design decision: opt-in per query (pass `projectIDs: [a, b]`) vs ambient workspace config.
- ⏸ AX Serving backend: blocked, no AX Serving subsystem exists in the repo to integrate with.
- ⏸ CI integration: graph export as build artifact. Unblocked but not yet scoped.
- ⏸ Full AX Trust policy integration: blocked, no AX Trust policy engine exists in the repo. A minimum worktree-scope filter shipped in v2.2.0 as a placeholder.
- ✅ **Performance tuning: shipped in v2.2.0.** Profile-driven optimization landed two commits (`7bf29bc`, `95ce8b9`) delivering 6.7× faster indexing and eliminating a latent duplicate-row bug. DB operations are now 10% of total index time (was 22%); LSP round-trips are the remaining bound.
- Advanced queries (`analyzeImpact(diff)`, `findUnreferenced(scope)`): deferred
- **Exit gate:** at least one enterprise deployment using the shared graph backend — not yet applicable, Phase 3 is partially delivered.

### What is explicitly out of scope even in Phase 3

- Fine-grained AST-level queries (below the symbol level) — not needed for agent reasoning
- Query languages (Cypher, Datalog) exposed to users — this is an internal API
- Replacing embedding-based document search — they serve different purposes
- Real-time incremental indexing during live typing — batch indexing is sufficient for agent use cases

---

## 8. Alternatives considered

### 8.1 "Just use embeddings and RAG"

This is what most competitors do today. It works for document retrieval. It fails predictably for code reasoning because:

1. Embeddings don't know call graphs. "Find callers of X" returns functions whose text happens to contain "X", not functions that call it.
2. Embeddings go stale on rename. A renamed function silently poisons the index until the next full rebuild.
3. Embeddings can't express "not referenced anywhere." Absence is hard to detect in similarity space.
4. No explainability. You can't ask "why did the agent say these are the callers."

Embeddings are not wrong; they're wrong **for this specific use case**.

### 8.2 "Use SourceGraph / similar"

SourceGraph is an excellent product. It is also an external dependency that runs a separate JVM process, indexes on its own schedule, and is not deployable in air-gapped environments without significant setup. ax-code targets sovereign deployments, and the v2.0 PRD explicitly calls out no new external runtime dependencies for enterprise deployments. Inline.

### 8.3 "Fork an existing code intelligence tool"

The closest candidates are:
- **glean** (Facebook): Haskell, heavyweight, overkill for single-repo use
- **stack-graphs** (GitHub / tree-sitter team): promising, scoped, but not yet mature for production agent consumption and not a drop-in for LSP workflows
- **scip** (SourceGraph): a schema, not a runtime — we could use the schema

Phase 1 does **not** fork any of these. Phase 3 might adopt the SCIP schema for interop with external tools if that's a business need. The Phase 1 schema is designed to be portable to SCIP if that becomes valuable.

### 8.4 "Do nothing, let embeddings get better"

Plausible short-term. The argument is that better models + better embedding retrieval will close the gap. We reject this because:

1. The gap is categorical, not quantitative. Embeddings will never know call graphs no matter how good the model is.
2. Every month we wait, competitors with deterministic code intelligence pull further ahead on the enterprise differentiation the v2.0 PRD identified as critical.
3. v2.0's replay and audit pillars are weakened without a deterministic code layer — replay of "the agent decided to modify X" is only reproducible if the data backing that decision was also deterministic.

---

## 9. Open questions

Questions that need answers before Phase 1 starts. This list is intentionally short — if it's on the list, it blocks Phase 1 kickoff.

1. **Who owns the graph store on disk?** Is it per-project (in `.ax-code/graph.db`, next to session data) or global (in `~/.ax-code/graph/$project_hash.db`)? Per-project is cleaner for enterprise deployments that back up projects together. Global is cleaner for managing disk quotas.

2. **Does the graph survive `git checkout` across branches?** Initial position: yes. The graph stores commit SHAs on nodes and can serve "state at commit X" queries. Alternative: per-branch graphs. This has implications for storage cost.

3. **Is the code intelligence API exposed to plugins?** Current plugins (`@ax-code-ai/plugin`) have access to provider loaders, tool registration, auth hooks. Should they also get code intelligence queries? If yes, we need a stable public API surface earlier than Phase 2. If no, plugins must call through tools.

4. **What's the relationship to the workflow router (separate v3 PRD)?** The router will want code intelligence queries as inputs to its task classifier. Does the router consume the API directly, or does the router's task classifier become a new consumer that owns its own query planning layer on top?

5. **Fallback when the graph is stale or missing?** Current proposal: the API falls through to direct LSP queries and returns results with `explain.completeness: "lsp-only"`. Alternative: hard-fail and force indexing. The soft-fallback is less correct but more robust.

---

## 10. Appendix: why this PRD exists

An external collaborator proposed a v3 direction for the LSP subsystem framed as "Palantir for codebase." The proposal contained several genuinely good ideas (code graph, query API, session memory, persistence) and several risky ones (graph databases, distributed-first design, policy engine embedded in the data layer).

Rather than adopt or reject the proposal wholesale, this PRD:

1. **Keeps the ideas that align with what v2.0 already committed to** (persistent semantic cache, deterministic queries, governance hooks)
2. **Rejects the infrastructure ambition for Phase 1** (no Neo4j, no distributed graph on day one, no multi-repo on day one)
3. **Grounds the design in existing ax-code infrastructure** (Drizzle, SQLite, the v2.1 LSP client, tree-sitter, the v2.0 replay and audit engines, the v2.0 policy engine)
4. **Sets honest success and failure criteria** so we can measure whether the investment paid off
5. **Locks phase scoping** so Phase 1 can ship in 4–6 weeks with measurable value, not 6 months of foundation work before any user sees a benefit

If Phase 1 ships and fails its exit gate (plan/explore agents don't actually use the API in practice), this PRD explicitly calls for pausing v3 rather than extending Phase 2. A code intelligence layer that nobody uses is worse than no layer at all.

---

**Next steps now that Phase 1+2 have shipped:**

1. **Design review for multi-repo** (the one gating decision for resuming Phase 3). Opt-in `projectIDs: ProjectID[]` on the query API vs ambient workspace config — this shapes the whole implementation, so engineering should not pick unilaterally.
2. **Adoption telemetry.** The `code_intelligence` tool is registered for all agents behind the experimental flag, but we don't yet measure how often models choose to call it vs falling back to grep/read. Add a counter to the telemetry subsystem before promoting the flag to default-on.
3. **Promote `AX_CODE_EXPERIMENTAL_CODE_INTELLIGENCE` to default-on** once adoption telemetry and the success-metric targets have been hit on 2–3 real projects outside this monorepo.
4. **AX Serving / AX Trust integration.** Blocked until those subsystems exist. Not on the roadmap yet.
