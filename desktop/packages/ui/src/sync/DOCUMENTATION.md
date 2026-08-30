# Sync architecture, event handling & store update rules

## Scope

This document covers the current client-side session/data architecture in `packages/ui/src/sync` and the rules for updating stores safely.

There are **two distinct session data scopes** in the UI:

1. **Directory-scoped sync stores**
   - Owned by the sync layer child stores created in `sync-context.tsx`
   - Source for per-directory live session/message/part/permission/question state
   - Backed by SSE / directory-scoped polling
   - Read via hooks like `useSessions()`, `useDirectorySync()`, `getSyncSessions()`, `getDirectoryState()`

2. **Global sessions cache**
   - Owned by `packages/ui/src/stores/useGlobalSessionsStore.ts`
   - Shared source of truth for the Sessions sidebar global lists and Session Retention cleanup
   - Holds:
     - global active sessions
     - global archived sessions
     - active sessions indexed by directory

These two scopes are intentionally different, but they are no longer equal peers for live UI truth.

### Why both exist

The directory-scoped sync stores are **not** a complete global view.

- They are created lazily per directory
- They only contain data for directories initialized in the current app session
- They are optimized for live per-directory domain data
- They do not maintain the complete global active+archived session view needed by the sidebar and retention settings

So:

- Use the **directory sync stores** for per-directory live session/message state
- Use the **global sessions store** for cold/global session coverage (especially archived pages and unopened directories)
- Use **aggregated child-store snapshots** for live session/status truth across already initialized directories

## Ownership map

| Layer / Store                                | Owns                                                                                                | Scope                                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| child directory stores in `sync-context.tsx` | `session`, `message`, `part`, `permission`, `question`, etc.                                        | One directory                             |
| `session-ui-store.ts`                        | Session selection, draft lifecycle, abort prompts, worktree metadata, SDK-facing action entrypoints | App UI state                              |
| `useGlobalSessionsStore.ts`                  | Global active sessions, global archived sessions, `sessionsByDirectory`                             | All opened project/worktree session lists |
| `viewport-store.ts`                          | Scroll anchors, session memory, loading indicators                                                  | App UI state                              |
| `input-store.ts`                             | Draft input state, attached files, synthetic parts                                                  | App UI state                              |
| `selection-store.ts`                         | Model/agent/variant selections, including one-time legacy `context-store` selection migration       | App UI state                              |

## Global sync store & bootstrap

`global-sync-store.ts` (`useGlobalSyncStore`) holds only app-level boot
state — `ready`, `error`, `path`, `projects`, `reload`. It deliberately does
NOT carry config-domain copies: `providers`/`providerAuth`/`config`/
`sessionTodo` were removed (SPEC-2026-08-30 S4.3) because their real readers
live in `src/stores/` (`useConfigStore`, `useTodosPersistStore`, …). Do not
re-add config-domain fields here.

Per-directory child stores (`State` in `types.ts`) hold only the live
session/message hot path plus directory metadata: `status`, `project`,
`projectMeta`, `icon`, `path`, `session`, `sessionTotal`, `session_status`,
`session_diff`, `todo`, `permission`, `question`, `lsp`, `vcs`, `limit`,
`message`, `part`. The config-domain slices `agent`/`command`/`provider`/
`mcp`/`config` were removed (SPEC-2026-08-30 S4.6): those domains are
single-home in `src/stores/` — providers + selection in `useConfigStore`,
agents in `useAgentsStore`, commands in `useCommandsStore`, MCP in
`useMcpStore`/`useMcpConfigStore`. `lsp` stays: it carries live per-directory
LSP status with an `lsp.updated` event contract (see the event → field
mapping below). Do not re-add config-domain slices to `State`.

Bootstrap runs in two scopes:

1. **Global** (`bootstrapGlobal`): fetches `path.get` + `project.list` only,
   then flips `ready` (with `error` when every request failed). Config and
   providers are no longer fetched globally.
2. **Per directory** (`bootstrapDirectory`): phase 1 (blocking) fetches
   `path.get` + `session.status` (plus `project.current` when the project id
   cannot be seeded from the global list); phase 2 (deferred) fetches
   lsp/vcs/permission/question; phase 3 (lazy) loads the session list. Since
   S4.6 the bootstrap does NOT fetch providers/config/agents/commands/mcp —
   the app-level stores above load those themselves
   (`useConfigStore.initializeApp`, `useAgentsStore.loadAgents`, …). The
   global `projects` list is only used to seed the directory's project id.

## Connection state (S4.7 — single transport-owned phase)

The canonical connection phase lives in
`src/lib/event-stream/connection-state.ts` (`useConnectionStore`:
`phase` = `"connecting" | "connected" | "reconnecting"`,
`hasEverConnected`, `lastDisconnectReason`). It is the ONLY connection-state
field in the app — the overlapping `useConfigStore.isConnected /
connectionPhase / hasEverConnected / lastDisconnectReason` fields and
`useUIStore.eventStreamStatus` were removed (SPEC-2026-08-30, S4.7).

Ownership rules:

1. **Single writer: the event pipeline.** `event-pipeline.ts` owns the app's
   `createEventTransport` instance and marks the store via
   `markStreamConnected()` (server subscription acknowledgement — SSE
   `server.connected` frame or WS ready frame — and transport switches) and
   `markStreamDisconnected(reason)` (transport failure/interrupt). The sync
   context (`sync-context-impl.tsx`) does NOT write connection state in its
   `onReconnect`/`onTransportSwitch` callbacks anymore — those callbacks only
   run recovery work (global bootstrap retry, session-list catch-up,
   per-directory resync). The writer registry is enforced by
   `script/check-desktop-store-boundaries.ts` (R5): only `event-pipeline.ts`
   (and the module's own test) may import the `markStream*` write API.
2. **Readers subscribe to the connection store directly** —
   `selectIsConnected(state)` (`state.phase === "connected"`) is the derived
   convenience for the old `isConnected` boolean. Current readers: `App.tsx`,
   `ElectronMiniChatApp.tsx`, `SyncStatusIndicator`, `ReconnectBanner`,
   `useAxCodeReadiness`, `session-actions.ts` (send grace window + "Connection
   lost" error), `lib/axCodeStatus.ts` (debug dump).
3. **Probes are not connection state.** `useConfigStore.probeConnection /
checkConnection` are server-reachability probes (HTTP health endpoint) used
   at boot and inside the send grace window. They return a boolean and never
   write the connection phase: a healthy HTTP endpoint does not imply a live
   stream, and a failed probe does not tear one down. Boot failure after a
   successful reachability check is recorded separately as
   `useConfigStore.initializationError` (read by `useAxCodeReadiness`).
4. **Not persisted.** A persisted phase would lie on every app start; the
   store always boots at `phase: "connecting"`.

The module lives in `lib/event-stream/` (not `stores/`) so the boundary
direction stays one-way: the transport layer never imports `stores/`, while
`stores/` (e.g. `useConfigStore.activateDirectory`) and components read the
connection store.

## Session list rules

### Directory-scoped session list

Use the directory-scoped sync store when the UI needs the live session list for the **current directory**.

Examples:

- current chat/session switching
- per-directory session/message bootstrap
- session/message/part SSE updates

### Global session list

Use `useGlobalSessionsStore` when the UI needs a **shared global session cache**.

Current consumers:

- `useSessionAutoCleanup.ts`

### Live cross-directory session/status view

Use the sync hooks backed by aggregated child stores when the UI needs **live truth** for sessions or statuses across all initialized directories.

Current consumers:

- `SessionSidebar.tsx`
- `SessionNodeItem.tsx`
- `Header.tsx`
- agent/session activity surfaces using `useGlobalSessionStatus()` / `useAllSessionStatuses()`

### Mutation responsibility

`useGlobalSessionsStore` is event-fed (SPEC-2026-08-30, S4.4/S4.5). The session
lifecycle event stream is the **sole writer of record**; it is kept correct by:

1. `session.created` / `session.updated` / `session.deleted` bus events, applied
   via `sync/global-session-events.ts` (`applySessionLifecycleEventToGlobalStore`)
   from `handleEvent` for EVERY directory — including directories with no child
   store, whose session events used to be dropped. Archive transitions arrive as
   `session.updated` with `time.archived` set (there is no `session.archived`
   event). The store's `applySessionEvent` shape-validates the payload, never
   resurrects a session inside its `pendingRemoval` undo window, and ignores
   out-of-order events older than the current entry
   (`preserveNewerSessions` semantics, per session).
2. HTTP catch-up via `loadSessions()` (full active+archived snapshot) on
   reconnect (`server.connected` / WS ready and transport switch) and on
   `server.resync_required`; `applySnapshot`'s `preserveNewerSessions` keeps
   newer event-fed entries when a stale snapshot lands.
3. A small set of explicitly-optimistic transition primitives (S4.5) — these
   are the ONLY remaining manual writes, each annotated at its call site:
   - `createSession()` → `upsertSession(session)`: creation gap — the new
     session is navigated to immediately and must appear in the sidebar before
     the `session.created` event round-trips.
   - `deleteSession()` / `deleteSessionInDirectory()` → `removeSessions([id])`
     and `archiveSession()` → `archiveSessions([id], at)`: hard delete/archive
     confirm flows have no `pendingRemoval` undo window, so the post-success
     write is the only guaranteed instant sidebar update (a dropped event
     would otherwise leave a ghost entry).
   - `soft-removal.ts` failure rollback → `upsertSession(entry.session)`: a
     FAILED removal emits no event, so nothing else re-adds the session.
   - The `pendingRemoval` window itself (`markPendingRemoval` /
     `undoPendingRemoval` / `commitPendingRemoval`): instant hide + undo for
     soft delete/archive; events about pending sessions are suppressed until
     commit/undo.
     In dev mode the fan-out logs a single-line diff whenever an event would
     change the store entry — after S4.5 that log is the regression alarm: a
     diff line means an event disagreed with store state, which should be rare.

This keeps cold/global lists responsive without requiring a refetch after every change.

Live activity/status indicators must not depend on this cache. They must derive from aggregated child-store state.

## Session action rules

Session actions live in `session-actions.ts` and are the canonical place for SDK-calling session mutations that affect global session lists.

Rules:

1. Do NOT write to `useGlobalSessionsStore` after an SDK mutation. The
   `session.created/updated/deleted` event is the writer of record for the
   global index (see "Mutation responsibility"); new actions must rely on it.
   The only exceptions are the documented optimistic primitives: the
   create-time add in `createSession`, the instant removals in the hard
   delete/archive flows, and the soft-removal failure rollback.
2. If an action targets a session by ID, resolve the **session's own directory**. Do not assume the current directory is correct.
3. `session-ui-store.ts` should delegate to `session-actions.ts` for these mutations instead of duplicating SDK calls.

Event-covered actions with NO manual global-store write (the session event
reconciles the global index):

- `unarchiveSession()` -> `session.updated` (archived: null) event
- `updateSessionTitle()` -> `session.updated` event
- `moveSession()` -> `session.updated` (new directory) event
- `applyRollbackPoint()` -> `session.updated` event
- `useSessionAutoCleanup` bulk archive/delete -> per-session events
- `useMultiRunStore` session creation -> `session.created` event

## The golden rule

When creating a draft in `handleDirectoryEvent`, **only clone the state fields the event will mutate**. Never spread all fields eagerly.

```typescript
// WRONG — clones everything, breaks referential equality for all subscribers
const draft = {
  ...current,
  session: [...current.session],
  message: { ...current.message },
  part: { ...current.part },
  permission: { ...current.permission },
  // ...
}

// RIGHT — only clone what this event type touches
const draft = { ...current }
switch (event.type) {
  case "message.part.delta":
    draft.part = { ...current.part }
    break
}
```

## Why this matters

Zustand skips re-renders when a selector returns the same reference (`Object.is`). If you spread `session: [...current.session]` but the event only modifies `part`, the `session` array gets a new reference. Every component using `useSessions()` re-renders for nothing.

During streaming, `message.part.delta` fires ~60 times/sec. Eagerly cloning all fields caused every subscriber in the entire app to re-render 60/sec — a 10x overhead. Targeted cloning reduced MessageList renders from ~1972 to ~296 per session.

## Event → field mapping

This table is enforced, not advisory: `src/sync/event-coverage.test.ts` encodes
it as a fixture and asserts that `prepareEventDraft` (the cloning switch in
`event-reducer.ts`, called from `handleEvent` in `sync-context-impl.tsx`)
clones exactly these slices per event type, and that a `message.part.delta`
burst leaves every other slice reference-identical.

| Event type                           | Fields to clone                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `session.created/updated/deleted`    | `session`, `permission`, `todo`, `part` (plus `message`, `session_diff`, `session_status`, `question` when archiving/deleting) |
| `session.diff`                       | `session_diff`                                                                                                                 |
| `session.status`                     | `session_status`                                                                                                               |
| `session.idle/error`                 | `session_status`                                                                                                               |
| `todo.updated`                       | `todo`                                                                                                                         |
| `message.updated`                    | `message`                                                                                                                      |
| `message.removed`                    | `message`, `part`                                                                                                              |
| `message.part.updated/removed/delta` | `part`                                                                                                                         |
| `vcs.branch.updated`                 | (none — mutates `draft.vcs` directly)                                                                                          |
| `permission.asked/replied`           | `permission`                                                                                                                   |
| `question.asked/replied/rejected`    | `question`                                                                                                                     |
| `lsp.updated`                        | `lsp`                                                                                                                          |

Note (S4.4): `session.created/updated/deleted` ADDITIONALLY fan out to
`useGlobalSessionsStore` via `sync/global-session-events.ts` for every
directory — including directories with no child store, whose events
previously fell through `handleEvent` untouched. That write targets a
different store, so it is intentionally OUTSIDE the child-store slice-clone
contract above: the cloned-slice set per event type is unchanged and the
`event-coverage.test.ts` fixture needs no new rows for it.

## Adding a new event type

1. Add the case to the event reducer (`event-reducer.ts`)
2. Add a corresponding case to the cloning switch in `prepareEventDraft`
   (`event-reducer.ts`) that clones **only** the fields your reducer writes to
3. Add the event → field row to the table above — `event-coverage.test.ts`
   fails until the documented table and the code agree
4. If your event fires frequently (more than a few times per second), verify that unrelated components don't re-render — check with the stream perf counters

## Cross-store selector memoization

`useLiveSyncSelector` (sync-context.tsx) runs its selector over **all** child
stores on every store notification. The hot streaming events clone only
`part`/`message`, so the slices the sidebar aggregations read (`session`,
`session_status`) keep their references — `live-selector-memo.ts` exploits
this: each hook passes a deps extractor listing the slices its selector reads,
and when those references are unchanged across all stores the cached result is
returned without running the selector or its equality check at all.

Invariants:

- The deps extractor must list **every** slice the selector reads. A selector
  that reads a slice not in its deps will serve stale results.
- The "Event → field mapping" table above is the contract: if you add a slice
  clone to a hot event, selectors watching that slice will recompute on it.

## Selector hygiene

Select leaf values, not containers:

```typescript
// WRONG — returns entire Map/object, new reference on any mutation
useDirectorySync((s) => s.permission)

// RIGHT — returns the value for one key, stable unless that key changes
useDirectorySync((s) => s.permission[sessionID] ?? EMPTY)
```

Same applies to `useStreamingStore` — select `.get(key)` not the Map itself.

## Store splitting pattern

### Why split

A single Zustand store with N properties means every subscriber's selector re-evaluates on every state change — even if the change is unrelated to what that subscriber reads. During streaming, `sessionMemoryState` updates ~60/sec. Before the split, all 68+ `useSessionUIStore` subscribers re-evaluated on each update. After splitting into focused stores, only `useViewportStore` subscribers (2-3 components) re-evaluate.

The optimization multiplies with targeted event cloning: fewer new references per event × fewer subscribers per store = dramatically less work per SSE frame.

### The stores

| Store                 | Owns                                                             | When it changes                       |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| `session-ui-store.ts` | Session selection, draft lifecycle, abort, worktree, SDK actions | Session switch, draft open/close      |
| `input-store.ts`      | Pending input text, synthetic parts, attached files              | User typing, file attach, revert/fork |
| `selection-store.ts`  | Per-session model/agent/variant choices                          | Model/agent picker                    |
| `viewport-store.ts`   | Scroll anchors, session memory state, sync status                | Streaming, scroll, session switch     |

### Rules for new UI state

1. **Never add to `session-ui-store`** unless it's session selection, draft lifecycle, or abort state
2. **Group by change frequency** — state that changes during streaming (viewport, memory) must not live with state that changes on user action (selections, input)
3. **Group by subscriber set** — if only 2 components read a value, it should be in a store that only those 2 components subscribe to
4. **Prefer a new store over growing an existing one** if the new state has different subscribers or change frequency
5. **Cross-store reads use `.getState()`** — actions in one store that need to read another store call `useOtherStore.getState()` (imperative, no subscription)

### Anti-patterns

```typescript
// WRONG — stuffing unrelated state into one store
const useEverythingStore = create(() => ({
  sidebarOpen: true,
  scrollAnchor: 0,
  selectedModel: null,
  pendingInput: "",
  // 20 more fields...
}))

// RIGHT — separate stores by concern + change frequency
const useViewportStore = create(() => ({ scrollAnchor: 0 }))
const useSelectionStore = create(() => ({ selectedModel: null }))
const useInputStore = create(() => ({ pendingInput: "" }))
```
