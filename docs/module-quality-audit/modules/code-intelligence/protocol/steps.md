# Review Protocol Steps: code-intelligence

- Unit slug: `code-intelligence`
- Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
- Independent verifier: codex-sol
- Baseline commit: `5fefa00cdc847667d3ba3d38509a751498ee4180`
- Scope root: `packages/ax-code/src/code-intelligence`

These steps are the primary reviewer's own pass over the twelve source
files listed in MODULE-AUDIT.md §1. Every claim below is anchored to a
file path and line range that was read in full during this run.

## Step 1 Scope and inventory confirmation

The unit is a self-contained graph indexing subsystem. The public
surface is the `CodeIntelligence` namespace re-exported from
`packages/ax-code/src/code-intelligence/index.ts:23`; everything else is
internal plumbing reached through it or through the builder/watcher.

Layering is clean and intentional:

- `schema.sql.ts` is the only file that declares Drizzle tables
  (`CodeNodeTable` at `schema.sql.ts:22`, `CodeEdgeTable` at
  `schema.sql.ts:69`, `CodeFileTable` at `schema.sql.ts:101`).
- `query.ts:42` (`CodeGraphQuery`) is the only layer that touches those
  tables directly, and it is the single dispatch point for the native
  fast-path (`useNative` at `query.ts:34`).
- `builder-impl.ts:460` (`CodeGraphBuilder`) owns write orchestration;
  `builder.ts` is a pure re-export shim (`builder.ts:1`).
- `index.ts:23` is the agent-facing facade; `graph-context.ts:529`
  composes the higher-level context pack on top of it.

`id.ts:8-17` defines four branded identifiers (`CodeNodeID`,
`CodeEdgeID`, `CodeFileID`, `LspCacheID`) via `defineBrandedIdentifier`,
which keeps entity kinds distinguishable at the type level. No layer
violations were observed: the facade never imports Drizzle symbols
directly, and `graph-context.ts` consumes only the `CodeIntelligence`
namespace plus `CodeNodeID`.

The MODULE-AUDIT.md inventory lists 12 files / 4974 LOC; the line counts
I read match (e.g. `builder-impl.ts` ends at line 1324, `query.ts` at
761, `auto-index.ts` at 477). Inventory is accepted as accurate.

## Step 2 Failure-mode and boundary review

Persistence boundaries are the dominant risk surface and they are
handled defensively:

- Cross-process writes are serialized by `IndexLock` in `lockfile.ts`.
  `tryAcquire` (`lockfile.ts:140`) uses `fs.open(target, "wx")` for an
  atomic create-or-fail, and `maybeSteal` (`lockfile.ts:96`) steals only
  when the holder PID is dead (`process.kill(pid, 0)` probe at
  `lockfile.ts:120`, with EPERM correctly treated as alive at
  `lockfile.ts:124`) or the lock is older than `STALE_LOCK_MS` (8h,
  `lockfile.ts:51`). The native path (`lockfile.ts:142`) prefers kernel
  `flock()` which auto-releases on crash — strictly safer.
- SQLite concurrency is addressed by the per-project `KeyedSerialQueue`
  at `builder-impl.ts:468`, documented at `builder-impl.ts:461-467` as
  preventing read-your-own-transaction skew on cross-file caller
  resolution.
- Fire-and-forget indexing in `auto-index.ts:359` wraps the entire body
  in try/catch and converts every failure (including `LockHeldError` at
  `auto-index.ts:450`) into a visible `setState` transition, so an
  auto-index failure can never crash the session that triggered it.
- The home-directory guard at `auto-index.ts:265` prevents the desktop
  `ax-code serve` (cwd = `$HOME`) from bulk-walking the user's disk, and
  `purgeHomeDirectoryGraphs` (`auto-index.ts:186`) cleans up the one
  observed legacy 2.57M-row graph.

No empty catches exist (MODULE-AUDIT.md reports 0 and I confirmed this
while reading). Catch sites either rethrow, log+swallow with an explicit
state transition, or return a typed fallback (e.g. `parseNativeStoreJson`
at `native-store.ts:84` returns the provided fallback on malformed JSON).

## Step 3 Correctness of write and query paths

The per-file write path in `commitPreparedIndex`
(`builder-impl.ts:919`) is transactional: `deleteEdgesTouchingFile` →
`deleteNodesInFile` → batched `insertNodes`/`insertEdges` → `upsertFile`
all run inside `Database.transaction` at `builder-impl.ts:1054`. This
matches the atomicity contract documented at `builder-impl.ts:1303-1307`.

The sha short-circuit at `builder-impl.ts:625` is correct and safe: it
only fires when the stored row is `completeness === "full"`, leaves all
existing rows untouched (no node-id recycling), and never persists the
transient `"unchanged"` value — consistent with the contract at
`builder-impl.ts:504-508`.

`resolveContainingNodeInMemory` (`builder-impl.ts:239`) and
`resolveContainingNodeFromRows` (`builder-impl.ts:286`) both use the
`SYMBOL_RANGE_SCALE = 10000` constant (`builder-impl.ts:26`) for the
innermost-container tiebreak, and the comment at `builder-impl.ts:23-26`
notes this MUST match the native interval tree in
`crates/ax-code-index/interval_tree.rs`. The JS and native paths will
therefore attribute the same edge to the same container.

One correctness gap was identified and is recorded in Step 8: `deleteFile`
at `query.ts:319` is the only CRUD operation in `CodeGraphQuery` that
omits the `if (useNative)` dispatch, and `NativeStore`
(`native-store.ts:53`) exposes no `deleteFile` counterpart. When the
native index is enabled, `purgeFile` (`builder-impl.ts:1308`) deletes
edges and nodes from the native store but leaves the file row behind.
This affects the watcher unlink path (`watcher.ts:115`).

## Step 4 Performance hotspots

Three concrete hotspots, in descending severity:

1. `commitPreparedIndex` calls `CodeGraphQuery.listFiles(projectID)` at
   `builder-impl.ts:1025` once per committed file in order to resolve
   import edges. `listFiles` (`query.ts:312`) materializes every
   `code_file` row for the project. A full 50k-file walk therefore pays
   50k × O(files) row materializations — quadratic in project size. The
   native path round-trips the full row set as JSON per call
   (`native-store.ts:185`). This is the single most expensive thing the
   builder does per file after the LSP RPCs.

2. `parseImportSpecifiers` (`builder-impl.ts:121`) is invoked on the
   full file text at `builder-impl.ts:915` with no size guard. For each
   regex match, `isIgnoredImportMatch` (`builder-impl.ts:70`) rescans
   from the start of the file up to the match index, so the combined
   cost is O(text × matches). The syntactic path caps source at
   `MAX_SOURCE_BYTES` (`syntactic.ts:34`) but the import parser does
   not, so a multi-megabyte generated bundle with many `import`-like
   strings degrades quadratically.

3. `loadLanguage` (`syntactic.ts:88`) runs `parser.parse(text)`
   synchronously on the event loop (`syntactic.ts:138`). It is bounded
   by `MAX_SOURCE_BYTES = 1_500_000` (`syntactic.ts:34`), which is
   acknowledged in the comment at `syntactic.ts:24-27`. Acceptable but
   worth noting: a 1.5 MB minified file still blocks the event loop for
   the full parse.

The good news: `countNodes`/`countEdges` (`query.ts:147`, `query.ts:255`)
use `SELECT count(*)` via `.get()` instead of materializing IDs (the old
behavior per the comment at `query.ts:149-151`), and `deleteEdgesTouchingFile`
(`query.ts:233`) uses a correlated subquery to avoid the IN-clause limit
(PERF-12). `ANALYZE` is run once per batch at `builder-impl.ts:1296` to
keep the SQLite planner honest.

## Step 5 Design, ownership and coupling

Ownership boundaries are explicit and respected. `CodeGraphQuery`
(`query.ts:42`) is documented at `query.ts:28-32` as the single place
that touches the code tables, and the builder and facade both go through
it. The native dispatch is centralized behind `useNative` (`query.ts:34`)
so callers do not branch on addon availability.

The `Scope` type (`index.ts:74`) cleanly separates policy from
mechanism: the query helpers are policy-neutral (`"none"` default) while
the agent-facing tool layer defaults to `"worktree"`. `inScope`
(`index.ts:76`) is the only enforcement point, which keeps the boundary
auditable. `graph-context.ts` adds a second, stricter check via
`canReadGraphFile` (`graph-context.ts:190`) which performs `realpath`
comparisons to defeat symlink escape — a defense the simpler
`Instance.containsPath` does not provide.

`graphEnvelope` (`index.ts:422`) is deliberately not a fallback router
(see the comment at `index.ts:399-403`); it only stamps provenance so
consumers can decide whether to cross-check via the live LSP tool. This
is a sound design choice that keeps the graph layer honest about its own
freshness.

The `CodeGraphBuilder` namespace at `builder-impl.ts:460` is large
(roughly 860 lines) and mixes the prepare/commit split with import
parsing, reference planning, and edge resolution. The prepare/commit
split itself (`prepareIndexFile` at `builder-impl.ts:560`,
`commitPreparedIndex` at `builder-impl.ts:919`) is a good extraction
boundary that keeps LSP I/O outside the DB transaction. Further
factoring of `commitPreparedIndex` (which is ~175 lines and handles
reference resolution, import ingestion, and the DB write) would improve
readability but is not urgent.

## Step 6 Hygiene, dead code and robustness

The module is notably clean. No empty catches. No TODO/FIXME markers in
the indexed files. Every magic constant I checked has a named home:
`SYMBOL_RANGE_SCALE` (`builder-impl.ts:26`), `MAX_REFERENCE_QUERIES_PER_FILE`
(`builder-impl.ts:359`), `MAX_BOOKMARKS_PER_REFERENCE_QUERY`
(`builder-impl.ts:27`), `DEBOUNCE_MS`/`BATCH_FLUSH_MS`/`MAX_QUEUE_DEPTH`
(`watcher.ts:16/30/37`), `MAX_STATE_ENTRIES` (`auto-index.ts:106`),
`STALE_LOCK_MS`/`POLL_INTERVAL_MS` (`lockfile.ts:51/55`).

Bounded-growth discipline is present: `stateByProject` evicts at
`MAX_STATE_ENTRIES = 64` (`auto-index.ts:138`); `linesByFile` in
`graph-context.ts:613` is bounded by the symbol cap; the syntactic
language cache is bounded by the grammar table size at
`syntactic.ts:94`. The watcher queue drops oldest at
`MAX_QUEUE_DEPTH = 256` (`watcher.ts:92`).

Two minor observations:

- `inFlight` and `triedProjects` in `auto-index.ts:166` and
  `auto-index.ts:174` are process-lifetime Sets with no cap. In a
  long-lived desktop `ax-code serve` that cycles through many projects
  they grow unboundedly. The comment at `auto-index.ts:165` acknowledges
  process-lifetime, so this is accepted debt, but a cap matching
  `MAX_STATE_ENTRIES` would be tidier.
- `CodeGraphWatcher.instances` (`watcher.ts:61`) is cleaned up via
  `Instance.onLifecycle` at `watcher.ts:63-66`, so it does not leak.
  Good.

## Step 7 Test coverage posture

No tests live under `packages/ax-code/test/code-intelligence/` were in
the read set for this run, so I cannot sign off on coverage from direct
evidence. What I can confirm from the source:

- Pure helpers are exported specifically so they can be tested without a
  running LSP server: `lookupCallerKind` (`builder-impl.ts:320`,
  comment at `builder-impl.ts:315-318`), `planReferenceQueriesForBookmarks`
  (`builder-impl.ts:442`), `parseImportSpecifiers` (`builder-impl.ts:121`),
  `resolveContainingNodeFromDb` (`builder-impl.ts:276`). These are the
  right extraction boundaries.
- Test-only escape hatches are namespaced with a `__` prefix and
  documented as test-only: `IndexLock.__reset` (`lockfile.ts:222`),
  `CodeGraphWatcher.__pendingCountForTests`/`__drainForTests`
  (`watcher.ts:218/224`), `CodeIntelligence.__clearProject`
  (`index.ts:388`). This keeps production call sites grep-able.
- `clearProject` (`query.ts:563`) deliberately clears BOTH the native
  store and the main DB (comment at `query.ts:564-567`) so tests get a
  clean slate regardless of which store was active.

Verification of actual test coverage is deferred to the codex-sol
independent lane, which can run the vitest groups from
`packages/ax-code/test/`.

## Step 8 Findings register

This run identified two findings worth recording for the verifier lane:

1. **MEDIUM — `deleteFile` skips the native store.**
   `query.ts:319-326` has no `if (useNative) return NativeStore.deleteFile(...)`
   guard, and `native-store.ts` exposes no `deleteFile` method. Every
   other mutation in `CodeGraphQuery` dispatches to native when enabled.
   Impact: when `AX_CODE_NATIVE_INDEX=1`, `CodeGraphBuilder.purgeFile`
   (`builder-impl.ts:1308-1315`, reached from the watcher unlink path at
   `watcher.ts:115`) removes edges/nodes from the native DB but leaves
   the `code_file` row behind. `clearProject` (`query.ts:568`) and
   `pruneOrphanFiles` (`query.ts:355`) both handle native correctly, so
   only the single-file delete is asymmetric. Recommended fix: add
   `NativeStore.deleteFile` and route through it, mirroring
   `deleteNodesInFile` at `query.ts:137`.

2. **MEDIUM — per-file `listFiles` is quadratic.**
   `builder-impl.ts:1025` rebuilds the full project file-path set inside
   `commitPreparedIndex`, which runs once per file. For a full project
   walk this is O(files²). The result is only used to resolve import
   edges at `builder-impl.ts:1027-1050`. Recommended fix: hoist the
   live-file set to the `indexFilesLocked` batch scope
   (`builder-impl.ts:1193`) and pass it into `commitPreparedIndex`, or
   resolve imports in a post-pass after all files are committed.

No Critical-severity issues were found, so no `reverify.md` is required
from this lane. These two findings are handed off to codex-sol for
independent confirmation.

## Step 9 Verification and exit

This primary review did not mutate any source files (read-only role).
Verification commands available to the independent verifier lane:

- `pnpm --dir packages/ax-code run typecheck` — TypeScript correctness
  across the whole core package, including this module.
- `pnpm --dir packages/ax-code run test:unit` — pure unit tests
  (covers the exported helpers named in Step 7).
- `pnpm --dir packages/ax-code run test:deterministic` — CI
  release-validation group.

Exit checklist for this lane:

- [x] All 12 in-scope source files read in full.
- [x] Each Step 1–8 section anchored to concrete file:line evidence.
- [x] Findings register consistent with the two findings above (no
      findings/ files exist yet, so no ledger drift).
- [ ] Independent verifier (codex-sol) confirmation of the two Step 8
      findings — pending the verifier run.

Sign-off: primary reviewer ax-code-glm, 2026-08-11. Module remains
REVIEWING until the codex-sol lane confirms or rebuts Step 8.
