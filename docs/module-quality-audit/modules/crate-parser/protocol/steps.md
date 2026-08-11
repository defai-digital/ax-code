# Protocol Steps — crate-parser

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Verifier lane: codex-sol
Unit root: `crates/ax-code-parser` · Baseline commit `994f9287e497666e104644eccea299595a35b39a`

This is a real 9-step review of the `crate-parser` unit, read directly from
`crates/ax-code-parser/build.rs` (5 lines) and `crates/ax-code-parser/src/lib.rs`
(901 lines). Each step below cites concrete `file:line` evidence gathered during
this pass, not a static extract.

## Step 1 Scope and map

`crate-parser` is the native tree-sitter symbol-extraction crate, compiled as a
`cdylib` (see `crates/ax-code-parser/Cargo.toml:9`) and exposed to Node via
N-API. The unit comprises exactly two source files:

- `crates/ax-code-parser/build.rs:3` — a 5-line build script whose entire body
  is `napi_build::setup();`. Nothing else.
- `crates/ax-code-parser/src/lib.rs` — 901 lines containing the `Symbol`/`Range`
  /`FileInput`/`FileSymbols` structs, the language registry, five per-language
  classifiers, visibility detection, and the NAPI exports.

The real public surface is the four `#[napi]` functions:
`extract_symbols` (`src/lib.rs:550`), `parse_batch` (`src/lib.rs:560`),
`supported_languages` (`src/lib.rs:588`), and `has_grammar` (`src/lib.rs:602`).

Note: the pre-existing MODULE-AUDIT "Exports (sample)" line claims
`greet@crates/ax-code-parser/src/lib.rs:615`. That is a **false positive from the
static extractor** — line 615 is inside the _test fixture string literal_
(`return \`Hello, ${name}!\``) of `test_typescript_symbols`, not a real export.
There is no `greet`symbol in this crate. The real exports are the four`#[napi]`
fns above. This was corrected during this read.

## Step 2 Threat and failure model

The crate is pure compute: no filesystem, no network, no process spawning, no
env reads. The only untrusted inputs are (a) a source-code string and language
tag for `extract_symbols`, and (b) a JSON array of `{path, content, language}`
for `parse_batch` (`src/lib.rs:32-36`, `src/lib.rs:560-562`). All failure modes
are bounded and surfaced as `napi::Error`:

- Unsupported language → `extract_with_parser` returns
  `Err("unsupported language: …")` at `src/lib.rs:528-529`, propagated by
  `extract_symbols` (`src/lib.rs:555`) and captured per-file in
  `parse_batch`'s `FileSymbols.error` (`src/lib.rs:575-579`).
- Parser-language mismatch → `set_language` error string at `src/lib.rs:531-533`.
- `parser.parse` returning `None` → `"failed to parse source"` at
  `src/lib.rs:535-537`.
- Malformed batch JSON → `"invalid JSON: …"` at `src/lib.rs:561-562`.

No secrets surface exists in this crate; there is no logging of source content
and no panic-prone `unwrap` on user data (the only `unwrap`s are in tests at
`src/lib.rs:635` onward and inside `node_text`'s `utf8_text().unwrap_or("")`
which degrades to empty rather than panicking, `src/lib.rs:69-71`).

## Step 3 Correctness

Three concrete correctness defects, all latent (existing tests do not catch
them):

1. **`export_statement` double-emission (TypeScript/JavaScript).** In
   `classify_ts` the `export_statement` arm delegates to the inner declaration
   and returns `Some(...)` (`src/lib.rs:212-216`). `extract_from_node` then
   treats the `export_statement` node itself as a Symbol _and_ unconditionally
   recurses into it at `src/lib.rs:101`, which re-finds the inner
   `function_declaration`/`class_declaration` and emits it again as a child.
   Net effect: for `export function greet(){}` the tree contains a top-level
   `greet` whose `children` also contains a `greet`. The test at
   `src/lib.rs:636-663` only checks top-level `names.contains("greet")`, so the
   duplicate is invisible to the suite.

2. **`const` kind misclassification (TypeScript).** `lexical_declaration` /
   `variable_declaration` compute `is_const = find_child_by_kind(node,
"const").is_some()` (`src/lib.rs:204`). In the tree-sitter-typescript grammar
   `const`/`let`/`var` are _anonymous_ keyword tokens, not named nodes, so
   `find_child_by_kind` (which compares `c.kind()` to `"const"` at
   `src/lib.rs:141`) will never match. Every `const X = …` is therefore reported
   as kind `"variable"` rather than `"constant"`. `test_typescript_symbols`
   asserts only that `MAX_SIZE` is present (`src/lib.rs:658-662`), never that its
   `kind == "constant"`.

3. **`impl_item` reported as a `"module"` symbol (Rust).** `classify_rust` maps
   `impl_item` to kind `"module"` named after the implemented type
   (`src/lib.rs:343-350`). This fabricates a top-level pseudo-module whose name
   collides with the real `struct`/`enum` (e.g. both `Animal` the struct at
   `src/lib.rs:319` and `Animal` the "module" at `src/lib.rs:343` appear). The
   test at `src/lib.rs:760-818` does not parse an `impl`, so the collision is
   unobserved. Downstream graph consumers keyed on qualified names will see
   duplicated `Animal::speak`-style paths.

## Step 4 Performance

Batch parsing is well-designed: `parse_batch` uses `files.par_iter().map_init(
Parser::new, …)` (`src/lib.rs:566-582`) so each rayon worker thread allocates and
reuses one `tree_sitter::Parser`, avoiding both lock contention and the cost of
re-creating a parser per file. `Parser` is `!Sync` so this is the correct shape.

Two minor observations, not blockers:

- `extract_with_parser` calls `parser.set_language(&lang)` on every file
  (`src/lib.rs:531-533`) even when consecutive files share a language. In the
  batch path the per-thread `Parser` is reused across languages, so the
  re-set is necessary for correctness when languages differ; caching the last
  language would be a micro-optimization only.
- `extract_symbols` (single-shot NAPI entry, `src/lib.rs:549-557`) constructs a
  fresh `Parser::new()` per call (`src/lib.rs:519`). For a one-shot entry point
  this is fine; the hot path is `parse_batch`, which already avoids it.

No quadratic walks: `extract_from_node` (`src/lib.rs:75-115`) is a single
depth-first traversal with a reused `TreeCursor` (`src/lib.rs:78`).

## Step 5 Design

The module is a flat dispatcher: `classify_node` (`src/lib.rs:118-133`) routes
by `lang` string to one of five `classify_*` functions, and `detect_visibility`
(`src/lib.rs:433-514`) routes again by the same `lang` string. Three parallel
`match lang { … }` blocks (classify_node at `:125`, the inner dispatch, and
detect_visibility at `:434`) keep the per-language logic side by side. For five
languages this is readable and avoids a trait-object abstraction that would be
over-engineered at this size — consistent with rule 13.

The `Symbol` struct (`src/lib.rs:10-20`) uses `#[serde(rename_all =
"camelCase")]` so the JSON consumed by the JS side (`FileSymbols` →
`fileSymbols`) is idiomatic, and the recursive `children: Vec<Symbol>` mirrors
the tree-sitter tree shape. The qualified-name separator is `::`
(`src/lib.rs:89-93`) regardless of source language; this is an internal key, not
user-facing syntax, so using Rust-style `::` for TS/Python/Go/Java is acceptable
but worth documenting. `find_child_by_field` / `find_child_by_kind`
(`src/lib.rs:135-142`) are small, well-named helpers with a single use site
each — appropriate granularity.

## Step 6 Dead code and hygiene

- **Unused dependency:** `thiserror` is declared in `crates/ax-code-parser/Cargo.toml:16`
  but never appears anywhere in `src/lib.rs` (the crate returns plain
  `Result<_, String>` at `src/lib.rs:518, 523, 527`). It is dead weight on the
  build graph and should be removed or actually wired into an error enum.
- **Ignored public parameter:** `parse_batch(files_json, _concurrency: u32)`
  (`src/lib.rs:560`) takes a `concurrency` argument that is silently dropped —
  rayon's global pool decides parallelism. The `_` prefix hides a genuinely
  misleading NAPI surface: JS callers believe they are controlling concurrency.
  Either thread it into a custom rayon pool or drop the parameter (semver
  permitting).
- No empty `catch`/`unwrap`-on-user-data hygiene issues; the only `.unwrap()`
  calls live under `#[cfg(test)]` (`src/lib.rs:635` … `:899`).

## Step 7 Tests

Eight unit tests live inline in `src/lib.rs:608-900`. Coverage of happy paths is
decent — one fixture each for TypeScript (`:612`), Python (`:665`), Go (`:714`),
Rust (`:759`), Java (`:820`), plus `test_unsupported_language` (`:862`),
`test_has_grammar` (`:869`), `test_qualified_names` (`:879`), and
`test_visibility_detection` (`:889`).

Material gaps relative to the defects in Step 3:

- No test exercises `parse_batch` (the primary NAPI entry at `src/lib.rs:560`),
  so the rayon `map_init` path and the per-file `error` field have no coverage.
- No test asserts `kind == "constant"` for a TS `const`, so the
  `find_child_by_kind(node, "const")` bug (`src/lib.rs:204`) is invisible.
- No test parses an `export_statement` and asserts the _child_ list, so the
  duplication in Step 3.1 is invisible.
- No test parses a Rust `impl` block, so the Step 3.3 collision is invisible.
- `supported_languages()` return value (`src/lib.rs:588-599`) is never asserted.

The MODULE-AUDIT line listing `packages/ax-code/test/provider/cli/parser.test.ts`
as this crate's test is a mislabel — that file tests the CLI provider parser,
not the `ax-code-parser` Rust crate.

## Step 8 Findings register

Accepted findings from this pass (none previously in `findings/`, which is
empty):

| #   | Finding                                                                | Category           | Severity | Evidence                                   |
| --- | ---------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------ |
| F1  | `export_statement` emits duplicate symbol+child                        | correctness        | MEDIUM   | `src/lib.rs:212-216` + `:101`              |
| F2  | TS `const` always classified `"variable"` not `"constant"`             | correctness        | MEDIUM   | `src/lib.rs:200-211` (esp. `:204`)         |
| F3  | Rust `impl_item` fabricated as kind `"module"` colliding with the type | correctness/design | MEDIUM   | `src/lib.rs:343-350`                       |
| F4  | `thiserror` dependency declared but unused                             | hygiene            | LOW      | `Cargo.toml:16` (absent from `src/lib.rs`) |
| F5  | `parse_batch` `_concurrency` parameter silently ignored                | api-hygiene        | LOW      | `src/lib.rs:560`                           |

No High/Critical findings. The `findings/` directory currently contains zero
files; this register is the authoritative list for `crate-parser` from this
review lane.

## Step 9 Verification and exit

How a verifier can reproduce this review:

- Build the native addon: `pnpm build:native:debug` (or `cargo build -p
ax-code-parser`), which exercises both `build.rs` (`napi_build::setup()`) and
  the `cdylib` compile.
- Run the in-crate tests: `cargo test -p ax-code-parser` — exercises the eight
  tests at `src/lib.rs:612-900`.
- Re-read the three Step-3 sites (`src/lib.rs:204`, `:212-216`, `:343-350`) and
  the two Step-6 sites (`Cargo.toml:16`, `src/lib.rs:560`) to confirm or refute
  F1–F5.

Because the `findings/` directory has no Critical-severity items, no
`reverify.md` cross-lane file is required by the protocol for this unit. Exit
status: REVIEWED by ax-code-glm; pending independent confirmation by the
codex-sol verifier lane for the five findings above.
