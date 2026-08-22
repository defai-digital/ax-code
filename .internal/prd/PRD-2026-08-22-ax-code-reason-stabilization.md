# PRD: AX Code Reason Stabilization & Evidence Integrity

| Field    | Value                                                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status   | Complete — Phases 0–3 and 4-prep resolved 2026-08-22 (Phase 4 not triggered per the E4 gate; reopen conditions in §4). Verified by council re-review (MiniMax-M3 + DeepSeek-v4-pro) and full deterministic suite (7911 tests, 0 failures). |                                                                                                                                                                                                                            |
| Owner    | AX Code CLI maintainers                                                                                                                                                                                                              |
| Created  | 2026-08-22                                                                                                                                                                                                                           |
| Related  | `@ax-code/ax-code-reason` extraction (020b4b551, 545dabb7a); 2026-08-22 council review; sibling ax-code-intel stabilization program (perf baseline harness in `packages/ax-code-intel/perf/`, explicit subpath exports in c6d582dd7) |
| Location | `.internal/prd/PRD-2026-08-22-ax-code-reason-stabilization.md` (moved from `docs/prd/` per repo policy 2026-08-22)                                                                                                                                                     |

---

## 1. Problem statement

`@ax-code/ax-code-reason` (the deterministic debugging & refactoring reasoning
engine, ~7.8k LOC) powers the agent's assurance lane: deterministic call-chain
analysis (`analyze-bug`), blast-radius analysis (`analyze-impact`), auditable
refactor plans with shadow-worktree gating (`plan-refactor`,
`apply-safe-refactor`), five heuristic scanners (duplicates, hardcodes,
lifecycle, races, security), the runtime debug case/evidence/hypothesis
lifecycle, and the quality contracts (findings, verification envelopes,
digests) that make reviews exportable and deduplicable.

A design review (2026-08-22, codex-cli/gpt-5.6-sol) concluded there is
meaningful room for improvement, but the best return is a **bounded
stabilization milestone**, not feature expansion. The package's weaknesses are
not capability coverage but **provability**:

- **D1 — Test ownership gap.** Only 2 package-owned test files for ~7.8k LOC.
  The 366 core tool tests exercise the engine through tools but cannot protect
  standalone contracts or expose accidental core coupling. The package cannot
  be released or reused on its own evidence.
- **D2 — Host abstraction leakage.** `CodeReasonHost` exposes a shard-aware
  drizzle handle and broad project context, leaking host storage and lifecycle
  assumptions into the engine and weakening the reuse goal.
- **D3 — Evidence freshness unbound.** Verification envelopes are not tied to
  the exact source state, command configuration, and freshness boundary they
  verified. A stale envelope cited by a finding, hypothesis confirmation, or
  refactor apply is misleading evidence.
- **D4 — Incremental equivalence unproven.** Incremental re-analysis has no
  defined invalidation semantics and no proof of equivalence with full analysis
  across edits, deletes, renames, graph lag, and cycles.
- **D5 — Lifecycle and plan rigor.** Hypothesis lifecycle relies on strict ID
  validation without an explicit state machine; refactor plans lack
  preconditions, drift detection, and per-step verification mapping.
- **D6 — Scanner expansion risk.** Broadening regex-oriented scanners language
  by language would grow maintenance and false confidence faster than useful
  detection. No per-rule precision/recall measurement exists.

### Implementation status

| Finding | v7.7.8 status | Notes |
| ------- | ------------- | ----- |
| D1 | Closed | Package owns an 18-file contract test matrix (193 tests standalone, green); core `test/debug-engine/glue-contract.test.ts` covers the adapter boundary. |
| D2 | Closed | `src/repository.ts` narrow sync `PlanRepository`/`EmbeddingRepository`; no drizzle client types in the package (guard grep clean); host injects `stores`/`sourceState`/`graphRevision`/`clock`/`abort`; core impl in `src/dre/repositories.ts` (commit 0ac9c45ab). |
| D3 | Closed | Envelopes carry optional `sourceState`/`graph`/`environment`/`execution` provenance with identity-projection IDs (v1 IDs bit-identical); `classifyEnvelopeFreshness`/`enforceCitationFreshness` reject stale citations on authoritative uses (`needs_verification`, never silent pass). |
| D4 | Closed | `src/incremental.ts`: `IncrementalContext`, `shouldFallbackToFull` (revision null/regress ⇒ full), `computeObsoleteFindings`; seeded-RNG (mulberry32) property tests prove incremental ≡ full at fixed revision incl. obsolete-finding removal (commit 019bd5efd). |
| D5 | Closed | `src/lifecycle.ts`: explicit HYPOTHESIS/CASE/INSTRUMENTATION/PLAN transition tables with terminal states and rejection reasons; plans carry preconditions/edit groups/verification mapping (first DRE migration `20260822000000_refactor_plan_rigor`); drift detection and `aborted` writes in apply-safe-refactor; replay terminal guard in `session/debug.ts` (commit 019bd5efd). |
| D6 | Gated, prep done | All five scanners emit conforming `ruleId` (`axcode:<scanner>-<pattern>`) and reports carry an audit caveat (commit e3d7e62bc); per-rule measurement itself remains E4-gated and unstarted. |

---

## 2. Goals

### Product goals

- **G1 — Trustworthy evidence chain:** Every verification envelope is bound to
  the exact source state it verified; stale envelopes are rejected when cited
  (D3).
- **G2 — Independently verifiable package:** The package owns a contract test
  matrix covering every public subpath, serving as its release gate (D1).
- **G3 — Reuse-ready host boundary:** Engine code never touches host storage
  or lifecycle directly; narrow repositories with explicit transaction
  semantics replace the raw drizzle handle (D2).
- **G4 — Provable incrementality:** Incremental results are demonstrably
  equivalent to full analysis, with safe fallback to full runs (D4).
- **G5 — Auditable reasoning:** Hypothesis transitions and refactor plan
  execution follow explicit, testable state machines with drift detection
  (D5).
- **G6 — Measured scanner value:** Scanner changes are funded by labeled
  precision/recall data, not speculation (D6).

### Engineering goals

- **E1 — Determinism preserved:** No nondeterministic inputs (learning,
  retrieval, opaque scores) enter authoritative paths.
- **E2 — Contract stability:** Tool-visible behavior, SSE/OpenAPI event
  shapes, and finding/envelope ID schemes remain unchanged unless a migration
  is explicitly planned.
- **E3 — Boundary validation:** All plain-string IDs and roots are validated at
  package boundaries; branded-ID conversion stays at core adapters.
- **E4 — Evidence-gated expansion:** Language scanner growth starts only after
  per-rule measurement infrastructure exists and usage data justifies it.

---

## 3. Non-goals

- **Cross-case learning / precedent retrieval.** Deferred: nondeterminism,
  stale advice, privacy, and the risk of confusing retrieved precedent with
  verified evidence outweigh current value. Revisit only if benchmarks show
  repeated cases, and then only as non-authoritative, versioned, local
  suggestions.
- **New language scanners** (Rust/Python/Ruby regex extensions) without
  labeled-corpus evidence of demand and missed findings.
- **Parser/graph-backed semantic scanners** before Phase 4 measurement
  justifies them.
- **Changing the deterministic finding/envelope ID scheme** (16-char hex
  dedup keys) — consumers and prior artifacts depend on stability.
- **Replacing shadow-worktree gating** — it remains the apply safety barrier.
- **Moving core tool implementations** into the package; tools stay in core,
  the package provides the engine.

---

## 4. Phases

### Phase 0 — Package-owned test matrix (D1) — **DONE 2026-08-22**

Port a focused contract matrix into `packages/ax-code-reason/test`:

1. Graph edge cases: cycles, missing nodes, truncated walks, phantom targets.
2. Malformed and partially-resolved stack traces for `analyze-bug`.
3. Deterministic ID stability (finding, envelope, case, hypothesis, plan).
4. Lifecycle transition rejection (invalid hypothesis/case/run transitions).
5. Persistence failure paths and event ordering.
6. Cancellation (AbortSignal where available) and timeout behavior.
7. Shadow-worktree cleanup on every failure path; idempotent retry.
8. Verification failure shapes (structured failures, skipped, timeout, error).
9. Adapter contract tests for the core glue boundary (plain-ID validation).
10. Fixtures for every public subpath export.

Exit: package tests runnable standalone
(`pnpm --dir packages/ax-code-reason test`) and adopted as the package release
gate; core 366 suite stays green.

Outcome: matrix landed and since grown to 18 files / 193 standalone tests
(green 2026-08-22); core reason-related suites green (667 targeted, 7911
deterministic, 0 failures).

### Phase 1 — Evidence integrity (D3) — **DONE 2026-08-22**

1. Extend verification envelopes with: commit or snapshot ID, dirty-state
   digest, graph revision, cwd, sanitized environment/config digest, tool
   versions, command selection rationale, start/end time, exit/signal/timeout,
   output hashes and truncation flags, and explicit
   pass/fail/skipped/unavailable states.
2. Enforce freshness on citation: findings, hypothesis confirmations
   (`debug_apply_verification` semantics), and refactor apply reject envelopes
   whose source state no longer matches (stale → `needs_verification`, never
   silent pass).
3. Backward compatibility: existing envelope consumers tolerate added fields;
   ID scheme unchanged.

Exit: staleness rejection covered by tests; no behavior change for fresh
envelopes.

Outcome: landed (commits incl. `d304d901a` + SDK regeneration `02bd64ae2`);
freshness state table and v1-ID lock covered by `test/freshness.test.ts` and
`test/verification-envelope.test.ts`.

### Phase 2 — Host port hardening (D2, E3) — **DONE 2026-08-22** (commit 0ac9c45ab)

1. Replace raw drizzle access with narrow repositories: case store, finding
   store, plan store, verification store — each with explicit transaction
   semantics.
2. Inject remaining environment concerns explicitly: AbortSignal propagation,
   clock, command runner, graph revision, path normalization, capability/
   version negotiation, typed event publishing.
3. Validate all plain IDs and roots at package boundaries; keep branded-ID
   conversion in core adapters.
4. Core glue (`dre-glue.ts`) updated accordingly; tool-visible behavior
   unchanged.

Exit: engine modules import no drizzle types; recursive typecheck clean;
Phase 0 matrix green.

Outcome: guard grep clean (only `schema.sql.ts` retains the drizzle DSL);
`Graph.Status.revision` derived hash implemented in core
`CodeIntelligence.status()`; one documented deviation — `sourceState()` is
async because the core helper shells out to git (`.tmp/phase2-minimax-report.md`).

### Phase 3 — Reasoning rigor (D4, D5) — **DONE 2026-08-22** (commit 019bd5efd)

1. **Incremental equivalence:** define invalidation semantics around graph
   revisions and source snapshots; add differential/property tests applying
   randomized graph changes and comparing incremental output with a clean full
   run (including removal of obsolete findings/evidence); fall back to full
   analysis when revision continuity or capabilities are unavailable.
2. **Hypothesis state machine:** explicit permitted transitions, evidence
   polarity and provenance, competing-hypothesis handling, source-revision
   invalidation, rejection reasons, terminal-state rules; confidence derived
   from transparent deterministic factors; confirmation requires envelope
   citations (already enforced — now tested as a state machine).
3. **Refactor plan safety:** plans carry source preconditions, affected
   symbol/file sets, ordered or atomic edit groups, per-step postconditions,
   risk annotations, rollback expectations, and mapped verification checks;
   drift detection before execution; explicit re-planning when preconditions
   fail; tests for partial-failure cleanup and idempotent retry.

Exit: property tests green; lifecycle and plan state machines documented and
tested.

Outcome: 300-trial seeded property tests green; five rejection reasons
(plan's four plus generic `illegal-transition`); core tools delegate to the
state machines; migration paired with the Phase 0 persistence tests.

### Phase 4 — Conditional scanner measurement (D6, E4-gated) — **NOT TRIGGERED 2026-08-22**

1. Build labeled per-rule corpora for the five scanners (JS/TS first).
2. Track precision, recall proxies, runtime, suppression rate, and duplicate
   stability per rule; publish as a measurement baseline.
3. Only with data: introduce parser/graph-backed semantic adapters, then fund
   Rust or Python coverage where usage and missed-finding data justify it.
4. Keep "clean scan ≠ full-language audit" labeling on all scanner outputs,
   especially security and race findings.

Exit (if started): per-rule metrics baseline recorded; any new coverage shows
measured precision above an agreed floor without regressions elsewhere.

**Outcome:** not started — the E4 precondition (per-rule measurement
infrastructure justified by usage/missed-finding data) is unmet and no
labeled corpus exists. Phase 4-prep (U4: `ruleId` + audit caveats, commit
e3d7e62bc) landed as the cheap prerequisite so a future measurement pass can
start data-first. Reopen conditions: a concrete workflow needs scanner
coverage the five JS/TS rule sets demonstrably miss (with labeled examples),
or usage data shows scanner volume justifying a precision/recall baseline.

---

## 5. Success metrics

| Metric                                   | Target                                              |
| ---------------------------------------- | --------------------------------------------------- |
| Package-owned contract tests             | 18 files / 193 tests, standalone green (2026-08-22) |
| Stale envelope citation                  | Rejected with `needs_verification`, 0 silent passes |
| Engine modules importing drizzle types   | 0 (guard grep clean 2026-08-22)                     |
| Incremental vs full equivalence tests    | Green: 300-trial seeded property + obsolete-finding removal |
| Hypothesis/plan invalid transitions      | All rejected, covered by `lifecycle.test.ts` + core suites |
| Core regression suite                    | Grown equivalent green: 7911 deterministic tests, 0 failures (2026-08-22; supersedes the original 366 figure) |
| Scanner rule metrics (if Phase 4 starts) | Not started — E4 gate unmet; ruleId/caveat prep landed |

---

## 6. Risks and mitigations

| Risk                                                     | Mitigation                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Envelope field growth breaks existing consumers          | Additive fields only; tolerance tests for older envelopes             |
| Repository refactor changes persistence timing semantics | Phase 0 persistence-failure tests first; core suite as regression net |
| Property tests flaky on randomized graph changes         | Seeded generators; deterministic fixtures for CI                      |
| Drift detection too strict → constant re-planning        | Measure re-plan rate; tune preconditions to material changes only     |
| Scanner corpora labeling cost                            | Start with highest-volume rules only; timebox                         |
| Phase 2 touches 13 tool consumers via glue               | Glue keeps tool-visible contracts identical; staged rollout per store |

---

## 7. Open questions

1. Should envelope freshness use the git worktree state directly, or the
   session snapshot system already recording file snapshots?
2. Is graph revision already exposed by the code-intelligence store in a form
   the engine can consume, or does the host port need a new revision source?
3. Do any planned surfaces (beyond current tools) need engine-level write
   access to findings, which would affect repository transaction design?

---

## 8. Decision record

- 2026-08-22 design review (codex-cli/gpt-5.6-sol): meaningful room exists,
  but best return is a bounded stabilization milestone — package-owned contract
  tests, host-port hardening, evidence freshness/completeness, and
  incremental-equivalence guarantees first; refactor and hypothesis rigor
  next; new language scanners and cross-case learning gated on benchmarked
  demand.
- Maintainer accepted the verdict; this PRD encodes the agreed path, mirroring
  the ax-code-intel stabilization program already underway (Phase-0 perf
  baseline harness landed in 696d73961).
- 2026-08-22 mid-execution council review (MiniMax-M3 + DeepSeek-v4-pro via
  `ax-code run`, read-only; `.tmp/council-minimax-reason-verify.md` /
  `.tmp/council-deepseek-reason-verify.md`): Phase 0 + Phase 1 confirmed done
  with file:line evidence; Phase 2/3 not started; Phase 4-prep overdue per
  the plan's unconditional ordering. Execution resumed from that verdict.
- 2026-08-22 implementation (via `ax-code run`, working-tree changes reviewed
  and committed by the maintainer agent): Phase 2 by MiniMax-M3 (0ac9c45ab),
  Phase 3 by DeepSeek-v4-pro (019bd5efd), Phase 4-prep by MiniMax-M3
  (e3d7e62bc). Per-phase reports: `.tmp/phase2-minimax-report.md`,
  `.tmp/phase3-deepseek-report.md`, `.tmp/phase4prep-minimax-report.md`.
- 2026-08-22 final council verification (MiniMax-M3 + DeepSeek-v4-pro,
  independent read-only verdicts; `.tmp/council-minimax-reason-final.md` /
  `.tmp/council-deepseek-reason-final.md`): every phase MEETS EXIT CRITERIA;
  both recommend Status → Complete with Phase 4 explicitly E4-gated and
  unstarted. Same-day test evidence: package 193/193, core deterministic
  7911/0 failures, typechecks clean, SDK rebuild no drift.
