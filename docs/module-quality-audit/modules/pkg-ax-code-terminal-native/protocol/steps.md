# 9-Step Review — pkg-ax-code-terminal-native

Reviewer: ax-code-glm (model zai-coding-plan/glm-5.2[1m])
Independent verifier (other lane): codex-sol
Date: 2026-08-11
Baseline commit: 994f9287e497666e104644eccea299595a35b39a

The unit slug `pkg-ax-code-terminal-native` is the publishable N-API package
`@ax-code/terminal`, but its implementation lives entirely in the backing Rust
crate. The two artifacts that compose this unit are:

- `packages/ax-code-terminal-native/package.json` (30 lines) — the napi wrapper
- `crates/ax-code-terminal/src/lib.rs` (937 lines, 24 inline tests) — the source

## Step 1 Scope and map

`packages/ax-code-terminal-native/package.json:23-24` wires `napi build` at
`../../crates/ax-code-terminal/Cargo.toml`, emitting `index.js` + `index.d.ts`
into the package dir. The crate is `cdylib` + `rlib`
(`crates/ax-code-terminal/Cargo.toml:9`) with deps napi / napi-derive / serde /
serde_json / thiserror (`Cargo.toml:11-16`); `build.rs` is the stock
`napi_build::setup()` (5 lines). The JS-public surface is exactly four `#[napi]`
fns in `crates/ax-code-terminal/src/lib.rs`: `parse_input_json` (line 588),
`parse_ansi_json` (line 594), `wrapped_buffer_json` (line 600),
`diff_buffers_json` (line 609). `script/build-native.ts:38-43` confirms the
`dir: "ax-code-terminal-native"` / `binaryName: "ax-code-terminal"` pairing, and
`script/build-native.ts:71-80` documents that the driver writes the CJS `index.js`
shim because napi v3 `--output-dir .` skips it. No TS file in `packages/**`
imports `@ax-code/terminal` yet — a repo-wide grep found only the unrelated
performance-criterion id `visualization.terminal-native`
(`packages/ax-code/src/cli/cmd/tui/performance-criteria.ts:105`), so the napi
surface is currently unused in-tree.

## Step 2 Threat and failure model

The crate handles untrusted terminal byte streams over a native FFI boundary.
There is **no `unsafe`** anywhere in `crates/ax-code-terminal/src/lib.rs`; all
parsing slices a borrowed `&str` and indexes via `as_bytes().get(...)` /
`char::len_utf8()` with bounds checks (e.g. `lib.rs:199`, `lib.rs:246`,
`lib.rs:158`). There are no `std::env`, `std::fs`, `std::net`, or
`std::process` calls — the only side effect is allocation. External input is the
`String`/JSON args to the four napi fns, deserialized with `serde_json` and
mapped to `napi::Error` via `map_err` (`lib.rs:589-590`, `lib.rs:605`,
`lib.rs:611`, `lib.rs:613`). Memory is bounded: `Viewport::new` clamps
`cols`/`rows` to `1..=MAX_VIEWPORT_COLS/ROWS` = `1..=1000`
(`lib.rs:7-8`, `lib.rs:32-34`), so the largest `CellBuffer` is 1e6 cells. No
secrets, credentials, or PII flow through this code. The realistic failure mode
is a malformed escape sequence producing a wrong-but-memory-safe typed enum, not
memory unsafety or command injection.

## Step 3 Correctness

Each parser branch was traced against the xterm spec.

- Bracketed paste (`lib.rs:119-127`): correct when terminated — the test at
  `lib.rs:623-634` proves a multi-line, multi-byte (`\u{4e16}\u{754c}`) payload
  survives intact. Gap: an unterminated `\x1b[200~` (no `\x1b[201~`) makes the
  inner `if let` miss, `parse_csi_key` returns `None` for `params=[200]`
  (`lib.rs:214-219`), and the stream degrades to an `Escape` key plus literal
  `[200~` text. Low-severity robustness edge.
- CSI `~` keys (`lib.rs:214-219`): handles codes `1|7 => home`, `3 => delete`,
  `4|8 => end`. Missing `2` (Insert), `5` (PageUp), `6` (PageDown). `\x1b[5~`
  returns `None` and falls through to `Escape` + literal text — a genuine
  coverage gap for common keys. **Medium.**
- CSI letter finals (`lib.rs:198`, `207-213`): the final-byte search set is
  `['A','B','C','D','F','H','~']`, which omits `'Z'`. `\x1b[Z` (shift+Tab) and
  `\x1b[E` (center / KP5) hit the same fallthrough. **Low-Medium.**
- SGR mouse (`lib.rs:244-281`): `end = input.find(['M','m'])` then
  `consumed = end + 1`. For `\x1b[<0;10;5M` that is byte index 8 → consumed 9 =
  the full 9-byte sequence; the test at `lib.rs:642-678` validates
  Down/Up/Move/WheelUp. The body is strictly `code;x;y` numerics, so a stray
  `M`/`m` inside the params is impossible. Correct.
- SS3 finals (`lib.rs:144-161`): the comment at `lib.rs:156-158` and
  `idx += 2 + ch.len_utf8()` fix the prior phantom-text bug (`O` + final leaking
  as text). Tests at `lib.rs:884-921` cover unknown ASCII finals and multi-byte
  finals (`é`, `中`) that would have panicked under the old fixed `idx += 3`.
  Correct.
- Repeat-count vs modifier (`lib.rs:223-227`): `params[0]` is the repeat count,
  `params[1]` is the modifier; `\x1b[5A` is not Ctrl+Up per the test at
  `lib.rs:786-798`. Correct.
- ANSI non-SGR skip (`lib.rs:311-334`): `body.bytes().position(|b| (0x40..=0x7E).contains(&b))`
  finds the first CSI final byte, so `\x1b[2J`, `\x1b[H`, `\x1b[?25h`,
  `\x1b[1;1H` no longer swallow following text — tests at `lib.rs:801-848`.
  Correct.

## Step 4 Performance

`parse_input` (`lib.rs:113-181`) and `parse_ansi` (`lib.rs:298-347`) are
single-pass O(n) with no backtracking. Allocation hotspots are visible:
`key()` does `name.to_string()` per key event (`lib.rs:183-190`), `apply_sgr`
does `format!()` per emitted color (`lib.rs:376-380`, `lib.rs:390-391`), and
`parse_ansi` clones `Style` on every `TextRun` flush (`lib.rs:317-322`). For
keystroke-rate input this is negligible; for multi-MB PTY bursts the dominant
cost is per-`Cell` `String` ownership inside `CellBuffer` (up to 1e6 owned
`String`s at the 1000x1000 clamp). `diff_buffers` (`lib.rs:550-585`) clones
every changed `Cell`, bounded by viewport size — acceptable. The napi boundary
serializes results to a JSON `String` (`lib.rs:589`, `lib.rs:595`, `lib.rs:605`,
`lib.rs:614`) which the JS caller must `JSON.parse` again — a double
encode/decode per call; this matches the sibling native crates' convention but
is the real per-call tax.

## Step 5 Design

Cohesion is strong: five concerns (terminal lifecycle, input parsing, ANSI
parsing, cell buffers, diffing) occupy clearly separated sections of one file.
The data model is value-oriented — `Viewport`, `Style`, `TextRun`, `Cell`,
`CellBuffer`, `CellPatch` are all `Clone` with no interior mutability
(`lib.rs:22-43`, `283-432`) — appropriate for a stateless parse/diff library.
The error model is consistent: `TerminalError` + `Result` for the stateful
`TerminalLifecycle` state machine (`lib.rs:10-77`) and `napi::Result` for the
FFI fns with serde errors mapped via `map_err`. The `#[napi]` fns are thin
serde wrappers around pure functions (`lib.rs:588-616`), which is good for
testability — the `#[cfg(test)]` block exercises the pure fns, not the FFI
layer, a clean separation — but it leaves the FFI + JSON-string return contract
itself untested and undocumented in source (only discoverable from the generated
`index.d.ts`).

## Step 6 Dead code and hygiene

No dead exports: all four `#[napi]` fns route through `package.json` `main`
(`package.json:5-6`) and the shim written by `script/build-native.ts:75-80`.
No `TODO`/`FIXME`/`panic!`/`unwrap` in production paths (the two
`unwrap_or(u16::MAX)` at `lib.rs:601-602` are intentional saturating casts, and
`unwrap_or(&blank)` at `lib.rs:568`, `lib.rs:572` is bounds-safe fallback).
`MAX_VIEWPORT_COLS`/`MAX_VIEWPORT_ROWS` (`lib.rs:7-8`) are live — used by the
clamp at `lib.rs:32-34` and asserted at `lib.rs:765-773`. The re-clamp inside
`diff_buffers` (`lib.rs:551-552`) is defensive but redundant given `blank()`
already clamps; harmless. `index.d.ts` is generated, not source — out of scope.
Rust has no `catch` blocks; the audit's "0 empty catches" tally is accurate.

## Step 7 Tests

The `#[cfg(test)] mod tests` at `lib.rs:618-936` is genuinely strong: 24
deterministic, I/O-free, assertion-on-value tests covering bracketed paste
(`lib.rs:622-634`), ctrl-d shutdown (`lib.rs:636-639`), SGR mouse + CSI keys
(`lib.rs:641-678`), basic/extended/bright ANSI colors (`lib.rs:680-711`), wide
CJK incl. supplementary planes U+20000/U+2A6DF/U+2A700/U+2EBEF
(`lib.rs:713-732`, `lib.rs:923-936`), combining marks (`lib.rs:726-732`),
diff incl. resize (`lib.rs:734-743`, `lib.rs:775-783`), the lifecycle state
machine (`lib.rs:744-757`), viewport clamping (`lib.rs:759-773`), repeat-count
vs modifier (`lib.rs:785-799`), non-SGR / cursor / mode CSI skip
(`lib.rs:801-848`), incomplete CSI (`lib.rs:821-828`), and the SS3 phantom-text
regressions (`lib.rs:859-921`). Several tests carry explanatory comments
referencing the exact prior bug (e.g. `lib.rs:886-887`, `lib.rs:911-912`) — a
healthy regression-capture discipline. Gap: the missing keys flagged in Step 3
(Insert/PageUp/PageDown/shift+Tab) have no negative test pinning the current
(mis-)behavior, so a future fix has nothing to flip. The `#[napi]` FFI layer and
the build shim are uncovered; only the pure Rust is tested.

## Step 8 Finding register

Independent review found **no Critical items**. Accepted findings filed by this
lane (ax-code-glm):

- [MEDIUM] CSI `~` codes 2/5/6 (Insert/PageUp/PageDown) not handled; drop to
  Escape + literal text. `crates/ax-code-terminal/src/lib.rs:214-219`.
- [LOW-MEDIUM] CSI final `Z` (shift+Tab) and `E` absent from the search set;
  same fallthrough path. `crates/ax-code-terminal/src/lib.rs:198`.
- [LOW] Unterminated bracketed-paste start (`\x1b[200~` without `\x1b[201~`)
  degrades to Escape + literal `[200~`. `crates/ax-code-terminal/src/lib.rs:119-127`.
- [LOW] The `#[napi]` FFI layer is untested and its JSON-string return contract
  is undocumented in source; consumers pay serde + JSON.parse per call.
  `crates/ax-code-terminal/src/lib.rs:588-616`.
- [LOW] Per-key `to_string()` / `format!()` allocation in hot parse loops.
  `crates/ax-code-terminal/src/lib.rs:183-190`, `376-380`.

The `findings/` directory is empty — no prior items to reconcile, no
disposition conflicts. Because no Critical finding exists, the
`protocol/reverify.md` gating artifact is not required for this unit.

## Step 9 Verification and exit

Native Rust crates are exercised by cargo, not pnpm. The gates that validate
this unit are:

- `cargo test -p ax-code-terminal --manifest-path crates/ax-code-terminal/Cargo.toml`
  — runs the 24 inline unit tests at `lib.rs:618-936`.
- `cargo clippy -p ax-code-terminal -- -D warnings` — lint the crate.
- `pnpm build:native` (= `tsx script/build-native.ts`) — asserts the `.node`
  artifact emits and writes the `index.js` shim
  (`script/build-native.ts:76-80`).

Read-path verification performed this run: `packages/ax-code-terminal-native/package.json`,
`crates/ax-code-terminal/Cargo.toml`, `crates/ax-code-terminal/build.rs`,
`crates/ax-code-terminal/src/lib.rs`, and `script/build-native.ts` were all read
in full; the napi surface is confirmed at `lib.rs:588/594/600/609` and the
build wiring at `script/build-native.ts:38-43`. Exit checklist: full 9-step
protocol performed by reviewer=ax-code-glm; findings ledger consistent with
the empty `findings/` directory; no Critical findings so the
independent-verifier (codex-sol) reverify pass is non-blocking but recommended
to confirm the Medium CSI-`~` gap before sign-off.
