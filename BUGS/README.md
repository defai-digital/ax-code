# Bug Reports

## Status (2026-04-27)

Last triage scan: 2026-04-27 (post-IO/file scan resolution pass).

### Active Bugs

None. All previously reported bugs in this scan cycle have been resolved or closed.

### Closed / False Positives (2026-04-27, second pass)

- BUG-101: **Fixed** — `memory/store.ts` `save()`/`saveGlobal()` now use `Filesystem.write` (atomic tmp + rename). A process crash during a memory write no longer corrupts `memory.json`.
- BUG-102: **Fixed** — `file/index.ts` `File.status()` now reads untracked files through a 32-worker pool instead of an unbounded `Promise.all`. Eliminates EMFILE risk and heap pressure on monorepos with thousands of untracked files.
- BUG-103: Deferred — orphaned `.<pid>.<ts>.<rand>.tmp` files from crashed atomic writes. LOW severity (small files, cosmetic only). A startup sweep is nice-to-have but not worth adding a new boot-path module that has its own failure modes. Revisit if reports accumulate.
- BUG-104: Closed (accepted risk) — `File.read()` symlink TOCTOU. The actual read uses an already-resolved path (`readTarget`), so the read itself is safe. The same class of issue is documented as DEFERRED in `apply_patch.ts` (BUG-293) pending OS-level primitives (`O_NOFOLLOW + openat`) that Node's `fs.promises` doesn't expose.
- BUG-105: **Fixed** — `storage/storage.ts` migration-marker reader now distinguishes ENOENT (first run) from corruption, logs the corrupt case, and clamps out-of-range values to `[0, MIGRATIONS.length]` so a downgraded marker can't cause an out-of-bounds index access.
- BUG-106: Closed (not a bug) — the bug report itself concludes "the correctness of the locking is sound; the issue is performance and user experience under contention." The lock ordering (in-process → cross-process) is the documented design choice. No actionable defect.
- BUG-107: **Fixed** — `tool/apply_patch.ts` rollback now collects per-file failures and surfaces them in the thrown error (with the original error as `cause`), instead of swallowing them with `.catch()`. Users now see "apply_patch failed and rollback was incomplete for: …" when partial rollbacks happen.

### Closed / False Positives (2026-04-27, first pass)

- BUG-010: **Fixed** — `packages/ax-code/src/server/routes/global.ts` now redacts global config secrets using `redactConfig`.
- BUG-011: **Fixed** — `packages/ax-code/src/util/env.ts` now blocks non-boundary secret-like names (e.g. `OPENAI_APIKEY`, `MYSECRET`) and keeps sensitive variables out of child process environments.
- BUG-012: **Fixed** — `packages/ax-code/src/tool/ls.ts`, `packages/ax-code/src/tool/write.ts`, and `packages/ax-code/src/tool/edit.ts` now reject null bytes in user-supplied paths before path resolution.
- BUG-013: **Fixed** — `packages/ax-code/src/lsp/server-defs.ts` now uses `proc.exited` to ensure JDTLS temp directories are removed even if the JVM exits quickly.
- BUG-014: **Fixed** — `packages/ax-code/src/util/env.ts` removes `GIT_CREDENTIAL_HELPER` from the safe allowlist.
- BUG-001: **Fixed** — `src/memory/store.ts` read cache now re-stats after read; stale metadata no longer remains cached.
- BUG-002: False positive — `getLanguage()` registers `modelPending` before any await on the caller path.
- BUG-003: False positive / intentional — polling timers in `auth/index.ts` are `.unref()`'d and no longer hold the process open.
- BUG-004: Map growth in `builder.ts` — false positive (function-scoped Map, GC'd on return).
- BUG-005: Stale listener in `server-defs.ts` — false positive (synchronous listener registration after spawn).
- BUG-006: Non-atomic counter in `sse.ts` — false positive (single-consumer sequential loop).
- BUG-007: Timer leak in `tool/read.ts` — false positive (intentional fire-and-forget with `.unref()`).
- BUG-008: Child process leak in `debug-engine/` — low risk (short-lived diagnostic processes).
- BUG-009: Event listener in `cli/boot.ts` — false positive (intentional process-scoped handlers).

### Previous Reports (Cleared)

All previously reported bugs have been triaged and closed as of the prior scan cycles.
