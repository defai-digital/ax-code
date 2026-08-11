# Protocol — ui-sync (9-step review)

- Reviewer: `ax-code-glm` (model: `zai-coding-plan/glm-5.2[1m]`)
- Unit: `ui-sync` · `desktop/packages/ui/src/sync`
- Baseline: `994f9287e497666e104644eccea299595a35b39a`
- Independent verifier lane: `codex-sol`
- Date: 2026-08-11

## Step 1 Scope and map

The `ui-sync` module is the desktop renderer's synchronization substrate: SSE/WebSocket event transport, per-directory child stores, cross-store live aggregation, reconnect/resync logic, and the caches that make session switching cheap. I personally read the high-signal sources rather than relying on the static inventory: `desktop/packages/ui/src/sync/event-pipeline.ts` (1083 lines — transport, coalescing, retry), `desktop/packages/ui/src/sync/bootstrap.ts` (264 lines — three-phase startup), `desktop/packages/ui/src/sync/child-store.ts` (232), `desktop/packages/ui/src/sync/materialization.ts` (222), `desktop/packages/ui/src/sync/live-aggregate.ts` (224), `desktop/packages/ui/src/sync/eviction.ts` (53), `desktop/packages/ui/src/sync/binary.ts` (61), `desktop/packages/ui/src/sync/content-cache.ts` (94), `desktop/packages/ui/src/sync/session-prefetch-cache.ts` (139), `desktop/packages/ui/src/sync/streaming-metrics.ts` (213), `desktop/packages/ui/src/sync/live-selector-memo.ts` (92), `desktop/packages/ui/src/sync/assistant-fork.ts` (59), plus their test siblings. The audit's static map (290 exports, 0 empty catches, no TODOs) matches what I see in-tree; nothing was ghost-listed.

## Step 2 Threat and failure model

This lane runs in the Electron renderer (risk tag `desktop`); the module only talks to the `@ax-code/sdk` client and browser globals — no filesystem, no shells, no secrets. The real failure surface is state integrity across disruption:

- Transport drop / permanent server error: `event-pipeline.ts:540-544` (`isPermanentHttpStatus` → 4xx except 408/429 is "permanent"), `event-pipeline.ts:554-594` (`waitForRetry` — interruptible sleep on `online` / `openchamber:system-resume` / visibility / abort), `event-pipeline.ts:596-605` (`computeRetryDelay` exponential with offline/hidden caps).
- State-loss on eviction: `eviction.ts:15-24` (`hasPendingBlockingRequests`) protects any directory holding an unanswered question or pending permission; `child-store.ts:118-142` (`disposeDirectory`) re-guards through `canDisposeDirectory` so an eviction race can't strand a blocking request.
- Reconnect clobber of in-flight data: `bootstrap.ts:194-219` (question fetch) and `:220-250` (permission fetch) compute before/after signatures so an SSE-delivered update that lands during the fetch is not overwritten by the stale fetch result. `session-switch-resync.test.ts:126-140` proves the invariant.

No asset in this module crosses a trust boundary that isn't already owned by the SDK client.

## Step 3 Correctness

I traced control flow on the branches where a subtle bug would corrupt the chat view:

- `resolveAssistantForkSendChoice` (`assistant-fork.ts:39-58`) resolves provider+model as an atomic pair via `resolveCompleteModelChoice` (`:30-37`), so a half-populated source choice cannot donate its provider while the model leaks in from `currentChoice`. The "does not mix" case (`assistant-fork.test.ts:52-76`) exercises exactly this; the fallback chain source → current → lastUsed is correct and terminates in `null` (`assistant-fork.ts:49-51`).
- `coalesceQueuedEvent` (`event-pipeline.ts:343-355`): for two queued `message.part.updated` events, `shouldPreservePreviousPartUpdate` (`:320-341`) keeps a _final_ tool part over a _non-final_ one and keeps the later end-time — so a stale "running" snapshot can't overwrite a completed tool. Cross-type invalidation (`updatedPartKeyForDelta` / `deltaKeyPrefixForUpdated`, `:419-438`) prevents a delta arriving after a full snapshot from reordering ahead of it.
- `materializeSessionSnapshots` (`materialization.ts:150-197`) preserves live streaming text over a stale snapshot (`mergeMaterializedPart:99-117`) and re-appends live parts that the snapshot omitted (`mergeMaterializedParts:141-148`); `materialization.test.ts:75-112` covers each variant including the invalid-end-time edge.
- `bootstrapDirectory` critical-path gate (`bootstrap.ts:159-171`) refuses to advance `status` to `"complete"` when `path.get` or `session.status` reject, because those two have no global-state fallback — correct conservative behavior.
- `markConnected` (`event-pipeline.ts:624-633`) fires `onReconnect` on the _first_ connect, not only on recovery. The comment explains why (`isConnected` must flip positively or the send button throws "Connection lost"). Confirmed correct, not a defect.

## Step 4 Performance

Hot path is coalescing + batched flush: `FLUSH_FRAME_MS=33` and `BACKPRESSURE_FLUSH_FRAME_MS=200` (`event-pipeline.ts:28-30`), with per-directory queue/buffer swap in `flushDir` (`:457-472`) that avoids re-allocating the active queue. During token streaming the sidebar aggregations are kept cheap by `live-selector-memo.ts:68-91` (`createLiveSnapshotMemo`) — a two-layer memo that short-circuits both the selector body and the equality check whenever the watched slice references are unchanged across all child stores. `live-selector-memo.test.ts:52-74` proves a `message.part.updated` (which only mutates `part`) does not re-run a session-list selector. `streaming-metrics.ts` caps the per-session timestamp ring at `MAX_RING_SIZE=500` (`:57, 159-161`). One cost watch-item: `materialization.ts:38` `partSnapshotKey` uses `JSON.stringify(part)` per part inside `haveEquivalentPartSnapshots` (`:41-54`) — O(parts) serialization on every materialization; acceptable for normal turns, but worth noting for tool parts with very large outputs. The synthetic bench at `event-pipeline.bench.ts` (explicitly not a test — it prints and exits) gives intuition for the delta-reduction ratio under multi-session load.

## Step 5 Design

Mostly clean closure APIs (no class hierarchies except `ChildStoreManager`). Three design observations:

- Process-global mutable singletons: `content-cache.ts:13-15` (`lru`, `total`), `session-prefetch-cache.ts:20-23` (`cache`, `inflight`, `rev`, `listeners`), `streaming-metrics.ts:205` (`activeTracker`). Sharing one byte/TTL budget across all directory stores is a deliberate choice and keeps the API simple, but it couples every consumer and relies on `resetContentLru` / `clearSessionPrefetch*` / `setActiveMetricsTracker(null)` for test isolation.
- `bootstrap.ts:13-34` `unwrap` centralizes the SDK "non-throwing error → throw with status" normalization, yet `vcs.get` (`:185-193`), `question.list` (`:199-205`), and `permission.list` (`:228-234`) re-inline the status-extraction and error-wrap dance instead of reusing a shared helper. Mild duplication; the inline forms exist because each needs slightly different data handling, but the error-shape code is copy-pasted.
- `child-store.ts` declares a `disposers` Map that is _read_ in `disposeDirectory` (`:135-139`) and _cleared_ in `disposeAll` (`:186`) but is never written to anywhere inside the class. Either it is dead or it is populated by an off-class orchestrator not visible in this unit — the contract should be made explicit.

## Step 6 Dead code and hygiene

No silent catches in the audited set. The two swallow-sites are both justified inline: `bootstrap.ts:98-100` ignores a failure of the OpenChamber health endpoint (fallback message already in hand) and `event-pipeline.ts:234-236` falls back to `API_PATHS.base` when `axCodeClient.getBaseUrl()` throws. Comment drift only: `streaming-metrics.ts:79` says "binary-ish scan from the end" but the loop at `:81-86` is a plain linear reverse scan — cosmetic. No TODO/FIXME markers landed in the files I read.

## Step 7 Tests

I read 14 test files. Failure-path coverage is the strong suit of this module: `event-pipeline-online.test.ts` (offline does not spin; `online` wakes the retry sleep), `event-pipeline-permanent-error.test.ts` (404 → long cap, not 250ms hammering; 429/408 stay on the exponential path), `event-pipeline-resume.test.ts` (`openchamber:system-resume` interrupts both a live stream and a disconnected retry sleep), `session-switch-resync.test.ts:176-198` (transient `listPendingQuestions`/`listPendingPermissions` failure must preserve in-flight prompts — an explicit regression guard with a narrative comment at `:170-175`). `eviction.test.ts` and `materialization.test.ts` cover the protect-pending and live-streaming-preservation invariants. `event-pipeline.bench.ts` is correctly marked as a non-asserting benchmark. Two coverage gaps: `binary.ts:42 insert` has no direct test for its duplicate-insertion ordering invariant, and `content-cache.ts` dual-constraint (count + bytes) eviction is only exercised indirectly through the wider store tests, not as a focused unit.

## Step 8 Findings register

No Critical or High severity issues are accepted in this pass. The lower-severity observations are recorded inline in steps 5–6: module-global singletons (`content-cache.ts`, `session-prefetch-cache.ts`, `streaming-metrics.ts`), `unwrap` duplication in `bootstrap.ts`, the unresolved write-path of `child-store.ts` `disposers`, the `streaming-metrics.ts:79` comment drift, and the `JSON.stringify` part-key cost in `materialization.ts:38`. Each is a candidate for a follow-up cleanup issue; none is a gate blocker.

## Step 9 Verification and exit

This is a read-only review lane — no source was modified, so no build/typecheck/test command was run as part of this pass. The `findings/` directory is empty and I accepted no Critical items, so `reverify.md` is not required by the protocol. Recommendation for the `codex-sol` verifier lane: before closing sign-off, independently re-confirm the two highest-blast-radius invariants — (a) eviction never drops a directory with pending blocking requests (`eviction.ts:15-24` + `child-store.ts:118-142`), and (b) reconnect resync never clobbers an in-flight SSE-delivered question/permission (`bootstrap.ts:194-250`, regression-locked by `session-switch-resync.test.ts`). Nine steps complete; sign-off pending verifier + module owner.
