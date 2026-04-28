# Bug Reports

## Status (2026-04-27, BUG-200..213 triage)

Triage and fixes for the third storage / memory deep-dive batch
(BUG-200..213, plus BUG-212 self-acknowledged false positive). Most reports
in this batch were lifecycle-scan / hardcode-scan heuristics that did not
hold up against the current code; only three were actionable.

### Fixed in this pass

| ID | Severity | Component | What changed |
|----|----------|-----------|--------------|
| BUG-200 | Low | `util/filesystem.ts` | `Filesystem.writeStream` now relies solely on `createWriteStream(tmp, { mode })` to set the file mode. The redundant `await fs.chmod(tmp, mode)` was removed — `createWriteStream` already opens the file with the requested mode at creation, so the chmod was a no-op that added an extra stream-close → rename window for no benefit. |
| BUG-207 | Medium | `cli/cmd/storage/transfer.ts` | `writeTransfer` now wraps the entire session+messages+parts+events import in a single `Database.transaction(...)` call instead of issuing each insert through its own `Database.use`. A mid-import failure (FK violation, malformed event) rolls back the whole batch instead of leaving a half-imported session with dangling rows. Matches the all-or-nothing pattern used by `Session.fork`. |
| BUG-208 | Medium | `auth/index.ts` | `acquireFileLock` now returns a `Disposable` whose `Symbol.dispose` runs synchronously: `readFileSync` to verify our token, then `unlinkSync` to release. Previously it returned an `async () => Promise<void>` that callers invoked without `await`, so the lockfile lingered on disk after the `try/finally` exited and could collide with the next acquirer. All three callers (`migrate`, `set`, `remove`) now use `using _crossProcess = await acquireFileLock()` for deterministic cleanup. Same pattern as the BUG-117 fix to `FileLock`. |

### Cleared as false positive / accepted-risk

| ID | Reason |
|----|--------|
| BUG-201 | `Filesystem.write` already cleans up the tmp file on every observed failure path — both the initial try and the ENOENT-retry path call `fs.unlink(tmp).catch(() => {})` in their catch blocks. The "rename succeeds but later code throws" case the report describes does not exist (rename is the last operation in the try). |
| BUG-202 | `Storage.read` deliberately omits the cross-process lock. `fs.rename` is atomic on POSIX, so a reader observes either the pre-rename or post-rename content — never a partial write. Adding `FileLock.acquire` would force readers to block on every concurrent in-flight write, which is a throughput regression with no correctness benefit. The "stale read" the report flags is just normal point-in-time read semantics. |
| BUG-203 | `SessionStatus` map is already cleaned via `SessionStatus.set(..., idle)` from `SessionPrompt.cancel` (line 456) and via `SessionStatus.clear(...)` from `Session.remove`'s teardown. Loop completion → `defer` → `cancel` → idle covers the normal path; abnormal process termination drops the map with the process. No accumulating leak in practice. |
| BUG-204 | `BlastRadius.sessions` is cleaned via `BlastRadius.reset` in two places: the `defer(() => BlastRadius.reset(sessionID))` block in `SessionPrompt.loop` (covers normal completion + thrown exceptions via `await using`) and `Session.remove`'s teardown. Sessions that never run a prompt loop never create a state entry (`BlastRadius.get` is the only insertion point and is only called from the autonomous-mode write path). No real leak. |
| BUG-205 | `compaction.inFlight.delete` runs in a `finally` block that JS guarantees executes for any thrown exception. The "abnormal termination bypasses finally" scenario only applies to process kill, in which case the Set is gone with the process. Not a real leak. |
| BUG-206 | `SessionPrompt` state is cleaned on normal loop completion via the `defer` callback at lines 482-502, which calls `cancel(sessionID)` (or hands off to a re-entry that eventually does). Cleanup is symmetric with start in every observed path. |
| BUG-209 | Build scripts (`build.ts`, `test-ci.ts`, etc.) are short-lived one-shots; their child processes naturally exit when the script does. Debug-engine scripts are dev-only and not loaded into long-running TUI/server hosts. The lifecycle-scan heuristic doesn't model script lifetime. |
| BUG-210 | `PRAGMA busy_timeout = 15000` is a tuning choice, not a bug. 15s tolerates burst write contention without spurious `SQLITE_BUSY` errors that would surface to the user as "database is locked". Lowering it would just shift failure modes. The hardcode-scan flagging this as a magic number is mechanical. |
| BUG-211 | The `import { Database } from "bun:sqlite"` in `json-migration.ts` is used only as a type annotation on `run(sqlite: Database, ...)` — the actual runtime db instance is supplied by the caller. The Bun-only `drizzle-orm/bun-sqlite` import is intentional: this module is invoked from `ax-code db migrate` which runs under Bun. Not a portability gap that materializes anywhere. |
| BUG-212 | Self-acknowledged false positive in the report — the flagged timers are intentionally `.unref()`'d or run in process-exit context. |
| BUG-213 | Report's line numbers don't match current source: lines 784-786 / 912-914 are SDK method calls (`sdk.session.fork`, `sdk.session.create`), not child-process spawns, and the line-836 "timer" the report flags is in fact a *removed* setTimeout polling pattern (replaced with promise resolution; the comment on the surrounding lines explicitly documents the prior leak's removal). The lifecycle scanner mis-classified async function calls. |

### Historical status

Earlier triage passes (BUG-001..015, BUG-008, BUG-013, BUG-101..121,
storage/memory pass 1, etc.) are documented in git history.
