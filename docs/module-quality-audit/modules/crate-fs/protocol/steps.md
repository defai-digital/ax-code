# Review Protocol — crate-fs

| Field                | Value                                      |
| -------------------- | ------------------------------------------ |
| Unit slug            | `crate-fs`                                 |
| Scope                | `crates/ax-code-fs`                        |
| Reviewer (primary)   | ax-code-glm                                |
| Independent verifier | codex-sol                                  |
| Model                | zai-coding-plan/glm-5.2[1m]                |
| Date                 | 2026-08-11                                 |
| Baseline commit      | `994f9287e497666e104644eccea299595a35b39a` |

This is the primary reviewer's 9-step pass over the candidate sources actually
read for this unit: `crates/ax-code-fs/build.rs`,
`crates/ax-code-fs/examples/bench.rs`, `crates/ax-code-fs/src/detect.rs`,
`crates/ax-code-fs/src/embedding.rs`, `crates/ax-code-fs/src/lib.rs`, and
`crates/ax-code-fs/src/watcher.rs`, plus `Cargo.toml` and
`crates/ax-code-fs/ignore-patterns.json` for contract context.

## Step 1 Scope and map

The crate is a N-API `cdylib`/`rlib` workspace member (`Cargo.toml:9`,
`crate-type = ["cdylib", "rlib"]`) that exposes filesystem primitives to
TypeScript. `src/lib.rs` re-exports `embedding::*` and `watcher::*` and
declares `mod detect;` privately (`src/lib.rs:4-9`). The public NAPI surface
lives in three files:

- `src/lib.rs` — `walk_files`, `glob_files`, `search_content`, `is_ignored`,
  `scan_files`, `read_files_batch`, the `FileTree` class, and three thin
  `detect_*` wrappers (`src/lib.rs:110, 204, 402, 508, 709, 834, 1020,
1140-1153`).
- `src/embedding.rs` — `chunk_file`, `normalize_for_embedding`,
  `estimate_tokens`, `content_hash` (`src/embedding.rs:22, 81, 137, 143`).
- `src/watcher.rs` — the `NativeWatcher` class (`src/watcher.rs:29`).

`src/detect.rs` has no `#[napi]` symbols of its own; its three
`detect_*_native` free functions are invoked only from the wrappers in
`lib.rs` (`src/detect.rs:888, 952, 1009`). `build.rs` is the canonical
two-line `napi_build::setup()` shim. `examples/bench.rs` is a dev-only
micro-benchmark (`Cargo.toml:11-13`). LOC counts match the audit map
(3143 across 6 files).

## Step 2 Threat and failure model

Inputs cross the JS→Rust boundary as JSON strings and are deserialized with
`serde_json::from_str` at the entry of every export (`src/lib.rs:112-113,
404-405, 509-510, 711-712, 835-836`; `src/detect.rs:890, 954, 1011`;
`src/embedding.rs:27`; `src/watcher.rs:42`). Deserialization errors are
propagated as `napi::Error` rather than panicking. Filesystem failures use
`continue`/`Err(_)` discard paths in walkers (`src/lib.rs:244-247`,
`src/detect.rs:912-914`) and an explicit short-circuit `Result` in
`read_files_batch` so the JS side can fall back per-file (`src/lib.rs:838-846`,
documented intent at `src/lib.rs:831-833`). The dominant runtime risks for
this unit are (a) unbounded memory growth in the watcher channel and
(b) silent redefinition of cross-tool contract fields — both detailed in later
steps. Secrets/process/IO exposure here is indirect: this crate reads source
files on behalf of the agent's scanner tools, so its risk profile is
"data the agent is already authorized to see."

## Step 3 Correctness

- `chunk_file` defends against the infinite loop that motivated BUG-302:
  overlap is clamped via `overlap_lines % max` and `max == 0` returns early
  (`src/embedding.rs:31-43`). Tests `chunk_file_zero_max_returns_empty` and
  `chunk_file_overlap` lock both branches (`src/embedding.rs:166-181`).
- `find_function_scopes` tracks `{`/`}` depth with a hand-rolled byte scanner
  that correctly skips string literals and block comments (`src/detect.rs:
357-409`), and a test proves block-comment braces are ignored
  (`src/detect.rs:1166-1180`). However the line-comment shortcut at
  `src/detect.rs:371-372` (`b'/' if ... => break`) terminates the per-line
  scan on the first `//`, which fires inside string literals — e.g. a line
  containing `const u = "https://x"` then a trailing `{` would miss that
  brace. Impact is bounded because the heuristic scanner only uses scopes to
  attribute resource leaks, but it is a real false-negative vector.
- The `truncated` flag in all three `detect_*_native` functions is computed
  as `files.len() >= input.max_files` (`src/detect.rs:901, 965, 1022`). Since
  `collect_scan_files` breaks as soon as the cap is reached
  (`src/detect.rs:1088-1090`), a repository that happens to contain exactly
  `max_files` candidate files is reported truncated with a `file-cap-hit`
  heuristic even though nothing was dropped. The boundary is off-by-one
  relative to the documented meaning.
- `walk_files`'s `limit` semantics — `0` and `None` both mean "no limit"
  (`src/lib.rs:142-143`) — are covered by `walk_files_respects_limit`
  (`src/lib.rs:1274-1295`), which is the cleanest contract in the file.

## Step 4 Performance

The walker config is consistent and correct: `.git_ignore(true)` plus
`.git_global(true)` and `.git_exclude(true)` everywhere a walk occurs
(`src/lib.rs:125-127, 212-214, 422-424, 747-749`; `src/detect.rs:1080-1084`;
`src/lib.rs:892-895` for `FileTree::scan`). Hot-path regex/glob compilation
is hoisted into `LazyLock`Statics for `SECURITY_PATTERNS`
(`src/detect.rs:78`), `LIFECYCLE_RULES` (`src/detect.rs:269`),
`HARDCODE_PATTERNS` (`src/detect.rs:534`), `IGNORE_FOLDERS` and
`IGNORE_FILE_MATCHERS` (`src/lib.rs:90, 98`) — with an inline rationale at
`src/lib.rs:94-97` citing PERF-07/NAT-03. Parallel scanning is via
`rayon::par_iter` (`src/detect.rs:908-924`; `src/lib.rs:786-817, 838-846`).
The one efficiency gap is in `scan_files`: each file is read once but a fresh
`grep_searcher::Searcher` is constructed per `(file, pattern)` pair inside the
inner loop (`src/lib.rs:792-797`), so for `P` patterns the searcher is rebuilt
`files × P` times. Reusing one searcher per pattern outside the file loop
would cut allocations noticeably on large batches. The `before_buf` uses
`pop_front` (BUG-284 fix, `src/lib.rs:363-365`) so the `VecDeque` is O(1)
amortized — good.

## Step 5 Design

The crate is a thin, well-bounded native accelerator: each TS-facing function
takes a JSON string and returns a JSON string, deliberately avoiding rich
NAPI types except for the two stateful classes (`FileTree`, `NativeWatcher`)
that legitimately need object identity. Cohesion within `detect.rs` is high —
security, lifecycle, and hardcode scanners share `DetectResult`, `is_suppressed`,
and `collect_scan_files`. One ownership smell: `FileTreeInner` is guarded by a
single `Arc<Mutex<…>>` (`src/lib.rs:1022, 868-873`) and every read path
(`glob`, `file_count`, `has_file`, `file_meta` at `src/lib.rs:1061, 1080,
1112, 1122`) takes the same mutex, so readers serialize against each other and
against watcher-driven `update_file`. For the current single-consumer usage
this is acceptable; if a future caller fans out concurrent globs it will
contend. A `RwLock` or `parking_lot::RwLock` would be the proportional upgrade.
The `root` field on `NativeWatcher` is `#[allow(dead_code)]` and stored only
for diagnostics (`src/watcher.rs:32-34, 114`), which is honest but worth
either a debug-assert root check or removal.

## Step 6 Hygiene and dead code

The `#[allow(dead_code)]` on `FunctionScope::end` (`src/detect.rs:336`) is
legitimate — `end` is carried for future use but only `start`/`content` are
read. The `root` field on `NativeWatcher` (`src/watcher.rs:32-34`) is
`#[allow(dead_code)]` and could either be dropped or used for an
`assert!(path.starts_with(&self.root))` sanity check in `poll`. The most
notable drift hazard is in `examples/bench.rs`: it re-declares a hardcoded
`IGNORE_FOLDERS` constant (`examples/bench.rs:17-46`) that is a frozen copy of
`ignore-patterns.json`. It is a dev binary so there is no runtime impact, but
the comment at `src/lib.rs:73-76` warns that the JSON must stay in sync with
`packages/ax-code/src/file/ignore-patterns.json`; the bench's separate list is
a third source of truth that silently diverged long ago (it omits
`.webkit-cache`, `__pycache__`, etc.). No empty error swallow sites were
observed; all `Err(_)` discards are deliberate (`continue` on stat failure,
`return Vec::new()` on read failure).

## Step 7 Tests

The crate carries substantive inline coverage — not "tests live elsewhere."
`src/lib.rs` has 14 `#[test]` functions covering `is_ignored` folders,
files, extras, and normal-path negatives (`src/lib.rs:1175-1252`), `walk_files`
basic/limit/hidden/ignore behavior (`src/lib.rs:1256-1355`), and `glob_files`
basic/limit/mtime ordering (`src/lib.rs:1359-1416`). `src/embedding.rs` has 9
tests covering chunking, overlap, zero-max guard, unicode normalization, and
hash determinism (`src/embedding.rs:154-227`). `src/detect.rs` has 3 targeted
regression tests for UTF-8 truncation boundaries, per-variable map-growth
detection, and block-comment brace handling (`src/detect.rs:1131-1180`). Gaps:
`scan_files`, `search_content` (the ContentSink pending/after-context flush
logic at `src/lib.rs:296-345`), `read_files_batch`, the entire `FileTree`
class, and `NativeWatcher` have no direct unit tests — they are exercised only
through the JS wrapper. The context-flush sink is the highest-value untested
logic because its `pending`/`after_remaining` state machine is non-trivial.

## Step 8 Findings register

Primary-reviewer findings raised in this pass (no Critical; nothing yet in
`findings/` — codex-sol to independently confirm or refute):

| #   | Severity | Location                                                          | Note                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | MEDIUM   | `src/embedding.rs:54-56, 143-148`                                 | `content_hash`/chunk hash uses `std::collections::hash_map::DefaultHasher`, documented in the std docs as not stable across Rust versions and not for persistence. If the JS consumer persists these hashes as cache keys (the embedding pipeline is the likely consumer), a toolchain bump silently invalidates them. Switch to a stable hasher (blake3 / sha2) for any persisted hash, or document that the value is session-scoped only. |
| F2  | MEDIUM   | `src/detect.rs:906-924, 970-981, 1027-1038`; `src/lib.rs:783-817` | The `filesScanned` counter increments on every `par_iter` invocation, i.e. on every candidate file _attempted_, including ones whose `read_to_string` subsequently fails. The field name implies successful reads; downstream heuristics that compare `findings.length / filesScanned` will be slightly pessimistic. Increment after the successful read instead.                                                                           |
| F3  | MEDIUM   | `src/detect.rs:901-904, 965-968, 1022-1025`                       | `truncated = files.len() >= max_files` reports `file-cap-hit` even when the matching set is exactly `max_files` (no truncation occurred). Should be `>` only if the walker kept walking past the cap, or emit a separate `cap-eq` signal.                                                                                                                                                                                                   |
| F4  | LOW      | `src/lib.rs:203-269`                                              | `glob_files` skips `.git` but does _not_ apply the `IGNORE_FOLDERS` filter that `walk_files`/`search_content`/`scan_files` all apply, relying solely on `.gitignore`. In a non-git directory or for un-ignored `node_modules`, glob will return build artifacts. Likely intentional for free-form globbing but worth a doc comment.                                                                                                         |
| F5  | LOW      | `src/watcher.rs:48`                                               | `mpsc::channel()` is unbounded; if OS event production outpaces `poll()` draining, the queue grows without limit. For long-lived watchers with slow pollers this is a slow leak. A bounded channel with `try_send` + drop-oldest policy would cap memory.                                                                                                                                                                                   |
| F6  | LOW      | `src/detect.rs:371-372`                                           | Line-comment shortcut `b'/' if … b'/' => break` fires inside string literals (e.g. `"https://…"`) and can miss braces later on the same line, skewing scope depth. Heuristic-only impact.                                                                                                                                                                                                                                                   |
| F7  | INFO     | `examples/bench.rs:17-46`                                         | Hardcoded `IGNORE_FOLDERS` duplicates `ignore-patterns.json` and has already drifted (missing `__pycache__`, `.pytest_cache`, etc.). Dev-only.                                                                                                                                                                                                                                                                                              |
| F8  | INFO     | `src/watcher.rs:147-150`                                          | `is_active` swallows mutex poison as `false` while sibling methods propagate poison as `napi::Error`; minor consistency issue.                                                                                                                                                                                                                                                                                                              |

## Step 9 Verification and exit

No Critical findings were produced by this primary pass and the
`findings/` directory is empty, so no `reverify.md` is emitted by this lane
(codex-sol will record its own independent pass). Verification of the crate
itself means `cargo`-level checks; the commands that matter for this unit are
`pnpm build:native` (or `build:native:debug`) and the per-crate
`cargo test -p ax-code-fs`, which exercise the inline `#[test]` suites cited
in Step 7. Because this is a N-API `cdylib`, the JS-side contract tests under
`packages/ax-code/test/` are the real end-to-end gate, but those belong to
other units. Exit state for `crate-fs`: primary 9-step complete; awaiting
codex-sol independent verification of F1–F3 in particular.
