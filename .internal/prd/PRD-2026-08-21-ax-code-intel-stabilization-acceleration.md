# PRD: AX Code Intel Stabilization & Targeted Acceleration

| Field    | Value                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| Status   | Complete — all phases resolved 2026-08-22 (Phase 3 no-op and Phase 4 not triggered per E3 gate; reopen conditions in §4) |
| Owner    | AX Code CLI maintainers                                                                |
| Created  | 2026-08-21                                                                             |
| Related  | `@ax-code/ax-code-intel` extraction (a57bb6f75, 545dabb7a); 2026-08-21 council reviews |
| Location | `.internal/prd/PRD-2026-08-21-ax-code-intel-stabilization-acceleration.md`                  |

---

## 1. Problem statement

`@ax-code/ax-code-intel` (the extracted LSP orchestration layer, ~5k LOC) gives
AX Code compiler-grade code intelligence across languages: local language
servers spawned on demand over stdio JSON-RPC, diagnostics, navigation,
references, symbols, call hierarchy, a graph-backed result cache, and prewarm.
The hybrid architecture (tree-sitter graph + LSP semantics + persistent SQLite)
matches current industry best practice for coding agents.

Two multi-model design reviews (2026-08-21) converged on the same verdict:

1. **The foundation is correct and should not be replaced.** For the three
   dominant user languages (JS/TS, Python, Rust) the configured LSP servers —
   tsserver via typescript-language-server, Pyright, rust-analyzer — already
   are the best-in-class analyzers. Embedding compiler frontends in-process
   would create a second client to the same engines while losing process
   isolation and multiplying maintenance. That proposal is rejected.
2. **The layer is not yet done.** Known correctness defects, unmeasured
   performance, and weak package-level contracts block both reliability and
   any future reuse. Expansion before stabilization has negative ROI.

Concrete findings at the start of the milestone (council findings, anchors
approximate):

- **D1 — Cache identity is content-only.** Cache keys hash only the queried
  file (`packages/ax-code-intel/src/cache-probe.ts`,
  `packages/ax-code/src/code-intelligence/lsp-cache.ts`). Edits to _other_
  workspace files, server version changes, or LSP config changes can return
  stale references/definitions. Files are also hashed even when the store
  reports caching disabled.
- **D2 — Sync capability is ignored.** The client does not parse the server's
  `textDocumentSync` capability (Incremental vs Full vs None), and advertises
  dynamic registration support without implementing registrations
  (`packages/ax-code-intel/src/client.ts`).
- **D3 — Untyped semantic results.** hover/definitions/implementations/
  references/call hierarchy surface `unknown[]`; workspace-symbol logic
  assumes every result has a resolved Location range.
- **D4 — Performance is unmeasured.** No baseline exists for cold-start
  latency, warm query latency, peak RSS per server, or cache hit rate.
- **D5 — Package independence is partial.** LSP tests live in core, the root
  export exposes only LSP, and a wildcard export exposes internal modules.

### Implementation status

| Finding | v7.7.7 status                                   | Notes                                                                                                                                                                                                      |
| ------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1      | Closed                                          | Cache keys include workspace generation plus server/config identity, and disabled stores skip hashing. Nuance: the workspace generation is folded in only for workspace-dependent operations (`references`); `documentSymbol` deliberately omits it (`cache-context.ts:74-89`).                                     |
| D2      | Closed                                          | Full, Incremental, None, open/close, and save negotiation are honored; dynamic registration is not advertised.                                                                                                                                                             |
| D3      | Core correctness closed; API enrichment remains | Public semantic methods validate typed protocol results, resolve range-less workspace symbols, and reject malformed payloads. Per-item provenance and canonical path metadata remain Phase 2 enhancements. |
| D4      | Closed                                          | `packages/ax-code-intel/perf/` (2026-08-22): six scenarios over synthetic fixtures plus external real-world repos pinned by SHA (`colinhacks/zod` e516c3b, `pydantic/pydantic` 2151025, `BurntSushi/ripgrep` 3fce3b5) with pinned query points and per-file hash verification. Reference baseline recorded 2026-08-22 against the external fixtures (`perf/baseline/baseline.reference.json`); synthetic fixtures remain the fast smoke path. G4 measured-performance deliverable met: cold-start, warm query, peak RSS, cache hit rate, diagnostic latency, and graph-builder wall/RPC baselined for all three languages. |
| D5      | Closed                                          | Explicit export maps replace the wildcards (intel 32 subpaths, reason 21); no `internal/*` subpath is exported from either package. Two core unit tests moved into the intel package; READMEs document API tiers and lifecycle. The former internal seams are closed: both packages expose a minimal public `./log` facade (`setLogSink`/`createLogger`) used by the core glue, and the verification-runner test was re-pointed at the public surface. |

---

## 2. Goals

### Product goals

- **G1 — Correct intelligence:** Cached semantic answers never go stale across
  cross-file edits, server upgrades, or config changes (D1 closed with
  regression tests).
- **G2 — Conforming protocol behavior:** Document sync matches each server's
  declared capability; no advertised capability is left unimplemented (D2).
- **G3 — Trustworthy API surface:** Semantic results are normalized, validated,
  and typed; consumers never receive unvalidated `unknown[]` (D3).
- **G4 — Measured performance:** Cold start, warm queries, memory, and cache
  effectiveness are baselined on representative JS/TS, Python, and Rust
  repositories before any optimization or expansion decision (D4).
- **G5 — Reuse-ready package:** The package owns its unit and host-contract
  tests, exports explicit supported subpaths, and documents its lifecycle
  guarantees (D5).
- **G6 — Gated acceleration:** Any accelerator (server swap, batch indexer)
  ships only behind measurement evidence and a feature flag, with rollback.

### Engineering goals

- **E1 — LSP stays the single semantic authority.** No second semantic query
  path; fast linters remain auxiliary `semantic:false` servers.
- **E2 — Process isolation preserved.** No compiler frontend linked into the
  Node/N-API process; servers remain child processes with kill-tree cleanup.
- **E3 — Evidence-gated scope.** Phase 4 items start only when Phase 0
  measurements show a material bottleneck the earlier phases cannot fix.
- **E4 — Contract stability.** SSE/OpenAPI event shapes and core glue behavior
  remain unchanged throughout.

---

## 3. Non-goals

- **Embedding per-language compiler frontends** (TS compiler API, ty/red-knot
  library, rust-analyzer crates) in-process. Rejected by design review:
  duplicate engines, lost crash isolation, unstable native APIs, version
  coupling with user workspaces.
- Bundling a TypeScript compiler that can disagree with the workspace tsdk.
- Native multi-root `workspaceFolders` negotiation (single-root-per-client
  spawning stays unless telemetry proves duplicate-process cost material).
- A diagnostics streaming/subscription API (current event stays an
  invalidation signal) unless a concrete diagnostic-driven workflow requires it.
- New LSP protocol methods without a demonstrated agent need (rename is
  deliberately deferred; verification already shells out to tsc/pyright/cargo).
- Generic transport abstraction (remote/embedded LSP) until a real consumer
  exists.
- Replacing tree-sitter or the SQLite graph; they remain the syntactic and
  persistence layers.

---

## 4. Phases

### Phase 0 — Measurement baseline (gate for everything after) — **DONE 2026-08-22**

Build a small benchmark harness (script + fixtures, no product code changes):

1. Representative repositories: one JS/TS monorepo, one Python project, one
   Rust workspace (pinned commits).
2. Metrics: server cold-start p50/p95, warm query latency (definition/
   references/hover) p50/p95, peak RSS per server, cache hit rate, diagnostic
   latency after edit, graph builder wall-time and LSP RPC count.
3. Record baseline to `packages/ax-code-intel/perf/` (or docs/planning) as the
   reference for Phase 3 exit criteria and Phase 4 go/no-go.

Outcome: harness landed (`perf/`, 33 harness tests, manual-only — not in CI);
reference baseline recorded against SHA-pinned real repos (zod, pydantic,
ripgrep) at `perf/baseline/baseline.reference.json`; deterministic synthetic
fixtures remain the smoke path.

### Phase 1 — P0 correctness (D1, D2)

1. **Cache identity:** include a host-supplied workspace/index generation plus
   server + config fingerprint in the cache namespace. Check `enabled()`
   before hashing. Invalidate (or mark stale-hint) on relevant workspace
   changes.
2. **Sync conformance:** parse `TextDocumentSyncKind`/`TextDocumentSyncOptions`
   from initialize results; send ranged changes only for Incremental servers;
   respect None/Full/openClose/save; stop advertising dynamic registration or
   implement it through a host file-change stream.
3. Regression tests: cross-file edit staleness, server/config change
   invalidation, fake-server sync conformance (Incremental, Full, None).

Exit: existing 190/190 LSP tests plus new staleness/conformance suites green.

### Phase 2 — Typed API and package contracts (D3, D5)

1. Normalize and validate semantic results: Location/LocationLink, Hover,
   references, CallHierarchyItem/CallHierarchyCall, resolved/unresolved
   WorkspaceSymbol (support `workspaceSymbol/resolve`). Preserve raw
   server-specific data as an escape hatch; attach per-item server provenance;
   canonicalize paths; expose limits/timeouts/signals.
2. Move package-level unit and host-contract tests into `ax-code-intel`;
   retain core integration tests in core. Provide a reusable fake host/server
   harness.
3. Replace the wildcard export with explicit supported subpaths; document
   lifecycle and compatibility guarantees in the package README.

Exit: recursive typecheck clean; package tests runnable standalone
(`pnpm --dir packages/ax-code-intel test`).

### Phase 3 — Performance tuning (D4, driven by Phase 0)

Candidates, chosen only where Phase 0 shows pain:

- Prewarm policy tuning (which servers start together, when).
- Process reuse and idle-shutdown thresholds.
- Request batching for graph builder LSP queries.
- Better cache invalidation granularity (from Phase 1).

Exit criteria (set after baseline): agreed deltas on cold-start p95, warm
query p95, peak RSS, and cache hit correctness — no regression in answer
accuracy.

**Outcome (2026-08-22 E3 gate review, MiniMax-M3 + DeepSeek-v4-pro via
`ax-code run`, verdicts in `.tmp/council-*-phase34.md`): NO-OP.** Evaluated
against the recorded external baseline: every candidate lacks a measured
bottleneck — warm queries 0–14 ms p50 (p95 peaks at 44 ms on the ts-zod
references scenario; all other scenarios ≤ 15 ms), cache hit rate 0.99
saturated on all three
languages (further fingerprint tightening risks the hit-rate collapse the
risk table warns about), graph-builder RPC volume is 2/file with no N+1
signal, and the rust diagnostic p95 bimodality is a known cold-edit fixture
artifact. rust-analyzer peak RSS (~1 GB on ripgrep) is a real signal but
outside every Phase 3 candidate's remit; it becomes an idle-shutdown question
only if real-workspace measurements show unbounded idle growth.

### Phase 4 — Conditional narrow accelerators (E3-gated) — **NOT TRIGGERED 2026-08-22**

Start only if Phases 0–3 leave a measured, material bottleneck:

1. **Server swap behind LSP:** evaluate `ty` vs Pyright behind the existing
   experimental flag with a correctness bake-off (diagnostics precision/
   recall, navigation accuracy, latency). Ship only if it wins clearly;
   protocol and tooling surface stay unchanged.
2. **Batch indexer for graph completeness:** if graph builder latency/RPC
   volume dominates, add a batch pass (SCIP or a project-wide dump from the
   same LSP servers) that writes into the existing SQLite graph. Live queries
   stay on LSP; no third query API.
3. Fast linters (oxlint/biome/ruff-class) stay auxiliary `semantic:false`
   servers; findings are source-tagged and deduplicated.

**Outcome:** the E3 trigger condition ("a measured, material bottleneck the
earlier phases cannot fix") is not met by the 2026-08-22 baseline — Pyright
cold-start p95 ≈ 93 ms and warm queries ≈ 13 ms give the ty bake-off nothing
to win against; graph-builder volume does not dominate anything. Both
reviewers independently reached "not triggered". Reopen conditions (either
suffices): a future recorded baseline shows cold-start p95 > ~800 ms, real
cache hit rate < 0.7 under heterogeneous editing, graph-builder wall > 30 s
or RPC > 100k on a real monorepo, or rust-analyzer idle RSS growing without
bound. The harness stays manual-only; re-record the reference baseline
periodically (suggested cadence: ~90 days, or on any LSP server major
upgrade) to keep the gate honest.

---

## 5. Success metrics

| Metric                                | Target                                             |
| ------------------------------------- | -------------------------------------------------- |
| Stale-cache regression tests          | 0 failures across cross-file/config/server changes |
| Fake-server sync conformance suite    | All sync kinds pass                                |
| Semantic API `unknown[]` leakage      | 0 at package public boundary                       |
| Package tests                         | Runnable standalone, green in CI                   |
| Cold-start p95 / warm query p95 / RSS | Baseline recorded; Phase 3 deltas vs baseline      |
| LSP regression suite                  | Grown equivalent green: 26 core `test/lsp/` files (179 tests) + 75 standalone intel package tests + 147 reason package tests (verified by direct run 2026-08-22; supersedes the original 190/190 figure and the interim 582 aggregate) |

---

## 6. Risks and mitigations

| Risk                                                          | Mitigation                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Cache fingerprint too aggressive → hit rate collapse          | Measure hit rate before/after in Phase 0/3; fingerprint only inputs proven to cause staleness |
| Sync negotiation breaks quirky servers                        | Keep bounded full-sync fallback; conformance tests per server class                           |
| Typed normalization hides server-specific data consumers need | Raw escape hatch + provenance tag on every item                                               |
| Phase 4 ty bake-off inconclusive                              | Default stays Pyright; flag-gated, documented rollback                                        |
| Benchmark fixtures drift                                      | Pin repo commits; record versions alongside results                                           |

---

## 7. Open questions

1. Should the workspace/index generation fingerprint come from the existing
   watcher epoch, or a dedicated monotonic counter in the host port?
2. Is a CI performance gate warranted after Phase 0, or is local benchmarking
   sufficient for a team of this size?
3. Does any planned product surface (beyond current tools) need rename or
   code actions soon enough to justify pulling those into scope?

---

## 8. Decision record

- 2026-08-21 design review (codex-cli/gpt-5.6-sol): bounded stabilization
  milestone only; reject embedded semantic stacks; gate accelerators on
  telemetry.
- 2026-08-21 design review (codex-cli/gpt-5.6-sol + grok-4.6): embedding
  per-language analyzers for JS/TS, Python, Rust rejected — LSP servers already
  are the best-in-class analyzers; swap servers, not protocols; batch indexer
  only if graph completeness is the proven gap.
- Maintainer accepted both verdicts; this PRD encodes the agreed path.
- 2026-08-22 implementation planning (MiniMax-M3 via `ax-code run`): two
  workstreams — Phase 0 harness + D5 remainder; plan at
  `.tmp/minimax-m3-plan.md`. Executed; the mandatory re-census during D5
  corrected two plan misses (core src imports `internal/log`; reason has 24
  used subpaths, not 1).
- 2026-08-22 E3 gate review (MiniMax-M3 + DeepSeek-v4-pro via `ax-code run`,
  independent verdicts): Phase 3 no-op, Phase 4 not triggered, on the recorded
  external baseline; reopen conditions recorded in §4. Both reviewers flagged
  that the synthetic-only first baseline could not discharge G4 — the external
  SHA-pinned baseline (zod/pydantic/ripgrep) was recorded the same day to
  close that gap.
- 2026-08-22 completion verification (MiniMax-M3 + DeepSeek-v4-pro via
  `ax-code run`, independent read-only verdicts at
  `.tmp/council-minimax-prd-verify.md` and
  `.tmp/council-deepseek-prd-verify.md`): **PRD ACCURATE** — D1–D5 confirmed
  against code with file:line evidence; Phase 3/4 rationale numbers match the
  recorded baseline. Both reviewers independently flagged one precision nit —
  the "warm queries 0–14 ms" summary is a p50 figure (p95 reaches 44 ms on
  ts-zod references) — corrected in §4. Tests re-run green the same day:
  typecheck clean (core + intel), 26 core `test/lsp/` files (179 tests),
  75 standalone intel package tests, 147 reason package tests; §5 metric
  updated to the verified counts.
