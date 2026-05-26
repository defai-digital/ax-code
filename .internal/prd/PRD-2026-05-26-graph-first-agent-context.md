# PRD: Graph-First Agent Context

**Date:** 2026-05-26
**Status:** Implemented - graph-first context composer shipped
**Scope:** Internal
**Owner:** ax-code maintainers
**Related:** ADR-019 (Graph-first agent context boundary), ADR-006 (Agent Control Plane), ADR-016 (agent routing), ADR-017 (Effect freeze), `docs/semantic-layer.md`
**Archive criteria:** AX Code has a tested graph-first context tool, agent guidance, and benchmark harness; route/heuristic pilots ship with provenance, and persisted graph-edge expansion is deferred to successor work only if the pilot proves valuable.

---

## Purpose

Reduce token use, file reads, and exploratory tool calls by making AX Code's existing Code Intelligence graph usable as a first-class agent navigation layer.

The goal is not to copy CodeGraph or replace AX Code's semantic runtime. The goal is to learn the best product pattern from graph-first tools: give agents a compact, provenance-rich context pack before they scatter across grep and file reads.

## Problem

AX Code already has:

- a persistent SQLite code graph;
- graph-backed symbol, reference, caller, callee, and impact operations;
- indexing, watcher, provenance envelope, and worktree scoping;
- live LSP as a separate semantic surface.

The current gap is productization:

- The `code_intelligence` tool exposes primitives, not a task-level context pack.
- Agents still need to chain many operations manually.
- Tool guidance says to prefer graph queries, but does not provide a high-level "answer this structural task from graph first" operation.
- There is no first-party benchmark showing graph-first token/tool/time savings.
- Framework route information and heuristic dynamic edges are not first-class graph concepts.

## CodeGraph Review

### Pros Worth Learning

1. Task-oriented context composition.
   CodeGraph's strongest surface is the ability to build relevant context in one operation instead of making the agent orchestrate search, node lookup, caller/callee expansion, and source gathering.

2. Graph-first agent instructions.
   The installer writes guidance into agent surfaces so structural questions start from graph queries, not grep/read exploration.

3. Framework routes.
   Route nodes make API entry points visible to agents. This matters for auth, validation, request lifecycle, security review, and bug triage.

4. Dynamic boundary bridging.
   Heuristic edges across callbacks, event emitters, UI render paths, and framework descriptors can prevent graph traversal from stopping at common dynamic boundaries.

5. Benchmark narrative.
   A graph-first system should prove reduced tool calls, tokens, cost, and wall time on fixed repo tasks.

### Cons / Risks to Avoid

1. Over-claiming freshness.
   An index is not live editor state. AX Code should keep graph freshness explicit and recommend LSP cross-checks for refactors or recently edited files.

2. Hiding heuristic uncertainty.
   Framework and dynamic edges are useful only if provenance is visible. A heuristic edge must not look like a precise LSP call edge.

3. Primitive explosion.
   Adding many small graph tools increases agent choice burden. Prefer one high-level context composer backed by existing primitives.

4. Duplicate graph runtime.
   Vendoring or depending on external CodeGraph would duplicate indexing, storage, permissions, and freshness rules.

5. Framework support surface creep.
   Supporting every framework at once creates a large maintenance burden. Start with AX Code's highest-value ecosystems.

## Best Practices

1. Keep semantic sources explicit.
   Graph, LSP, cache, and file-read sources must remain distinguishable in metadata.

2. Compose first, enrich later.
   Build `code_context` on current graph primitives before adding route nodes or heuristic edges.

3. Return bounded context packs.
   Every response should include selected symbols, relationship map, snippets, omissions, truncation, and next recommended checks.

4. Use provenance as a schema feature.
   Add edge/source provenance before adding framework or heuristic edges.

5. Make graph-first behavior measurable.
   Track token estimate, tool call count, elapsed time, graph query count, file-read count, and answer-quality rubric.

6. Preserve worktree and permission boundaries.
   Context composition must use the same `worktree` scope and symlink checks as existing tools.

7. Avoid Effect expansion.
   New context and graph modules should use async/await, Zod, and existing Result/error-boundary patterns per ADR-017.

8. Prefer low-risk product slices.
   The first implementation should not rewrite indexing. It should consume existing `CodeIntelligence` APIs.

## Goals

1. Add a graph-first context composer for structural code questions.
2. Reduce repeated grep/read exploration for "how does X work", "where is X used", "what calls X", and "what changes if we edit X".
3. Preserve graph freshness and provenance metadata.
4. Add benchmark coverage for graph-first vs grep/read-first workflows.
5. Prepare the schema for route and heuristic edge provenance.

## Non-Goals

- Replace the `lsp` tool.
- Replace `code_intelligence` primitive operations.
- Vendor external CodeGraph.
- Expose Code Intelligence as MCP in this PRD.
- Support every framework route extractor in the first implementation slice.
- Add hidden graph-first routing with automatic LSP fallback.
- Rewrite indexing in Rust or replace the current LSP-backed builder.

## Users

### Coding agent

As an agent, I can ask for a compact context pack about a symbol or task before reading files.

### Maintainer

As a maintainer, I can measure whether graph-first context reduces tool calls, tokens, and wall time without reducing answer quality.

### Power user

As a user, I can see when the agent is using indexed graph data and when it needs fresh LSP or file reads.

## Requirements

### R1: Graph-First Context Tool

Add a task-oriented context operation, name to be finalized as either:

- `code_context`; or
- `code_intelligence` operation `buildContext`.

Inputs:

- `query`: natural-language task or symbol/topic string;
- optional `seeds`: symbol IDs, file paths, or names;
- optional `maxSymbols`, `maxSnippets`, `maxDepth`, `includeImpact`;
- optional `freshness`: `preferGraph`, `requireFresh`, or `allowStaleWithWarning`.

Output:

- compact Markdown/text context;
- structured metadata with selected symbols, references, callers, callees, snippets, relationship edges, omitted candidates, truncation, freshness, and provenance;
- recommended next checks, such as "read these two files" or "cross-check with LSP references".

### R2: Source Selection

The composer should:

- search exact and prefix matches;
- rank symbols by kind, name match, worktree scope, visibility, and relationship density;
- expand direct callers/callees first;
- include impact summary only when requested or when a seed is high-risk;
- select short source snippets around symbols rather than full files;
- cap output size aggressively.

### R3: Freshness and Trust Metadata

Every context pack must include:

- graph cursor timestamp;
- degraded flag when cursor is missing;
- per-symbol file completeness when available;
- source type for every relationship;
- warning when the graph may be stale.

### R4: Agent Guidance

Update tool descriptions or system guidance so agents:

- use graph-first context for architecture, caller/callee, impact, and "where is X" tasks;
- avoid using graph results as the only evidence for recently edited files;
- cross-check with live LSP for rename/refactor/reference-sensitive edits;
- read files after graph narrowing, not before.

### R5: Benchmark Harness

Add a reproducible harness that compares graph-first and grep/read-first behavior.

Minimum metrics:

- tool calls;
- file reads;
- graph queries;
- token estimate;
- elapsed milliseconds;
- answer quality rubric;
- failure/unknown rate.

The first harness can be deterministic and local, using scripted task traces rather than live model calls.

### R6: Edge Provenance Foundation

Before adding framework routes or heuristic dynamic edges, add explicit relationship provenance.

Candidate fields:

- edge source: `lsp`, `static`, `framework`, `heuristic`, `manual`;
- confidence: `high`, `medium`, `low`;
- metadata with extractor name and explanation.

### R7: Framework Route Pilot

After provenance exists, add a small route-node pilot for the highest-value server frameworks in AX Code's target user base.

Recommended first set:

- Express-style JS/TS routes;
- FastAPI;
- Flask;
- Next.js app/pages routes if practical.

Route nodes should link route patterns to handler functions/classes using `references` or a dedicated route edge kind with provenance.

### R8: Heuristic Dynamic Edge Pilot

After provenance exists, add only narrowly scoped heuristic edges.

Recommended first set:

- Node `EventEmitter.on/emit` pairs when event names are static strings;
- callback registration when the callee and callback symbol are both statically visible;
- React JSX parent-child or render edges only if extraction is low-risk.

Heuristic edges must be optically distinct in output.

## Implementation Plan

### Phase 0: Contract Alignment

Deliverables:

- Finalize ADR-019 status after maintainer review.
- Choose `code_context` vs `code_intelligence.buildContext`.
- Define output metadata schema.
- Decide initial token/output budget.

Acceptance:

- ADR and PRD are accepted or revised.
- Tool contract has a small schema draft and test fixture.

### Phase 1: Context Composer MVP

Deliverables:

- Add pure composer module under `src/code-intelligence/` or `src/context/graph-context/`.
- Reuse existing `CodeIntelligence.findSymbol`, `findSymbolByPrefix`, `findReferences`, `findCallers`, `findCallees`, and `graphEnvelope`.
- Add agent-facing tool wrapper.
- Return bounded text plus structured metadata.

Acceptance:

- Unit tests cover exact symbol, prefix symbol, ambiguous symbol, empty graph, stale/degraded graph, and truncation.
- No indexing behavior changes.
- No new Effect usage.

### Phase 2: Agent Guidance and Guardrails

Deliverables:

- Update tool description and relevant agent prompt guidance.
- Add tests that check guidance text for graph-first structural workflows.
- Add metadata warning when graph context should be cross-checked.

Acceptance:

- Structural query guidance points agents to context composer before grep/read.
- Refactor-sensitive guidance still recommends live LSP or file reads when needed.

### Phase 3: Benchmark Harness

Deliverables:

- Add deterministic benchmark script or test fixture.
- Compare graph-first context traces against grep/read-first baseline traces.
- Report metrics in JSON.

Acceptance:

- Harness runs locally without API keys.
- Metrics include token estimate, tool calls, file reads, graph queries, elapsed time, and success rubric.

### Phase 4: Edge Provenance Schema

Deliverables:

- Add edge provenance fields or metadata convention.
- Migrate existing edges to source `lsp` or equivalent.
- Update query APIs and output formatting to include provenance.

Acceptance:

- Existing graph tests pass with provenance.
- Context output distinguishes precise and heuristic-capable relationships.

### Phase 5: Framework Route Pilot

Deliverables:

- Implement one or two route extractors with tests.
- Add route nodes/edges with provenance.
- Surface route bindings in context packs.

Acceptance:

- Express-style and/or FastAPI fixtures produce route nodes linked to handlers.
- Context pack for a handler includes the URL pattern when available.

### Phase 6: Heuristic Dynamic Edge Pilot

Deliverables:

- Implement one narrow heuristic extractor.
- Store heuristic edges with source and confidence.
- Render heuristic warnings in context output.

Acceptance:

- Heuristic fixture is useful and visibly non-authoritative.
- No heuristic edge is mixed with precise call edges without provenance.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Agents over-trust stale graph data | Keep freshness visible and recommend LSP cross-checks for refactors |
| Context packs become too large | Hard caps, truncation metadata, and snippet selection tests |
| Heuristic edges create false confidence | Add provenance before heuristic ingestion |
| Framework route support expands too fast | Pilot only high-value frameworks and split follow-up PRDs |
| Benchmark becomes synthetic theater | Use fixed real-repo tasks and include answer-quality rubric |
| Tool naming churn | Decide in Phase 0 and keep primitive `code_intelligence` stable |

## Open Questions

1. Should the MVP be a new `code_context` tool or a `buildContext` operation on `code_intelligence`?
2. What default output budget should the context pack target?
3. Should snippets be read from disk at composition time, or should MVP return ranges only and let the agent read selected files?
4. Should graph-first benchmark live under `packages/ax-code/script/` or `packages/ax-code/test/benchmark/`?
5. Which framework route extractor should be first: Express, FastAPI, Flask, or Next.js?

## Done When

- Done: `code_intelligence.operation = "buildContext"` exists and is covered by focused tests.
- Done: Tool guidance now tells agents to use graph-first context before broad grep/read exploration for structural questions.
- Done: Freshness, provenance, truncation, omissions, framework route hints, heuristic callback/event hints, snippets, and recommendations are visible in every context pack.
- Done: `packages/ax-code/script/graph-context-benchmark.ts` reports graph-first vs grep/read-first metrics without API keys.
- Done: Route and heuristic pilots ship as context-pack enrichments with provenance. Persisting them as graph edges is intentionally deferred to a successor PRD after usage evidence.
