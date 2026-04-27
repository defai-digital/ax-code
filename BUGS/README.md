# Bug Reports

## Status (2026-04-27)

Last triage scan: 2026-04-27.

### Active Bugs

_(none)_.

### Closed / False Positives (2026-04-27)

- BUG-010: **Fixed** — `packages/ax-code/src/server/routes/global.ts` now redacts global config secrets using `redactConfig`.
- BUG-011: **Fixed** — `packages/ax-code/src/util/env.ts` now blocks non-boundary secret-like names (e.g. `OPENAI_APIKEY`, `MYSECRET`) and keeps sensitive variables out of child process environments.
- BUG-012: **Fixed** — `packages/ax-code/src/tool/ls.ts`, `packages/ax-code/src/tool/write.ts`, and `packages/ax-code/src/tool/edit.ts` now reject null bytes in user-supplied paths before path resolution.
- BUG-013: **Fixed** — `packages/ax-code/src/lsp/server-defs.ts` now uses `proc.exited` to ensure JDTLS temp directories are removed even if the JVM exits quickly.
- BUG-014: **Fixed** — `packages/ax-code/src/util/env.ts` removes `GIT_CREDENTIAL_HELPER` from the safe allowlist.

- BUG-001: **Fixed** — `src/memory/store.ts` read cache now re-stats after read; stale metadata no longer remains cached.
- BUG-002: False positive — `getLanguage()` registers `modelPending` before any await on the caller path.
- BUG-003: False positive / intentional — polling timers in `auth/index.ts` are `.unref()`'d and no longer hold the process open.
- BUG-004: Map growth in `builder.ts` — false positive (function-scoped Map, GC'd on return)
- BUG-005: Stale listener in `server-defs.ts` — false positive (synchronous listener registration after spawn)
- BUG-006: Non-atomic counter in `sse.ts` — false positive (single-consumer sequential loop)
- BUG-007: Timer leak in `tool/read.ts` — false positive (intentional fire-and-forget with `.unref()`)
- BUG-008: Child process leak in `debug-engine/` — low risk (short-lived diagnostic processes)
- BUG-009: Event listener in `cli/boot.ts` — false positive (intentional process-scoped handlers)

### Previous Reports (Cleared)

All previously reported bugs have been triaged and closed as of the prior scan cycle.
