# Nine-step review protocol: pkg-ax-code-daemon

## Step 1 Scope and implementation map

The nominal unit root is `packages/ax-code-daemon`, as recorded in `docs/module-quality-audit/modules/pkg-ax-code-daemon/MODULE-AUDIT.md:5-7`, but that directory contains only the publication manifest. Its `package.json:2-6` points consumers at generated `index.js` and `index.d.ts`, while `package.json:24-25` sends both builds to `crates/ax-code-daemon/Cargo.toml`. The substantive implementation is therefore `crates/ax-code-daemon/src/daemon.rs:13-364`, exported through the Unix gate in `crates/ax-code-daemon/src/lib.rs:4-8`; the audit stub's `MODULE-AUDIT.md:17-26` zero-file inventory does not describe the effective module boundary.

## Step 2 Trust boundaries and abuse cases

The daemon exposes newline-delimited JSON over a Unix socket. `crates/ax-code-daemon/src/daemon.rs:113-123` derives the socket location from `HOME` and a truncated hash of the caller-supplied project string, and `daemon.rs:125-147` reads and deserializes one client-controlled line before returning one response. There is no explicit request-size limit or socket permission hardening in `daemon.rs:225-247`; access relies on surrounding directory and process umask. Commands can initiate a full project scan or stop the daemon through `daemon.rs:169-184`, so local socket access is the meaningful security boundary. No credential or secret persistence path was found.

## Step 3 Functional correctness

The main status, scan, glob, and stop paths are internally consistent: `crates/ax-code-daemon/src/daemon.rs:60-90` refreshes the in-memory path list, `daemon.rs:92-102` compiles glob patterns with surfaced errors, and `daemon.rs:163-185` serializes all dispatch outcomes. Mutex poisoning is recovered rather than propagated across N-API at `daemon.rs:164-168`. One contract discrepancy remains: the state stores `db_path` but never reads it (`daemon.rs:40-56`), and textual `reindex <path>` constructs a `path` field at `daemon.rs:319-324` that dispatch ignores at `daemon.rs:169-184`, resulting in a full scan rather than path-specific reindexing.

## Step 4 Lifecycle, concurrency, and failure recovery

Startup checks a pre-existing socket, removes a stale one, binds nonblocking, and names a detached worker thread in `crates/ax-code-daemon/src/daemon.rs:233-263`. The accept loop is deliberately single-client and serial (`daemon.rs:198-209`); client read/write timeouts limit stalled connections, although timeout-configuration errors are discarded at `daemon.rs:201-202`. Stop changes the shared atomic, polls up to one second for listener cleanup, then performs best-effort removal (`daemon.rs:268-289`). Response body, terminator, and flush failures are visible at `daemon.rs:136-147`, while socket cleanup errors at `daemon.rs:212-217` remain intentionally non-fatal.

## Step 5 Resource and performance behavior

Each scan walks the project synchronously and allocates every relative file path into a replacement vector (`crates/ax-code-daemon/src/daemon.rs:60-89`). Every glob then clones each match after a linear pass over that vector (`daemon.rs:92-101`). Because dispatch acquires the state mutex before invoking either operation (`daemon.rs:163-175`), a large scan blocks status and stop handling, and the serial accept loop at `daemon.rs:198-204` prevents other clients from progressing. This is bounded by project size rather than a leak, but it conflicts with the low-latency expectations of a persistent background service.

## Step 6 API and packaging design

The four exported N-API functions are clear on Unix (`crates/ax-code-daemon/src/daemon.rs:220-334`) and preserve the same signatures as explicit unsupported-platform stubs (`crates/ax-code-daemon/src/lib.rs:10-40`). Packaging is less coherent: `packages/ax-code-daemon/package.json:4` advertises persistent file-tree and real-time indexing, while the implementation is an in-memory snapshot with an unused database path. In addition, the root native build registry lists five addons but not the daemon at `script/build-native.ts:33-44`, even though the root command delegates exclusively to that registry at `script/build-native.ts:87-104`. The package can be built directly, but `pnpm build:native` does not build it.

## Step 7 Maintainability and code hygiene

The crate is compact, avoids unsafe code, and `cargo clippy -p ax-code-daemon --all-targets -- -D warnings` completed cleanly. Error responses are escaped with Serde in `crates/ax-code-daemon/src/daemon.rs:151-160`, and poisoned mutex recovery is documented at `daemon.rs:163-168` and `daemon.rs:187-196`. The clearest unfinished residue is `db_path`, explicitly suppressed as dead code at `daemon.rs:40-54`; the `path` command member at `daemon.rs:13-20` likewise exists only to carry ignored reindex input. These should either acquire concrete indexing semantics or be removed from the public construction path.

## Step 8 Tests and issue disposition

The ledger currently says no accepted finding at `docs/module-quality-audit/modules/pkg-ax-code-daemon/MODULE-AUDIT.md:60-64`, and the unit's `findings/` directory contains no finding files, hence no Critical item requires a secondary `reverify.md`. The only located regression coverage reads the Rust source and asserts write failures are logged in `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts:114-123`; it does not start the addon or exercise the socket protocol. `cargo test -p ax-code-daemon` reported zero unit tests and zero doc tests, leaving scan filtering, command parsing, stale-socket recovery, stop timing, and malformed/oversized requests without behavioral coverage.

## Step 9 Verification and exit assessment

The implementation compiles and lints under the workspace crate configuration declared at `crates/ax-code-daemon/Cargo.toml:1-22`: `cargo test -p ax-code-daemon` passed with 0 tests, and `cargo clippy -p ax-code-daemon --all-targets -- -D warnings` passed. The targeted repository regression `AX_TEST_FILES=test/bug-reports/lifecycle-visibility.test.ts pnpm exec vitest run` passed 13/13, anchored by the daemon assertions at `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts:114-123`. Review exit is acceptable as an evidence audit with no Critical ledger entries, but runtime confidence remains limited until IPC tests and root-build integration cover the gaps identified above.
