# Protocol Steps — server-routes-event

Reviewer: ax-code-glm (`zai-coding-plan/glm-5.2[1m]`)
Unit slug: `server-routes-event`
Scope file: `packages/ax-code/src/server/routes/event.ts` (134 LOC)

## Step 1 — Scope and export surface

The unit is a single lazy Hono sub-app exporting `EventRoutes` from
`packages/ax-code/src/server/routes/event.ts:17`. It registers exactly one
route: `GET /event` (event.ts:18-19). It is mounted at the server root in
`packages/ax-code/src/server/server.ts:321` (`.route("/", EventRoutes())`), so
the public surface is `GET /event?directory=<path>`. OpenAPI metadata is
declared inline via `describeRoute` (event.ts:20-34) with operationId
`event.subscribe` and a 200 `text/event-stream` response schema resolved from
`BusEvent.payloads()` (event.ts:29). No other exports, no barrel re-exports. The
side-effect import `import "@/notification/events"` (event.ts:12) exists only to
register `NotificationEvent.*` definitions into the `BusEvent` registry before
`BusEvent.payloads()` is evaluated for the schema — confirmed in
`packages/ax-code/src/notification/events.ts:5-29`, where each `BusEvent.define`
mutates the shared registry (`packages/ax-code/src/bus/bus-event.ts:7-16`).

## Step 2 — Threat and failure model

The asset is a long-lived SSE stream bound to one client. Three failure modes
are defended explicitly in code:

1. **Slow/stuck consumer** — backpressure is bounded. Data frames go through
   `pushSseFrame` (event.ts:59) which checks `queue.size >= SSE_HARD_MAX`
   (4096, `packages/ax-code/src/util/sse-queue.ts:33`) and returns `"overflow"`,
   triggering `stop()` and a client disconnect (event.ts:60-65). A warning
   fires once at 3072 (event.ts:66-75, `SSE_WARN_THRESHOLD`).
2. **Cross-workspace event leakage** — `shouldForward` (event.ts:110-113)
   forwards an event only when `properties.directory` is `undefined` (broadcast)
   or equals `Instance.directory`. `Instance.directory` is established per
   request by the `Instance.provide` middleware in
   `packages/ax-code/src/server/server.ts:269-277`, driven by
   `requestDirectory()` in `packages/ax-code/src/server/request-directory.ts:27-69`,
   which rejects non-absolute paths, null bytes, non-existent/non-directory
   targets, dangerous roots (`/`, `/etc`, `/proc`, … request-directory.ts:9-23),
   and sensitive home subtrees (`.ssh`, `.aws`, … request-directory.ts:25, 61-68).
   This directory filter is the trust boundary for multi-workspace isolation on
   this route.
3. **Uncaught throw from a timer** — the heartbeat callback is wrapped in
   `try/catch` (event.ts:99-106) so a `pushControl` failure cannot kill the
   process; the comment at event.ts:96-97 states this intent verbatim.

There are no empty catches in this file. The single `catch (error)` at
event.ts:104 logs at `warn` level with context — appropriate for a best-effort
heartbeat.

## Step 3 — Control-flow correctness

I traced the connect → stream → disconnect lifecycle.

- `stop()` (event.ts:46-56) is idempotent via the `done` flag, so the four call
  sites — overflow (event.ts:65), `InstanceDisposed` subscriber (event.ts:118),
  `stream.onAbort` (event.ts:121), and the `finally` block (event.ts:128-130) —
  cannot double-clean. `clearInterval` and `unsub()` are each safe to repeat:
  `unsub` defaults to a no-op `() => {}` (event.ts:44) before subscription, and
  the unsub returned by `Bus.subscribeAll` (`packages/ax-code/src/bus/index.ts:146-153`)
  early-returns once the callback has been spliced out.
- Ordering is correct: the `server.connected` control frame is enqueued
  (event.ts:90-93) **before** `Bus.subscribeAll` is registered (event.ts:115),
  so the client always sees connected first.
- The termination sentinel is `q.push(null)` (event.ts:53); the consumer loop
  returns on `data === null` (event.ts:125). The `finally { stop() }`
  (event.ts:128-130) covers any throw out of `stream.writeSSE`.
- The subscriber callback runs synchronously inside `Bus.publish` → `prepare` →
  `deliver` (`packages/ax-code/src/bus/index.ts:67-73`), which iterates a
  **copied** subscriber array (`[...state().subscriptions.get(key) ?? []]`,
  bus/index.ts:68). The in-band `unsub()` that `stop()` triggers inside `push`
  therefore cannot corrupt the active iteration — the race is structurally safe.

## Step 4 — Resource lifecycle and timers

`heartbeat` is a `setInterval` (event.ts:98) with `unref?.()` (event.ts:108) so
it cannot keep the event loop alive on its own — correct for a per-request
timer. It is cleared inside `stop()` (event.ts:49). The `Bus` subscription is
released via `unsub()` in `stop()` (event.ts:51). The `AsyncQueue` is never
`.close()`d; instead the route pushes a `null` sentinel. This is a deliberate
divergence from the queue's native `close()` mechanism (see Step 6) but is
functionally sound because consumption is via the `for await` loop, which
terminates on the sentinel rather than throwing the way `.next()` would
(`packages/ax-code/src/util/queue.ts:43-57`). No listener leak, no interval
leak, no unbounded map growth — all per-connection state is stack-local except
the `Bus` subscription, which is always torn down.

## Step 5 — Performance and backpressure design

The route splits data frames and control frames into two enqueue paths with
**different** capacity semantics, both sharing the same underlying `q.size`:

- Data frames: `pushSseFrame` enforces `SSE_HARD_MAX=4096` with hard disconnect
  on overflow (`packages/ax-code/src/util/sse-queue.ts:30-42`).
- Control frames: `pushControl` (event.ts:85-88) has a separate smaller cap,
  `CONTROL_FRAME_QUEUE_LIMIT = 256` (event.ts:84), and **silently drops** when
  at cap (`if (q.size >= CONTROL_FRAME_QUEUE_LIMIT) return`). The comment at
  event.ts:79-83 explains the reasoning: a near-cap burst of real events must
  not be able to trigger a teardown via a heartbeat, yet heartbeats still need
  their own bound so a stalled consumer cannot accumulate them forever.

Because both caps compare against the true `q.size` (the shared backlog), the
design is coherent. Serialization cost per frame is one `JSON.stringify`; data
frames go through `encodeSsePayload`, which handles bigint → string and circular
refs and emits a structured `server.serialization_error` on failure
(`packages/ax-code/src/util/sse-queue.ts:44-64`). The `warned` latch
(event.ts:42, 66-75) prevents log flooding under sustained backpressure — a
considered detail.

## Step 6 — Design and API consistency

The route is cohesive: one responsibility (stream filtered Bus events to one
SSE client). Coupling is to stable in-repo abstractions — `Bus`, `Instance`,
`AsyncQueue`, the SSE queue helpers, and `RuntimeEvent` (re-exported as `Event`
in `packages/ax-code/src/server/event.ts:1-3`). The `BusEvent.payloads()`
discriminated union (`packages/ax-code/src/bus/bus-event.ts:18-39`) drives the
OpenAPI schema, so the documented event types stay in sync with whatever
`BusEvent.define` registrations execute at module load.

Two design inconsistencies (neither a defect, both worth flagging):

1. **Control frames bypass `encodeSsePayload`.** `pushControl` calls
   `JSON.stringify(payload)` directly (event.ts:87) rather than
   `encodeSsePayload`. The two current control payloads are trivial
   (`{type, properties: {}}`) so this is safe today, but it is a latent
   inconsistency: a future control frame carrying a bigint or circular object
   would throw. The initial `server.connected` push (event.ts:90) is **not**
   inside a `try/catch` (unlike the heartbeat at event.ts:99-106), so such a
   throw would propagate into the stream handler.
2. **Null sentinel vs `AsyncQueue.close()`.** The queue exposes a `close()`
   method backed by a CLOSED symbol (`packages/ax-code/src/util/queue.ts:35-41`)
   that also guards `push` (`if (this.closed) return`, queue.ts:26). The route
   ignores that API and pushes `null`, typing the queue as
   `AsyncQueue<string | null>`. A side effect is that the `null` sentinel
   increments `count`, so it participates in `q.size` and therefore in the
   control-frame cap comparison — harmless here, but the queue's `closed`
   invariant is never established for this consumer.

## Step 7 — Dead code, hygiene, and conventions

No dead exports, no unreachable branches, no TODO/FIXME markers in the file.
`HEARTBEAT_INTERVAL_MS = 10_000` (event.ts:15) and
`CONTROL_FRAME_QUEUE_LIMIT = 256` (event.ts:84) are named module constants
rather than magic numbers — good. The lazy initializer (`lazy(...)` at
event.ts:17) matches the other route modules mounted in `server.ts`. Import
ordering and the `@/` alias usage follow the rest of `src/server`. Formatting is
consistent with the repo's Prettier config (no semicolons, 120 width). The
`unsub = () => {}` placeholder (event.ts:44) is a recognized idiom in this
codebase for "may be reassigned later," and the structural test at
`packages/ax-code/test/server/route-validation.test.ts:1070-1077` pins that
invariant (`} finally {` and `q.push(null)` must remain present).

## Step 8 — Findings register

No findings of Critical or High severity. Two informational notes carried over
from Step 6, neither blocking:

- **INFO — control-frame serialization path differs from data frames.**
  `pushControl` (event.ts:85-88) uses raw `JSON.stringify`. Safe for current
  payloads; revisit if a non-trivial control frame is added. Not blocking.
- **INFO — null-sentinel termination instead of `AsyncQueue.close()`.**
  Functional and structurally tested, but diverges from the queue's own API
  (`packages/ax-code/src/util/queue.ts:35-41`). Not blocking.

The prior MODULE-AUDIT register at
`docs/module-quality-audit/modules/server-routes-event/MODULE-AUDIT.md:60-64`
records no accepted findings, consistent with this pass.

## Step 9 — Verification and exit

This is a read-only review, so verification is the existing test suite rather
than a code change. Directly relevant coverage:

- `packages/ax-code/test/server/route-validation.test.ts:1070-1084` — structural
  assertions that the route keeps a `finally { … q.push(null) }` cleanup block
  and that `shouldForward` filters by `Instance.directory`. These are
  source-text checks, not behavioral.
- `packages/ax-code/test/control-plane/workspace-server-sse.test.ts:51-105` and
  `:107-164` — behavioral end-to-end SSE coverage, but for the **sibling**
  control-plane workspace-server, not for
  `packages/ax-code/src/server/routes/event.ts` directly.

Coverage gap (non-blocking): `packages/ax-code/src/server/routes/event.ts` has
no test that directly drives its `CONTROL_FRAME_QUEUE_LIMIT = 256` drop path or
its `SSE_HARD_MAX` overflow → disconnect path. Recommendation: add a unit test
that pushes the data queue to 4096 and asserts the client is disconnected, and
one that floods control frames past 256 and asserts silent drop. No Critical
item exists, so no `protocol/reverify.md` is produced by this primary review.
Independent verifier for this run: codex-sol. Reviewer sign-off: ax-code-glm.
