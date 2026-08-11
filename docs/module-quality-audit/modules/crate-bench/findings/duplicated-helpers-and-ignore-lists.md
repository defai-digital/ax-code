# Finding: duplicated `fmt_ns`/`report` helpers and hardcoded ignore lists

| Field    | Value                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity | LOW                                                                                                                                                                                          |
| Category | maintainability / drift                                                                                                                                                                      |
| Origin   | ax-code-glm (primary review, step 5)                                                                                                                                                         |
| Status   | accepted                                                                                                                                                                                     |
| Location | `crates/ax-code-bench/src/bench_diff.rs:7-26`, `crates/ax-code-bench/src/bench_fs.rs:9-28`, `crates/ax-code-bench/src/bench_index.rs:7-26`, and `crates/ax-code-bench/src/bench_fs.rs:32-75` |

## Evidence

1. The `fmt_ns` + `report` pair is byte-for-byte identical across all three bench binaries (`bench_diff.rs:7-26`, `bench_fs.rs:9-28`, `bench_index.rs:7-26`). Three copies of the same ~20 lines.
2. `bench_fs.rs:32-75` hardcodes `IGNORE_FOLDERS` (29 entries) and `IGNORE_FILE_PATTERNS` (11 entries) as plain `&[&str]` constants, duplicating the source of truth in `crates/ax-code-fs/src/lib.rs` (`IGNORE_FOLDERS` is a `LazyLock<HashSet<String>>` referenced at `lib.rs:90`, and the same name is used at lines 171, 456, 517, 770). The bench version was hand-copied and has no compile-time link to the fs crate.
3. Similarly, `bench_diff.rs:37-101` inlines `strategy_simple` / `strategy_line_trimmed` / `seek_sequence_exact` / `seek_sequence_trimmed`, while the production crate exposes `seek_sequence_impl` (`crates/ax-code-diff/src/lib.rs:149`) and `strategy_*` helpers under different signatures with an added `eof` flag.

## Impact

Drift risk: when `IGNORE_FOLDERS` gains or loses entries (e.g., a new cache dir), the bench keeps measuring the old set; when `seek_sequence_impl` changes its trimming or EOF semantics, the bench keeps timing the stale algorithm. The duplication is invisible to the compiler because each bench is a standalone `[[bin]]` with no shared module.

## Suggested action

- Extract `fmt_ns`/`report` (and the `make_content` helper in `bench_diff.rs:28-33`) into a `crates/ax-code-bench/src/common.rs` and `#[path = "common.rs"] mod common;` from each binary target — one place to edit, no API surface added.
- For the ignore lists and diff strategies, prefer benching through the real `ax-code-fs` and `ax-code-diff` crate APIs (path dependencies) rather than re-declaring the constants. If decoupled benching is intentional, add a `// MIRRORS crates/ax-code-fs/src/lib.rs:90 — keep in sync` anchor comment and a line in the bench README so the next maintainer knows the link is manual.
