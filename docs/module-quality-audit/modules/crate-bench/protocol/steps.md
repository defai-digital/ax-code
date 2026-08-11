# crate-bench — 9-Step Review Protocol

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Verifier lane: codex-sol
Scope: `crates/ax-code-bench` (three standalone `[[bin]]` targets, no `lib`).

## Step 1 — Scope and inventory

`crate-bench` is a benchmark-only crate. `crates/ax-code-bench/Cargo.toml:8-18` declares exactly three binary targets — `bench-index` (`src/bench_index.rs`, 279 LOC), `bench-diff` (`src/bench_diff.rs`, 208 LOC), `bench-fs` (`src/bench_fs.rs`, 258 LOC) — each with its own `fn main()` and no shared module. There is no `[lib]` target and zero `pub` exports across the crate (confirmed: every top-level `fn` in the three files is private). Deps (`Cargo.toml:20-27`) are `rusqlite`, `sha2`, `rand`, `globset`, `ignore`, `similar`, `strsim` — each consumed by exactly one binary. The MODULE-AUDIT inventory (`docs/module-quality-audit/modules/crate-bench/MODULE-AUDIT.md:17`) reports 3 files / 748 LOC; my own read counts 745 non-blank source lines, consistent.

## Step 2 — Threat and failure model

This crate produces no public API and is never linked into the runtime — its output is a `println!`-based report consumed by humans. The threat surface is therefore _measurement integrity_, not secrets or IO. I scanned all three files for hardcoded secrets, env vars, and network paths: none. The only fs-touching code is `bench_fs::bench_walk_files` (`bench_fs.rs:145-208`), which walks the repo upward looking for `crates/Cargo.toml` (`bench_fs.rs:155`) and then `WalkBuilder::new(root)` over the working tree — read-only, no writes, no shell-out. No `process::env` reads beyond `current_dir()`. So the "risk tags: quality" classification on the audit row is correct; nothing here escalates to security.

## Step 3 — Correctness of the benchmarked algorithms

The most important finding lives here: `bench_index.rs:32-45` inlines a `gen_id()` that is _not_ what production runs. Real `id::ascending` (`crates/ax-code-index/src/id.rs:88-95`) routes through `reserve_timestamp_counter` (`id.rs:69-86`), an atomic `compare_exchange` loop with `yield_now()` back-off, plus `random_base62` (`id.rs:33-44`) which uses rejection sampling (`limit = 248`) to avoid modulo bias. The bench version uses `rng.random::<u8>() % 62` (`bench_index.rs:42`) — biased — and has no atomic, no counter, no back-off. The headline `ascending ID` number therefore understates production cost under contention and times a different RNG path. Detail written to `findings/bench-id-drift.md`. Smaller correctness issues: `bench_index.rs:172` uses `conn.execute("BEGIN", []).ok()` (error swallowed) while the matching `COMMIT` on line 181 unwraps — asymmetric. `gen_id` (`bench_index.rs:34-37`) unwraps `duration_since(UNIX_EPOCH)`, which panics on clock rollback; acceptable for a bench but worth a comment.

## Step 4 — Performance methodology

The harness uses raw `std::time::Instant` + `std::hint::black_box` with fixed op counts (10_000 for ID/SHA, 100 batches × 200 for insert, 100_000 for interval scans). There is no criterion/`#[bench]` rig, no warmup, no outlier filtering, no statistical CI — fine for ad-hoc relative comparisons but inadequate for tracking regressions across machines. Specific measurement bugs found: (a) `open_db` (`bench_index.rs:57-65`) sets `PRAGMA journal_mode = WAL` on a `Connection::open_in_memory()` — SQLite silently returns `memory` for in-memory DBs, so the WAL/synchronous pragmas are no-ops and the reported insert/query throughput is _not_ representative of the file-backed production DB; written to `findings/sqlite-wal-on-memory-db.md`. (b) `bench_fs::bench_walk_files` walks the live working tree of whatever machine runs it (`bench_fs.rs:171-207`), so the `walk repo (ignore-aware)` number is non-deterministic across CI runs and depends on the dirty state of the checkout. (c) The interval-tree simulation (`bench_index.rs:99-135`) measures a `linear_scan` vs `sorted_scan` of 5k `Interval{start,end,id}` structs, but production `interval_tree.rs` (`crates/ax-code-index/src/interval_tree.rs:1-80`) packs `(line,char)` into a richer `Interval` with a `size()` metric and a `contains()` boundary check — the bench's `linear_scan` body (`bench_index.rs:106-119`) is a faithful shape but not the same inner loop.

## Step 5 — Design and ownership

The crate's structure is "three mains, zero shared code." Concrete duplication: `fmt_ns` + `report` are byte-identical across `bench_diff.rs:7-26`, `bench_fs.rs:9-28`, and `bench_index.rs:7-26` — three copies of ~20 lines that a `#[path = "common.rs"] mod common;` would collapse. `bench_fs.rs:32-75` hand-copies `IGNORE_FOLDERS` (29 entries) and `IGNORE_FILE_PATTERNS` (11 entries) from `crates/ax-code-fs/src/lib.rs:90`, which compiles them into a `LazyLock<HashSet<String>>`; the bench copy is invisible to the compiler and silently drifts (see `findings/duplicated-helpers-and-ignore-lists.md`). Likewise `bench_diff.rs:37-101` re-declares `strategy_simple`/`strategy_line_trimmed`/`seek_sequence_exact`/`seek_sequence_trimmed`, while production `crates/ax-code-diff/src/lib.rs:149` exposes `seek_sequence_impl` with an added `eof` flag — drift risk on trimming and EOF semantics. Ownership is otherwise clean: each binary owns its `main`, no mutation crosses files, and there is no shared mutable state.

## Step 6 — Dead code and over-engineering

No dead `pub` items (there are no `pub` items at all). I checked for unused helpers: `make_content` (`bench_diff.rs:28-33`) is used by `bench_simple_replace`, `bench_line_trimmed`, and `bench_unified_diff` — live. `strategy_line_trimmed` (`bench_diff.rs:41-63`) is called once by `bench_line_trimmed` — live. The `make_content` closure pattern is fine. There is no over-engineering — if anything the crate is under-abstracted (see Step 5). I did not find unreachable branches; the `if search.is_empty() || original.len() < search.len()` guard (`bench_diff.rs:47-49`) and the `pattern.is_empty() || lines.len() < pattern.len()` guards (`bench_diff.rs:66-68, 84-86`) are correct underflow protectors for the `0..=(len - search.len())` ranges that follow.

## Step 7 — Tests and verification coverage

There are no `#[test]` items in `crates/ax-code-bench/` itself (no `#[cfg(test)]` block in any of the three source files, no `tests/` directory). The only test the MODULE-AUDIT inventory points at is `packages/ax-code/test/script/bench-scripts.test.ts` (37 LOC); reading it, that test asserts the _TypeScript_ bench harnesses (`bench-both.ts`, `bench-opencode.ts`) sanitize env, kill spawned processes from `finally`, and use `createAxCodeClient` naming — it does not compile, run, or assert anything about the Rust `ax-code-bench` binaries. So the Rust crate has zero verification coverage: no test enforces that the inlined algorithms match production, no test guards against drift in `IGNORE_FOLDERS`, no CI step fails if the bench panics. For a `[[bin]]` crate this is tolerable (the binary is its own smoke test), but it leaves the Step-3 and Step-5 drift findings completely unguarded. The crate is also not in the `pnpm run test:scripts` surface I verified from `AGENTS.md`.

## Step 8 — Finding register

Three findings accepted this pass, none Critical, none High:

| Finding                                                                            | Severity | File                                              |
| ---------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| `gen_id` divergence from `id::ascending` (modulo bias, no atomic, no counter)      | MEDIUM   | `findings/bench-id-drift.md`                      |
| Triple-duplicated `fmt_ns`/`report` and hand-copied `IGNORE_*` / `seek_sequence_*` | LOW      | `findings/duplicated-helpers-and-ignore-lists.md` |
| `PRAGMA journal_mode = WAL` on `:memory:` is a no-op                               | LOW      | `findings/sqlite-wal-on-memory-db.md`             |

All three are advisory — this crate ships no public API and no runtime behavior, so none block the module gate. The MEDIUM item is the most worth acting on because it makes the headline ID number misleading.

## Step 9 — Verification and exit

Files read for this review (real paths): `crates/ax-code-bench/Cargo.toml`, `crates/ax-code-bench/src/bench_diff.rs`, `crates/ax-code-bench/src/bench_fs.rs`, `crates/ax-code-bench/src/bench_index.rs`, `crates/ax-code-index/src/id.rs`, `crates/ax-code-index/src/interval_tree.rs`, `crates/ax-code-fs/src/lib.rs` (grep over `IGNORE_FOLDERS` at lines 90/171/456/517/770), `crates/ax-code-diff/src/lib.rs` (grep over `seek_sequence_impl` at line 149), `packages/ax-code/test/script/bench-scripts.test.ts`, and `docs/module-quality-audit/modules/crate-bench/MODULE-AUDIT.md`. Because `crate-bench` has no library export and no Rust test target, there is no `cargo test` or `pnpm run typecheck` surface to run for this unit — verification is by source read and cross-crate comparison only; I did not execute `cargo bench` because the binaries walk the live repo (`bench_fs.rs:171-207`) and produce non-deterministic output. No Critical findings exist in `findings/`, so no `reverify.md` is emitted. Handing to verifier lane `codex-sol` for the independent second pass.
