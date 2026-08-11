# AUDIT-crate-bench-003: Duplicated helpers and hardcoded ignore lists drift from crates

| Field | Value |
|-------|-------|
| ID | `AUDIT-crate-bench-003` |
| Module | [`crate-bench`](../MODULE-AUDIT.md) |
| Primary category | quality |
| Secondary tags | dead-code, maintainability, drift |
| Severity | Low |
| Status | deferred |
| Origin | new |
| Reporter / owner | ax-code-glm / AX Code maintainers |
| First observed | 2026-08-11 (dual-agent protocol review) |
| Source | `crates/ax-code-bench/src/bench_diff.rs:7-26`, `bench_fs.rs:9-28,32-75`, `bench_index.rs:7-26`; production mirrors in `crates/ax-code-fs` / `crates/ax-code-diff` |
| Impacted units | crate-bench |
| Target / expiry | 2026-09-11 |
| Fix / test | n/a (deferred) |
| Independent verifier | n/a |

## Summary

`fmt_ns`/`report` are duplicated across three bench binaries; `IGNORE_*` lists and diff strategies are hand-copied from production crates with no compile-time link, so benches can silently measure stale algorithms/constants.

## Evidence

1. Identical `fmt_ns` + `report` in `bench_diff.rs:7-26`, `bench_fs.rs:9-28`, `bench_index.rs:7-26`.
2. `bench_fs.rs:32-75` hardcodes `IGNORE_FOLDERS` / `IGNORE_FILE_PATTERNS` while production uses `LazyLock` sets in `crates/ax-code-fs/src/lib.rs`.
3. `bench_diff.rs:37-101` inlines strategies that production exposes via `ax-code-diff` (`seek_sequence_impl`, etc.) with different signatures.

## Impact and severity

- Drift risk only: benches may keep timing old ignore sets or algorithms after production changes.
- Severity: Low (maintainability / measurement quality; no direct user path).

## Deferral

| Item | Value |
|------|-------|
| Owner | AX Code maintainers (native) |
| Rationale | Hygiene debt in standalone `[[bin]]` targets; low product risk; cheap when next bench work lands. |
| Mitigation | Prefer production path deps for new benches; treat current benches as approximate until shared module lands. |
| Residual risk | Silent measurement drift if ignore lists or diff strategy change without bench updates. |
| Review / expiry | 2026-09-11 — extract `common.rs` and/or path-depend production crates; add sync comments if intentional decoupling remains. |

## Recommended fix (when scheduled)

Extract shared helpers into `crates/ax-code-bench/src/common.rs`; bench through real `ax-code-fs` / `ax-code-diff` APIs where possible.
