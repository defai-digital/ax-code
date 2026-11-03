# AX Code diff Wasm

An explicit Node/browser worker API for diff previews, structured hunk
application, patch chunks and duplicate comparison. Native AX Code and Wasm
share the bounded Rust preview, patch and duplicate kernels. The production
CLI retains its native backend. This private workspace package is an opt-in
integration surface; it is not published to a registry or bundled in CLI
installers.

## Build and validate

From the repository root:

```sh
rustup target add wasm32-unknown-unknown --toolchain stable
cargo install wasm-bindgen-cli --version 0.2.129 --locked
pnpm install
pnpm build:native diff
pnpm --dir packages/ax-code-diff-wasm build
pnpm --dir packages/ax-code-diff-wasm typecheck
pnpm --dir packages/ax-code-diff-wasm test
pnpm --dir packages/ax-code-diff-wasm test:browser
```

The build requires the CLI version matching the Rust binding dependency and
uses rustup's compiler and target libraries even when Homebrew Rust precedes
it on PATH. `AX_WASM_BINDGEN` may point to the CLI; `AX_DIFF_WASM_TOOLCHAIN`
selects a rustup toolchain with the Wasm target installed. Generated `dist/`
and `wasm/` artifacts are ignored; deploy both directories with `NOTICE`.
Tests require real artifacts and the rebuilt native addon. Browser tests use
Playwright Chromium or `AX_DIFF_WASM_CHROMIUM` (on macOS, installed Google
Chrome is also detected). Set `AX_DIFF_WASM_BROWSER=firefox` or `webkit`
to select another engine. Install them with `pnpm --dir packages/ax-code-diff-wasm
exec playwright-core install firefox webkit`. CI tests all three browser engines.

## Usage

```ts
import { createDiffEngine } from "@ax-code/diff-wasm/node"
// Browser ESM: import from @ax-code/diff-wasm, deploying dist/ and wasm/ together.

const engine = createDiffEngine()
try {
  const before = "hello\r\n"
  const after = "你好😀"
  const preview = await engine.diff(before, after)
  // { version: 1, additions, deletions, hunks }
  const result = await engine.applyHunks(before, preview.hunks)
  // result === after, including the absent final newline.
  const groups = await engine.compare([["a"], ["a", "b"], ["b"]], 0.5)
  // Greedy representative groups, not transitive connected components.
} finally {
  await engine.close()
}
```

`diff` returns one-based structured hunk coordinates, including empty ranges,
with four context lines. `applyHunks` requires those exact coordinates, counts
and source context. It preserves CRLF, Unicode and missing final newlines;
stale, overlapping or malformed hunks reject atomically. It does not parse
unified diff files or search fuzzily. Applying a selected subset requires
rebasing its `newStart` coordinates. `diff(..., { normalize: true })` produces
LF-normalized hunks while preserving the native API's raw addition/deletion
counts; apply those hunks to an explicitly LF-normalized source.

`applyPatch(file, original, chunks)` is a separate API matching the existing
native patch worker, including whitespace matching, smart punctuation
normalization and final-LF behavior. Chunks contain `old_lines`, `new_lines`,
optional `change_context` and `is_end_of_file`. It returns computed text only.
Neither API reads or writes project files. The host retains file snapshots,
permissions, stale-file checks and all Git/staging operations.

All methods accept `{ signal, timeoutMs }`. Each engine admits one in-flight
call and rejects concurrent calls without queueing. It lazily reuses a worker.
Abort/deadline terminates that worker; later calls recreate it after successful
termination. Request IDs and worker identity exclude stale responses. A failed
or stuck termination blocks reuse; caller rejection is bounded by a one-second
teardown grace and retains the original reason. `close()` reports termination
failure and may be retried. Always close idle engines. The default operation
deadline is 30 seconds (1–120,000 ms), including synchronous bounded admission;
admission cannot be interrupted mid-encoding. There is no native or JS fallback
inside this API. `createDuplicateComparator` is an alias for `createDiffEngine`.

Each text or serialized payload is limited to 16 MiB. Rust also caps combined
input, output, lines and algorithmic work. Hunk application accepts at most
4,096 hunks and 200,000 source/output lines. Duplicate inputs allow 10,000 rows,
200,000 tokens and 16 MiB JSON, with output capped at 1 MiB. Strings must be
well-formed Unicode and thresholds finite. Inputs outside these bounds reject;
no partial output is returned.

Wasm executes synchronously inside a dedicated worker. Cancellation terminates
that worker rather than sending it an unread cancellation message. The kernel
requires no shared memory, WASI, filesystem, network or process imports. The
host loads its own assets. Browser hosting requires module workers, Wasm
compilation permission in CSP and the `application/wasm` MIME type. COOP/COEP
is unnecessary. AX Wiki export CSP is unchanged. The adapted jsdiff code's
BSD-3-Clause notice is included in `NOTICE`.
