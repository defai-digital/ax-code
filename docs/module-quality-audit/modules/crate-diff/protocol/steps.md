# crate-diff Review Protocol

## Step 1 Scope and Public Surface

The `crate-diff` unit is the N-API diff engine declared as both `cdylib` and `rlib` in `crates/ax-code-diff/Cargo.toml:8-9`, with native setup in `crates/ax-code-diff/build.rs:1-5`. Contrary to the preliminary “none” export sample in `docs/module-quality-audit/modules/crate-diff/MODULE-AUDIT.md:31-32`, `crates/ax-code-diff/src/lib.rs:22-28`, `src/lib.rs:196-212`, and `src/lib.rs:230-265` expose seven functions: edit/replace, sequence seeking, unified diff, diff statistics, two string-distance operations, and chunk application. The benchmark surface is registered at `crates/ax-code-diff/Cargo.toml:11-13`.

## Step 2 Native Boundary and Input Risk

All runtime inputs cross N-API as owned strings or string vectors; the structured chunk boundary is parsed with `serde_json::from_str` and converts parse failures into JavaScript-visible errors at `crates/ax-code-diff/src/lib.rs:265-271`. File paths are used only in diff headers and diagnostic text at `src/lib.rs:290-293` and `src/lib.rs:354-356`; the crate performs no filesystem, process, environment, network, or unsafe operation. Resource risk is therefore dominated by caller-controlled allocation and CPU cost rather than privilege or secret exposure.

## Step 3 Correctness and State Transitions

`edit_replace` rejects empty or identical search text at `crates/ax-code-diff/src/lib.rs:29-36`, requires a unique candidate at `src/lib.rs:60-90`, and distinguishes absent from ambiguous matches at `src/lib.rs:94-101`. Sequence matching proceeds exact, right-trimmed, fully trimmed, then Unicode-normalized at `src/lib.rs:149-191`. Chunk replacements are collected against the original line array and spliced in reverse order at `src/lib.rs:338-347`, preserving earlier indices. A parity concern remains: a native pure addition uses the current cursor at `src/lib.rs:302-306`, while the JavaScript fallback inserts an unanchored addition at end-of-file in `packages/ax-code/src/patch/index.ts:401-408`.

## Step 4 Failure Semantics and Edge Cases

Native failures are explicit: malformed chunk JSON, missing context, and missing old lines return contextual `napi::Error` values at `crates/ax-code-diff/src/lib.rs:270-271`, `src/lib.rs:289-293`, and `src/lib.rs:329-334`. The empty-pattern guard prevents the multi-occurrence loop from stalling at `crates/ax-code-diff/src/helpers.rs:503-513`, and its regression test is at `crates/ax-code-diff/src/lib.rs:616-620`. The principal TypeScript caller avoids the native edit path for CRLF content at `packages/ax-code/src/tool/edit-impl.ts:745-747`, containing a line-ending behavior difference before fuzzy reconstruction.

## Step 5 Performance and Scaling

The ordered strategy table at `crates/ax-code-diff/src/helpers.rs:518-542` can scan and allocate repeatedly before a unique match is found. The block-anchor candidate search nests a forward scan inside every matching first anchor at `src/helpers.rs:168-183`, giving quadratic worst-case behavior on repeated anchors; unified diff and statistics each construct a separate `TextDiff` at `src/helpers.rs:546-575`. The supplied benchmark covers replacement, seek, diff, and Levenshtein at `crates/ax-code-diff/examples/bench.rs:6-10`, but its seek loop rebuilds reference vectors on every iteration at `examples/bench.rs:50-70`, so those figures include harness allocation overhead.

## Step 6 Design and Contract Alignment

Internal matching and diff primitives remain crate-private in `crates/ax-code-diff/src/helpers.rs:5-24` and are re-exported only through the N-API functions imported by `crates/ax-code-diff/src/lib.rs:4-6`. The generated declarations in `packages/ax-code-diff-native/index.d.ts:10-46` agree with the seven Rust signatures, including JSON strings for compound results. The wrapper package declares five native targets and a generated binary build at `packages/ax-code-diff-native/package.json:7-24`. The native/TypeScript insertion mismatch from Step 3 is therefore a contract-parity issue, even though repository search found no current `applyChunks` call outside its declaration.

## Step 7 Hygiene and Test Coverage

The crate manifest declares `thiserror` and `unicode-normalization` at `crates/ax-code-diff/Cargo.toml:20-23`, but the reviewed crate sources do not reference either dependency; normalization is implemented manually at `crates/ax-code-diff/src/helpers.rs:5-20`. Unit coverage exercises replacement strategies, seek modes, unified diff, statistics, normalization, offsets, and the empty-search regression throughout `crates/ax-code-diff/src/lib.rs:371-620`. No test in that module exercises the public `apply_chunks` path at `src/lib.rs:259-367`, leaving chunk ordering, pure additions, JSON rejection, and native/fallback parity as the clearest coverage gap.

## Step 8 Finding Register Disposition

The supplied register contains no accepted entry at `docs/module-quality-audit/modules/crate-diff/MODULE-AUDIT.md:51-55`, and no file exists under this unit’s `findings/` path. This review records the unanchored pure-addition parity issue (`crates/ax-code-diff/src/lib.rs:302-306`) as a non-Critical correctness follow-up and the unused dependencies (`crates/ax-code-diff/Cargo.toml:20-23`) as cleanup. Neither observation meets Critical severity, so the conditional secondary-confirmation artifact is not applicable.

## Step 9 Verification and Exit Evidence

`cargo test --manifest-path crates/Cargo.toml -p ax-code-diff` passed all 25 unit tests and doc-tests; the test module begins at `crates/ax-code-diff/src/lib.rs:369-373`. `cargo clippy --manifest-path crates/Cargo.toml -p ax-code-diff --all-targets -- -D warnings` passed, and scoped `rustfmt --edition 2024 --check` passed for the four reviewed Rust sources; the inherited edition is defined at `crates/Cargo.toml:13-21`. A workspace-wide format check also exposed only pre-existing differences in other crates, outside `crate-diff`, and no such file was modified.
