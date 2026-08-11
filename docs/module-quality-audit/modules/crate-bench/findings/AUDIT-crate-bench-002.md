# AUDIT-crate-bench-002: WAL pragma against in-memory SQLite is a no-op

| Field | Value |
|-------|-------|
| ID | `AUDIT-crate-bench-002` |
| Module | [`crate-bench`](../MODULE-AUDIT.md) |
| Primary category | correctness |
| Secondary tags | performance, sqlite, measurement-drift |
| Severity | Low |
| Status | deferred |
| Origin | new |
| Reporter / owner | ax-code-glm / AX Code maintainers |
| First observed | 2026-08-11 (dual-agent protocol review) |
| Source | `crates/ax-code-bench/src/bench_index.rs:57-65` |
| Impacted units | crate-bench (measurement only) |
| Target / expiry | 2026-09-11 |
| Fix / test | n/a (deferred) |
| Independent verifier | n/a |

## Summary

`open_db` opens `Connection::open_in_memory()` then runs `PRAGMA journal_mode = WAL` (and related pragmas). SQLite ignores WAL for `:memory:` DBs, so the bench does not exercise the file-backed production SQLite path.

## Evidence

- `bench_index.rs:58` opens in-memory.
- Pragmas at `bench_index.rs:57-65` set `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout`, `cache_size`.
- For `:memory:`, `journal_mode` remains `memory`; `synchronous` / `busy_timeout` are moot on a single in-memory connection.

## Impact and severity

- Relative in-memory comparisons remain useful; absolute ns/op is not representative of file-backed production.
- Severity: Low (localized measurement quality; no product behavior defect).

## Deferral

| Item | Value |
|------|-------|
| Owner | AX Code maintainers (native/index) |
| Rationale | Bench labeling / optional file-backed variant; not a production correctness bug. |
| Mitigation | Treat current numbers as in-memory hot path only; production schema still applies WAL to file DBs. |
| Residual risk | Readers may over-estimate disk-bound throughput if they ignore the memory DB context. |
| Review / expiry | 2026-09-11 — document section as in-memory, or add tempfile-backed `open_db_file()` with pragma assert. |

## Recommended fix (when scheduled)

Document call site as in-memory (no WAL), and/or add a file-backed variant that asserts `pragma journal_mode` returns `wal`.
