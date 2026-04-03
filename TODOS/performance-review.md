# Performance Review

Date: 2026-04-02

Scope: static code review of the main runtime, app UI, and sync/share paths. This is not benchmark-backed profiling, so priorities below are based on code-path cost, fan-out, and likely user impact.

## Priority Order

### P0: Rehydrating full session history inside the agent loop

Evidence:
- `packages/ax-code/src/session/prompt.ts:308-342`
- `packages/ax-code/src/session/prompt.ts:647-648`
- `packages/ax-code/src/session/prompt.ts:787-800`
- `packages/ax-code/src/session/message-v2.ts:834-893`

Why this is a bottleneck:
- Every agent step re-runs `MessageV2.filterCompacted(MessageV2.stream(sessionID))`.
- `MessageV2.stream()` pages through the session in chunks and `filterCompacted()` materializes the result into an array before reversing it.
- The loop then scans that array again to find `lastUser`, `lastAssistant`, `lastFinished`, and task parts.
- Long sessions or tool-heavy sessions will pay this cost once per step, which grows toward `O(history * steps)`.

Likely impact:
- Slower agent turns as a session grows.
- Compaction and multi-step workflows become progressively more expensive.
- Extra DB reads and object allocation pressure.

TODO:
- Keep an incremental session cursor in memory during `SessionPrompt.loop()` instead of re-streaming history every step.
- Cache `lastUser`, `lastAssistant`, `lastFinished`, and unresolved task parts as state updated from new events.
- Add a targeted helper that fetches only the last relevant user/assistant messages instead of hydrating the whole conversation.
- Avoid the extra `findLast()` scan at `prompt.ts:647-648` by reusing the already derived `lastUser`.

### P0: Streaming write amplification and event flood during model output

Evidence:
- `packages/ax-code/src/session/processor.ts:66-110`
- `packages/ax-code/src/session/processor.ts:309-357`
- `packages/ax-code/src/session/index.ts:739-773`
- `packages/ax-code/src/server/routes/event.ts:35-78`

Why this is a bottleneck:
- Every reasoning delta and text delta emits an awaited `Session.updatePartDelta(...)`.
- `updatePart()` persists full parts and publishes `PartUpdated`; `updatePartDelta()` publishes every delta as an event.
- The SSE route forwards each event by `JSON.stringify`ing it and pushing it through a per-connection queue.
- High-token responses can therefore create a very large number of tiny backend writes/events and matching frontend updates.

Likely impact:
- CPU churn while streaming.
- UI jank under long reasoning/output responses.
- Higher memory pressure in event queues when clients are slower than producers.

TODO:
- Batch text/reasoning deltas by time window or byte threshold before publishing.
- Keep deltas in memory and flush the persisted full part on `text-end` / `reasoning-end`.
- Add backpressure or bounded queue behavior to the SSE route so slow consumers do not build unbounded event backlog.
- Measure event count per response and log when it crosses a threshold.

### P1: Share full-sync path materializes entire sessions into memory

Evidence:
- `packages/ax-code/src/share/share-next.ts:253-287`

Why this is a bottleneck:
- `fullSync()` loads the session, diffs, and then `Array.fromAsync(MessageV2.stream(sessionID))`.
- It then expands that into separate arrays for messages, parts, and models before sending them in a single payload.
- For large sessions this duplicates a lot of in-memory data and produces a very large sync request.

Likely impact:
- Slow or memory-heavy share creation for long sessions.
- Large one-shot network payloads.
- Avoidable GC pressure from building parallel derived arrays.

TODO:
- Stream or chunk share uploads instead of building one large payload.
- Reuse incremental sync for initial share bootstrap where possible.
- Add payload-size guards and telemetry for share sync volume.

### P1: Session history loading loops can repeatedly fetch and recompute under scroll pressure

Evidence:
- `packages/app/src/pages/session.tsx:162-200`
- `packages/app/src/pages/session.tsx:204-260`
- `packages/app/src/pages/session.tsx:442-475`
- `packages/app/src/pages/session.tsx:122-128`

Why this is a bottleneck:
- `loadAndReveal()` and `fetchOlderMessages()` both use `while (true)` loops that call `input.loadMore(id)` until visible growth appears.
- Each loop repeatedly reads `visibleUserMessages()` and `renderedUserMessages()`, which are derived from filtered/sliced message arrays.
- Under slow responses or long histories, scrolling near the top can trigger multiple round trips and repeated list derivations in one user action.

Likely impact:
- Scroll hitching on long sessions.
- More network requests than necessary when the window does not grow immediately.
- Repeated array filtering/slicing on large message lists.

TODO:
- Bound each user action to one fetch and let the next render decide whether more is needed.
- Keep separate counts for total loaded messages and visible user turns to avoid recomputing from filtered arrays in the loop.
- Precompute or cache user-message indexes instead of filtering the full `messages()` list on each update.

### P1: Timeline rendering repeatedly scans the full message list for live state

Evidence:
- `packages/app/src/pages/session/message-timeline.tsx:236-252`
- `packages/app/src/pages/session/message-timeline.tsx:269-287`
- `packages/app/src/utils/agent.ts:13-22`

Why this is a bottleneck:
- `pending()` uses `findLast()` across the full session message list.
- `messageAgentColor()` walks backward across the same list to find the latest user agent.
- `activeMessageID()` may do another backward scan when status is non-idle.
- These are small individually, but they sit on a hot path that updates while a response is streaming.

Likely impact:
- Extra render-time work proportional to session length.
- More noticeable slowdown in sessions with large message counts and active streaming.

TODO:
- Store last pending assistant ID, last active user ID, and current agent color in sync state as messages arrive.
- Avoid repeated full-list scans from view code during streaming.

### P2: Sidebar/session ordering work is broader than necessary

Evidence:
- `packages/app/src/pages/layout.tsx:181-187`
- `packages/app/src/pages/layout.tsx:667-679`
- `packages/app/src/pages/layout/helpers.ts:17-40`

Why this is a performance problem:
- `currentSessions()` sorts root sessions for every visible directory whenever the memo invalidates.
- `latestRootSession()` also flattens and sorts all roots when picking a project default.
- There is also a minute-aligned timer updating `state.sortNow`, but `sortNow()` is not referenced anywhere in this file now.

Likely impact:
- Avoidable sorting churn as workspace/session state changes.
- Wasted periodic state updates from the unused timer.

TODO:
- Remove the unused `sortNow` timer/state if it is truly dead.
- Keep per-directory sessions pre-sorted at write time or cache sorted roots per directory.
- Replace full flatten+sort for `latestRootSession()` with a linear max scan.

### P2: Persist layer still relies on JSON clone/stringify for normalized store state

Evidence:
- `packages/app/src/utils/persist.ts:161-163`
- `packages/app/src/utils/persist.ts:203-208`
- `packages/app/src/utils/persist.ts:349`
- `packages/app/src/utils/persist.ts:456`

Why this is a performance problem:
- The persistence helper snapshots defaults with `JSON.parse(JSON.stringify(...))`.
- Normalization also reparses and restrings merged objects.
- This code backs many global and workspace stores, so large persisted state trees multiply the serialization cost.

Likely impact:
- Extra startup and persistence overhead.
- Larger stores pay full-tree serialization costs even for small changes.

TODO:
- Avoid JSON deep-clone for defaults when the structure is static.
- Split very large persisted stores into smaller keys.
- Add size metrics for persisted payloads so oversized stores are visible.

## Suggested Execution Order

1. Fix the session-loop whole-history rehydration.
2. Batch streaming deltas and reduce SSE/event fan-out.
3. Rework share full-sync to chunk or stream.
4. Simplify history-loading loops and cache derived user-turn state.
5. Remove lower-value UI churn: repeated timeline scans, dead timers, oversized persistence payloads.

## Metrics Worth Adding Before/While Fixing

- Agent step latency vs. session message count.
- Number of `PartDelta` events emitted per response.
- SSE queue depth and dropped-event count per connection.
- Share payload size and sync duration.
- Session page render time vs. visible message count.
