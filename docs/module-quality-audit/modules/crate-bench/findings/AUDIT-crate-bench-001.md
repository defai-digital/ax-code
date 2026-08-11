# AUDIT-crate-bench-001: bench_index `gen_id` drifts from production `id::ascending`

| Field | Value |
|-------|-------|
| ID | `AUDIT-crate-bench-001` |
| Module | [`crate-bench`](../MODULE-AUDIT.md) |
| Primary category | correctness |
| Secondary tags | performance, measurement-drift, id-generation |
| Severity | Medium |
| Status | deferred |
| Origin | new |
| Reporter / owner | ax-code-glm / AX Code maintainers |
| First observed | 2026-08-11 (dual-agent protocol review) |
| Source | `crates/ax-code-bench/src/bench_index.rs:32-45` vs `crates/ax-code-index/src/id.rs:33-95` |
| Impacted units | crate-bench (measurement only; not production ID path) |
| Target / expiry | 2026-09-11 |
| Fix / test | n/a (deferred) |
| Independent verifier | codex-sol (not required for non-Critical) |

## Summary

The benchmark inlines a simplified `gen_id()` that diverges from production `id::ascending` on modulo bias, missing atomic CAS, and sort-key packing. Headline `ascending ID` ns/op therefore understates production cost under contention.

## Evidence

1. **Modulo bias** — bench uses `BASE62[(rng.random::<u8>() % 62) as usize]` (`bench_index.rs:42`). Production `random_base62` (`id.rs:35-44`) uses rejection sampling with `limit = 248`.
2. **Missing atomic CAS** — production `ascending` (`id.rs:88-95`) goes through `reserve_timestamp_counter` (`id.rs:69-86`); the bench has no atomic, no counter, no back-off.
3. **Sort-key packing** — production packs `(ts << 8) | cnt` via `encode_sort_key` (`id.rs:97-106`); the bench encodes only the raw timestamp (`bench_index.rs:38-40`).

## Impact and severity

- Reachability: bench/reporting only; production ID path is unaffected.
- Blast radius: misleading perf numbers; regressions in CAS/counter logic would not be caught by this bench.
- Severity: Medium (material measurement correctness with limited product reach).

## Deferral

| Item | Value |
|------|-------|
| Owner | AX Code maintainers (native/index) |
| Rationale | Bench-only measurement drift; no user-facing ID correctness defect. Fix is a path-dep + API rewiring of a S-size unit, not a release blocker. |
| Mitigation | Do not treat `ascending ID` bench output as production cost under contention; production path remains covered by index unit tests. |
| Residual risk | Perf regressions in `reserve_timestamp_counter` may go unnoticed until a production-linked bench lands. |
| Review / expiry | 2026-09-11 — either wire `ax_code_index::id::ascending` into the bench or rename/document the building-block measurement. |

## Recommended fix (when scheduled)

(a) Call real `ax_code_index::id::ascending("code_node")` via path dep, or (b) rename bench to `id building blocks (no CAS, biased sample)` and document the divergence at the call site.
