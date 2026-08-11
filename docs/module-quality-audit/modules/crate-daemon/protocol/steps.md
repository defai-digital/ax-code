# Review Protocol: crate-daemon

Reviewer: codex-sol  
Independent verifier: ax-code-glm  
Date: 2026-08-11

## Step 1 Scope and interface map

The `crate-daemon` unit is the Unix N-API implementation selected and re-exported by `crates/ax-code-daemon/src/lib.rs:4-8`; non-Unix builds expose the same four functions as explicit unsupported-platform errors at `crates/ax-code-daemon/src/lib.rs:10-40`. The user-visible native surface is `daemon_start`, `daemon_stop`, `daemon_status`, and `daemon_send` at `crates/ax-code-daemon/src/daemon.rs:222-334`. `crates/ax-code-daemon/build.rs:1-5` initializes N-API build metadata, while `packages/ax-code-daemon/package.json:19-25` packages the generated JavaScript and declaration files. Runtime flow is N-API call -> Unix socket client -> JSON command dispatch -> in-memory `DaemonState` -> newline-delimited JSON response; repository search found no production TypeScript caller, only packaging metadata and one source-level regression assertion.

## Step 2 Trust and failure boundaries

The daemon crosses native FFI, filesystem, local IPC, and thread boundaries. Its socket name is a 16-hex-character prefix of a SHA-256 over the caller-supplied project string and is placed below `$HOME/.local/share/ax-code/daemon` at `crates/ax-code-daemon/src/daemon.rs:113-123`; startup creates the parent and binds the socket at `daemon.rs:225-247` without setting explicit directory or socket permissions. Any process able to reach a discovered socket can request cached path names, rescan, or stop the service. `handle_client` applies five-second socket timeouts at `daemon.rs:198-203`, but `BufRead::read_line` at `daemon.rs:125-135` has no input-size cap, leaving memory use dependent on a local client's line length. These are candidate local security/availability concerns, not Critical items in the existing ledger.

## Step 3 State and correctness paths

Startup scans before accepting work, including poisoned-mutex recovery (`crates/ax-code-daemon/src/daemon.rs:187-196`), and dispatch similarly recovers the state rather than panicking across FFI (`daemon.rs:163-184`). Stop sets the shared atomic false, replies, exits the nonblocking accept loop, and removes the socket (`daemon.rs:179-181,198-217`); the caller polls up to one second and then performs best-effort cleanup (`daemon.rs:268-289`). Invalid JSON and unknown commands are returned as escaped error JSON (`daemon.rs:128-160,183`). Two contract gaps remain: directory-walk errors are silently discarded by `.flatten()` at `daemon.rs:69-81`, so a successful scan can be incomplete, and the textual `reindex` command serializes a `path` at `daemon.rs:319-324` although dispatch treats it as an ordinary full `scan` and never reads `Command.path`.

## Step 4 Workload and resource behavior

Each scan recursively walks the project, allocates every UTF-8 relative path, then replaces the entire cached vector (`crates/ax-code-daemon/src/daemon.rs:60-89`). The mutex is held throughout dispatch and therefore throughout the walk (`daemon.rs:163-172`), while the single accept loop handles clients serially (`daemon.rs:198-209`), so a large rescan delays status, glob, and stop requests. Every glob command recompiles its matcher and clones every match into a response (`daemon.rs:92-102`); neither result count nor JSON response size is bounded. This pass did not manufacture a performance severity without workload measurements, but the unbounded scan/glob behavior and serialized stop latency should be benchmarked on a large repository before the daemon becomes a default production path.

## Step 5 Cohesion and ownership

Platform selection is cleanly owned by `crates/ax-code-daemon/src/lib.rs:4-40`, and the minimal `crates/ax-code-daemon/build.rs:1-5` contains only N-API setup. The 365-line Unix module, however, combines socket naming, protocol parsing, scanning policy, lifecycle, and all FFI adapters. More importantly, `DaemonState::new` stores `db_path` but the field is suppressed as dead code and never consulted (`crates/ax-code-daemon/src/daemon.rs:40-57`), while the package promises a “persistent file tree and real-time indexing” at `packages/ax-code-daemon/package.json:2-4`. The implementation is an in-memory snapshot refreshed only at startup or by explicit scan (`daemon.rs:60-89,169-178`), so persistence and real-time indexing currently belong to the advertised contract but not this crate's behavior.

## Step 6 Dead paths and maintenance hygiene

The clearest dormant surfaces are `db_path` (`crates/ax-code-daemon/src/daemon.rs:42-54`) and `Command.path` (`daemon.rs:13-20,319-324`): both enter the API/data model but have no behavioral consumer. `thiserror` is declared at `crates/ax-code-daemon/Cargo.toml:11-19` yet is unused by the crate. Serialization in the textual command adapter uses `unwrap_or_default()` at `daemon.rs:307-330`; the represented structures are presently infallible to serialize, but an empty command would be a silent failure if fields later gain fallible custom serialization. Response-body, terminator, and flush failures are deliberately logged at `daemon.rs:136-147`, and the source-pin regression at `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts:114-123` prevents those errors from returning to silent `let _` handling.

## Step 7 Test coverage and gaps

`docs/module-quality-audit/modules/crate-daemon/MODULE-AUDIT.md:33-34` lists no auto-matched tests. `cargo test -p ax-code-daemon` passed on 2026-08-11 but ran zero unit tests and zero doctests. The only discovered repository guard reads Rust source text and checks that response write/flush failures remain visible (`packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts:114-123`); the containing Vitest file passed all 13 tests. No behavioral test starts a socket, checks startup/stop cleanup, sends malformed or oversized frames, observes a walk permission error, compares equivalent project paths, or exercises concurrent scan/status/stop. Non-Unix stubs at `crates/ax-code-daemon/src/lib.rs:10-40` likewise have no target-specific compile or contract test in this unit.

## Step 8 Candidate fixes and ledger reconciliation

The register records `_none accepted_` at `docs/module-quality-audit/modules/crate-daemon/MODULE-AUDIT.md:48-52`, and `docs/module-quality-audit/modules/crate-daemon/findings/` contains no files. This review preserves that register while identifying evidence-backed candidates for triage: Medium security/availability for explicit `0700` directory plus `0600` socket permissions and a bounded request frame (`crates/ax-code-daemon/src/daemon.rs:125-135,228-244`); Medium silent-error/correctness for reporting walk failures rather than flattening them (`daemon.rs:69-81`); and Low design/dead-code for either implementing or removing `db_path`, path-scoped reindexing, and the real-time/persistence claim (`daemon.rs:40-57,319-324`; `packages/ax-code-daemon/package.json:2-4`). Native-runtime ownership should triage Medium candidates in the current wave and cover accepted fixes with negative IPC and filesystem-error tests. No Critical item exists, so no `reverify.md` is required.

## Step 9 Verification and exit state

On 2026-08-11, `cargo test -p ax-code-daemon` completed successfully with 0 tests, `cargo clippy -p ax-code-daemon --all-targets -- -D warnings` completed cleanly, and `AX_TEST_FILES=test/bug-reports/lifecycle-visibility.test.ts pnpm exec vitest run` passed 1 file and 13 tests. I re-read the lifecycle cleanup at `crates/ax-code-daemon/src/daemon.rs:187-217,268-289` after those checks and confirmed that this documentation pass did not alter source. The nine review stages for `crate-daemon` are recorded, but the empty behavioral suite and Step 8 candidates remain explicit follow-up work rather than being misrepresented as verified fixes. Independent Critical verification is inapplicable because neither the findings directory nor this pass contains a Critical finding.
