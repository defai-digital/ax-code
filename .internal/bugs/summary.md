# Bug Reports Index

## Open Reports

| ID | Severity | Classification | Summary |
|----|----------|----------------|---------|
| 009 | low | suspected | Recorder.end() token race — interleaved begin() inherits non-reset sequence counter |

## Audit Log (Pass 5)

### Areas Audited — No New Bugs Found

| Area | Files Read | Verdict |
|------|-----------|---------|
| **LSP client** | `lsp/client.ts` (lines 1–450) | Well-structured. Per-file LRU content cache with MAX_CACHED_DIAGNOSTICS cap, path-level locking, incremental diff with fallback to full sync. |
| **LSP cache** | `lsp/cache.ts` (full) | TTL-based SQLite cache with graceful fallback on lookup failure. Hit-count errors are non-fatal. |
| **LSP scheduler** | `lsp/scheduler.ts` (full) | Inflight dedup with proper eviction guard (`registry.get(key) === promise`). Budget semaphore with settled-flag preventing double-wake race. Timer.unref prevents CLI hang. |
| **MCP subsystem** | `mcp/index.ts` (lines 1–770) | Thorough cleanup: killProcessTree for grandchildren, KeyedSerialQueue prevents connect races, pendingOAuthTransport tracking, stderr cleanup on close. Transport fallback (StreamableHTTP → SSE) with proper cleanup of untried candidates. |
| **Replay recorder** | `replay/recorder.ts` (full) | Token-gate pattern is correct for begin/end races (BUG-009 notes sequence non-reset as minor). Batched inserts with per-event fallback on batch failure. MAX_SESSIONS cap with eviction warning. |
| **Effect legacy** | `effect/instance-state.ts` (full) | ScopedCache-backed per-instance state with registered disposer and finalizer cleanup. |

## Resolved / Reclassified

| ID | Severity | Classification | Summary |
|----|----------|----------------|---------|
| 008 | high | stale false positive | `sse-queue.ts` currently defines `SSE_HARD_MAX` once, has no `SSE_SOFT_MAX` reference, and is covered by `test/server/sse-queue.test.ts`; no build error remains. |
