# ADR-019: Make Graph-First Agent Context a Product Boundary

## Status

Accepted; implementation shipped

## Date

2026-05-26

## Deciders

To be filled by team

## Related

- ADR-006: Make Agent Control Plane the v5 autonomous architecture foundation
- ADR-016: Agent routing is keyword-only
- ADR-017: Freeze Effect framework usage at v2.11.0 boundaries
- `.internal/prd/PRD-2026-05-26-graph-first-agent-context.md`
- `docs/semantic-layer.md`
- `packages/ax-code/src/code-intelligence/`
- `packages/ax-code/src/tool/code-intelligence.ts`
- `packages/ax-code/src/tool/impact_analyze.ts`

## Context

AX Code already has the core substrate normally associated with local code-graph products:

- indexed SQLite tables for code nodes, code edges, code files, cursors, and LSP cache;
- graph-backed symbol, reference, caller, callee, and impact queries;
- a code-intelligence tool with provenance envelopes;
- an indexing path that uses LSP semantics and keeps the graph updated through watcher integration;
- an explicit semantic contract that keeps live LSP and indexed graph surfaces separate.

External projects such as CodeGraph show a different product lesson: the winning surface is not only the graph database. It is the agent-facing workflow around the graph. Their strongest ideas are:

- task-oriented context packing instead of primitive-only graph queries;
- explicit agent instructions that make graph queries the first stop for structural questions;
- route and framework nodes that connect HTTP/API entry points to handlers;
- heuristic dynamic edges with provenance, so agents can traverse callbacks, event channels, UI render edges, and framework descriptors without pretending those edges are precise;
- benchmark narratives that compare graph-first behavior against grep/read-first behavior.

AX Code should learn from these product surfaces without replacing its current semantic architecture.

## Decision

Build a first-class graph-first agent context boundary on top of the existing Code Intelligence runtime.

The boundary will provide a task-oriented context composition layer, not a replacement for `code_intelligence`, `lsp`, `grep`, or file reads.

The first public product surface should be a new agent-facing operation such as `code_context` or `code_intelligence.operation = "buildContext"`. It should:

- accept a task or query string plus optional seeds;
- perform bounded symbol search, caller/callee expansion, reference lookup, and optional impact lookup;
- return a compact Markdown/text context pack plus structured metadata;
- include source provenance, freshness, truncation, and confidence signals;
- recommend when the agent should cross-check with live LSP or read files;
- stay inside the current worktree and existing permission model.

The graph remains an explicit semantic source. AX Code will not silently route all semantic questions through graph-first behavior, and it will not auto-fallback from graph to live LSP without exposing that decision in metadata.

## Policy

### Preserve Explicit Semantic Sources

- `lsp` remains the live semantic source.
- `code_intelligence` remains the primitive indexed graph query source.
- `code_context` becomes a higher-level graph-first context composer.
- Consumers must be able to see whether output came from graph, LSP, file reads, or a mixed source.

### Prefer Composition Over New Primitive Sprawl

The next product gap is not another dozen small graph primitives. The high-value gap is composition:

- find likely symbols;
- expand direct callers and callees;
- attach references or impact data when useful;
- select a small set of source snippets;
- summarize the relationship map;
- expose what was omitted.

New low-level graph operations should be added only when the context composer or a concrete workflow needs them.

### Add Provenance Before Heuristics

Framework routes and dynamic-dispatch edges are valuable, but they must not be stored as indistinguishable `calls` edges.

Before adding heuristic edges, the graph schema or edge metadata must support provenance such as:

- `lsp`
- `static`
- `framework`
- `heuristic`
- `manual`

Any heuristic edge must be visible to the agent and user as heuristic.

### Do Not Vendor CodeGraph

Do not introduce CodeGraph as a runtime dependency or external MCP requirement.

AX Code already owns its local graph, storage, permission boundary, LSP behavior, audit, replay, and TUI/server integration. Adding a second graph runtime would create duplicate indexes, duplicate freshness rules, duplicate permissions, and confusing agent guidance.

## Consequences

### Positive

- Turns the existing graph substrate into direct token and tool-call reduction.
- Improves structural questions without weakening the live LSP path.
- Keeps freshness, replay, audit, and permission semantics under AX Code control.
- Gives future Agent Control Plane phases a deterministic planning substrate.
- Creates an internal benchmark surface for graph-first vs grep/read-first behavior.

### Negative / Costs

- Adds a new supported tool contract that must be tested and documented.
- Context composition can hide important omissions if truncation and provenance are weak.
- Prompt/tool guidance must be tuned so agents do not over-trust stale graph data.
- Framework route detection and heuristic edges can become a maintenance sink if added too broadly.
- Measuring token savings requires reproducible eval tasks, not only unit tests.

## Alternatives Considered

### Keep Only Primitive `code_intelligence`

Rejected. Primitive queries are useful, but they still force agents to orchestrate many calls manually. The CodeGraph lesson is that the agent should receive a curated context pack for common "how does X work" and "what is affected by Y" tasks.

### Replace AX Code Intelligence with External CodeGraph

Rejected. It would duplicate storage, indexing, trust, permission, and freshness semantics. AX Code has product-specific integration requirements around replay, audit, TUI, server, SDK, and worktree boundaries.

### Add Hidden Graph-First Routing Everywhere

Rejected. `docs/semantic-layer.md` explicitly keeps `lsp` and `graph` separate. Hidden routing would make freshness and correctness harder to reason about.

### Build Framework Routes and Heuristic Edges First

Rejected for the first slice. These are useful, but context composition unlocks immediate value from the graph that already exists. Route and heuristic work should follow after edge provenance is in place.

## Implementation Tracking

Implementation is tracked in `.internal/prd/PRD-2026-05-26-graph-first-agent-context.md`.

High-level phases:

1. Add graph-first context composer as a narrow tool surface.
2. Add graph-first agent guidance and tests that discourage grep/read-first behavior for structural questions.
3. Add graph-first benchmark harness.
4. Add edge provenance metadata.
5. Add framework route nodes for the highest-value stacks.
6. Add carefully scoped heuristic dynamic edges.

Current implementation:

- `code_intelligence.operation = "buildContext"` is the graph-first context composer.
- `packages/ax-code/src/code-intelligence/graph-context.ts` owns composition, snippet selection, route hints, heuristic hints, relationship provenance, freshness metadata, omissions, and recommendations.
- `packages/ax-code/script/graph-context-benchmark.ts` provides the deterministic local benchmark harness.
- Framework routes and dynamic callback/event signals are currently context-pack enrichments with provenance, not persisted graph edges. Persisted route nodes and long-lived heuristic edges require a separate schema-backed follow-up if the pilot proves valuable.

## Non-Decisions

This ADR does not choose the final tool name.

This ADR does not make graph results authoritative over live LSP results.

This ADR does not require exposing Code Intelligence through MCP.

This ADR does not require a new Rust semantic runtime.

This ADR does not decide every supported framework for route extraction.

## Acceptance Criteria

- A task-oriented graph-first context tool exists and is covered by focused tests.
- Tool output includes provenance, freshness, truncation, and source selection metadata.
- Agent guidance tells agents when to use graph-first context and when to cross-check with LSP or file reads.
- A benchmark can compare graph-first and grep/read-first behavior on fixed tasks.
- Framework and heuristic edges are not added without explicit provenance.
