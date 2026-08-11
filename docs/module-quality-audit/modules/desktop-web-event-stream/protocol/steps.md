# Protocol — desktop-web-event-stream (9-step review)

| Field                | Value                                          |
| -------------------- | ---------------------------------------------- |
| Unit slug            | `desktop-web-event-stream`                     |
| Reviewer             | ax-code-glm                                    |
| Model                | zai-coding-plan/glm-5.2[1m]                    |
| Independent verifier | codex-sol                                      |
| Scope root           | `desktop/packages/web/server/lib/event-stream` |
| Date                 | 2026-08-11                                     |

This is an independent 9-step pass over the candidate sources listed in the
unit brief. Each section cites concrete `file:line` evidence from the files
read in this run.

## Step 1 Scope and inventory

The unit is a self-contained event-stream subsystem under
`desktop/packages/web/server/lib/event-stream/`. The barrel `index.js:1-21`
re-exports 20 symbols split across four concerns:

- Protocol constants and frame helpers — `protocol.js:1-127` (paths at
  `protocol.js:1-2`, heartbeat interval at `protocol.js:3`, WS buffer caps at
  `protocol.js:8` and `protocol.js:12`, SSE parser at `protocol.js:14-65`,
  WS frame senders at `protocol.js:67-118` and `protocol.js:120-127`).
- Upstream SSE reader with stall/reconnect — `upstream-reader.js:51-251`
  (loop at `upstream-reader.js:98-235`, exported constants at lines 3-5).
- Shared global fan-out hub with bounded replay — `global-hub.js:7-169`
  (replay limit at `global-hub.js:5`, replay lookup at `global-hub.js:152-167`).
- WS glue — `global-ws-bridge.js:4-234`, `directory-ws-bridge.js:5-221`,
  and the runtime that wires `WebSocketServer` — `runtime.js:46-174`.

The health-check predicate `upstream-health.js:1-11` is a single pure helper
(11 LOC) consumed by both bridges. Test helpers live in `test-helpers.js:1-34`
(`createSseResponse`). The runtime is the only file that leaves the folder —
it imports `parseRequestPathname` from `../terminal/index.js`
(`runtime.js:3`).

## Step 2 Threat and failure model

Two dominant failure classes shape this subsystem:

1. **Upstream unavailability / stalls.** The reader at
   `upstream-reader.js:147-156` reports non-`ok` responses as
   `upstream_unavailable`; the stall timer at `upstream-reader.js:121-124`
   aborts the active controller and reconnects with `Last-Event-ID` (header
   set at `upstream-reader.js:138-140`). The bridges translate
   `upstream_unavailable` into a `1011` close plus an `error` frame before
   the client is marked ready (`directory-ws-bridge.js:179-195`,
   `global-ws-bridge.js:119-138`) so a never-ready client does not wedge.
2. **Slow / dead WS clients.** `sendMessageStreamWsFrame`
   (`protocol.js:74-89`) closes the socket with `1013` when
   `bufferedAmount` exceeds `MESSAGE_STREAM_WS_MAX_BUFFERED_BYTES`, both
   before and after `socket.send`, and emits a one-shot backpressure
   warning at `protocol.js:95-109`.

Auth/origin enforcement for the WS upgrade is centralised in
`runtime.js:123-137`: when `uiAuthController.enabled`, the handler awaits
`ensureSessionToken` (401 on miss) and `isRequestOriginAllowed` (403 on
reject). Failures fall through to `rejectWebSocketUpgrade`.

## Step 3 Correctness of public surfaces

The hot public behaviours were checked against their implementations:

- **Replay semantics** — `global-hub.js:152-167`. When the requested
  anchor was evicted from the bounded buffer, the function returns the
  full buffer slice rather than `[]`, with an inline justification at
  `global-hub.js:161-166`. The behaviour is locked by
  `global-hub.test.js:85-122` (asserts `evt-2`,`evt-3` recovery when
  `evt-1` is evicted at `replayLimit: 2`).
- **Hub fan-out resilience** — `global-hub.js:25-36` (`notifySubscriber`)
  wraps each subscriber call so a sync throw or async rejection is logged
  but never breaks the fan-out loop. Covered by
  `global-hub.test.js:24-54` and `global-hub.test.js:124-156`.
- **WS wedge fix** — `global-ws-bridge.js:140-166`. After
  `everConnected`, upstream failures arrive as `status.type === "error"`
  rather than `"initial-error"`. The handler explicitly walks non-ready
  clients and gives them the same error-frame + `1011` close treatment,
  with the rationale comment at `global-ws-bridge.js:144-150`. Without
  this branch such clients would sit in `clients` forever, pinged but
  never readied.
- **Stall recovery** — `upstream-reader.js:121-128` resets the timer on
  every chunk (`upstream-reader.js:172`) and on connect
  (`upstream-reader.js:164`); on stall it sets `abortReason` and aborts
  the per-iteration controller, which exits the read loop and reconnects.
  Verified end-to-end by `runtime.test.js:450-512` (asserts two fetches
  with `Last-Event-ID` `[null, "evt-1"]` and no health-check trigger).
- **Stop listener hygiene** — `upstream-reader.js:71-89` plus the
  `.finally` detach at `upstream-reader.js:236-239`. The
  `createTrackedSignal` test at `upstream-reader.test.js:192-227` asserts
  listener count returns to 0 after stop.

## Step 4 Performance and resource handling

- **N+1 avoidance on the global path.** All clients on
  `/api/global/event/ws` share a single upstream reader through the hub
  (`runtime.js:67-84`, `global-hub.js:56-114`). The test at
  `runtime.test.js:96-149` connects two sockets and asserts `fetchCalls`
  is exactly `1`.
- **Per-directory isolation.** Directory sockets each get their own
  reader (`directory-ws-bridge.js:131-201`). This is correct because each
  directory stream is a logically distinct upstream resource; the test at
  `runtime.test.js:212-255` confirms two directories produce two fetches
  with the right `directory` query params.
- **Bounded replay buffer.** `global-hub.js:91-93` splices the front of
  the array once it exceeds `replayLimit` (default 2048,
  `global-hub.js:5`), capping memory growth for long sessions.
- **Timers and intervals are unref'd.** `pingInterval.unref` /
  `heartbeatInterval.unref` at `directory-ws-bridge.js:64,82`,
  `global-ws-bridge.js:179,195`; stall timer `unref` at
  `upstream-reader.js:127`; reconnect-delay timer `unref` at
  `upstream-reader.js:28`. None of these keep the Node process alive on
  shutdown.
- **Body cancellation.** `upstream-reader.js:45-49` defines
  `cancelResponseBody`, called at `upstream-reader.js:153` for
  non-`ok` responses. The unavailable-body test at
  `upstream-reader.test.js:144-190` asserts the body's `cancel` ran.
- **Reader cleanup on close.** `directory-ws-bridge.js:25-31` and
  `global-ws-bridge.js:16-21` both delete the socket from the shared
  `wsClients` set, and `global-ws-bridge.js:55-59` stops the hub when the
  bridge owns it and the last client leaves.

## Step 5 Design and module boundaries

Layering is clean and unidirectional:

`protocol.js` (pure) → `upstream-reader.js` (one upstream) →
`global-hub.js` (fan-out + replay) → `*-ws-bridge.js` (WS glue) →
`runtime.js` (server wiring). No layer reaches backwards except
`upstream-reader.js:1` importing `parseSseEventEnvelope` from
`protocol.js`, which is the correct direction.

The hub injection seam at `runtime.js:60-75` (`globalEventHub` parameter
with `ownsGlobalHub` derived at `runtime.js:66`) lets a caller share one
hub across multiple runtimes. The `ownsGlobalHub` flag then propagates to
both stop paths (`global-ws-bridge.js:55-59,77-80,222-224`).

One coupling smell: the broadcaster at `runtime.js:15-44` treats SSE and
WS clients asymmetrically. The WS branch at `runtime.js:38-40` deletes a
socket whose `send` throws, but the SSE branch at `runtime.js:24-29`
swallows `writeSseEvent` failures with an empty catch and leaves the dead
`res` in `sseClients`. Over a long session this can leak unresponsive SSE
responses. Recommend mirroring the WS branch: on throw, remove `res` from
`sseClients`.

The double bookkeeping in the bridges (`clients`/`readyClients` plus the
shared `wsClients` set) is intentional — `wsClients` is the registration
set for synthetic UI broadcasts (see `runtime.js:32-41`), while the
bridge-private sets gate event delivery on the `ready` frame
(`global-ws-bridge.js:84-86,98-100`). It is correct but worth a one-line
comment near `wsClients.add(socket)` at `global-ws-bridge.js:51` and
`directory-ws-bridge.js:165`.

## Step 6 Hygiene, dead code, comments

- **Empty catches.** Ten sites are listed in
  `findings/AUDIT-desktop-web-event-stream-empty-catch.md`. Most are
  defensible best-effort closes/pings (`protocol.js:76-78,86-88`,
  `global-ws-bridge.js:64-67,162-164,175-177`,
  `directory-ws-bridge.js:46-50,58-60,212-216`,
  `runtime.js:160-163`). The two that warrant a closer look are
  `runtime.js:24-29` (SSE leak, discussed in Step 5) and
  `runtime.js:142-144` (the upgrade-handler catch swallows the underlying
  error and only reports `"Upgrade failed"` — adding a `console.warn` of
  the caught error would help diagnose auth/origin regressions).
- **Exported but unused in-module.** `UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS`
  (`upstream-reader.js:4`) is exported through `index.js:17` but not
  consumed inside this folder. Likely used by a caller that ramps the
  stall window under concurrency; leaving the export is fine, but a
  one-line comment naming the caller would prevent accidental removal.
- **`parseSseEventEnvelope` leniency.** `protocol.js:14-65` accepts an
  `event:` line but ignores its value (only `id:` and `data:` are
  extracted). This is intentional leniency for the AX Code SSE shape; no
  change needed, but worth noting if a future consumer wants
  `event:`-typed dispatch.
- **Comment quality is genuinely high.** The buffer-size rationale at
  `protocol.js:4-8`, the wedge-fix rationale at
  `global-ws-bridge.js:144-150`, the replay-fallback rationale at
  `global-hub.js:161-166`, and the unref rationales at
  `upstream-reader.js:26-27,125-127` all explain _why_, not _what_.

## Step 7 Test coverage

Strong coverage on the protocol, reader, hub, and runtime layers:

- `protocol.test.js:13-177` — 7 cases including the
  `bufferedAmount > MAX` close path (`:66-88`), the one-shot backpressure
  warning (`:90-109`), the no-repeat-while-above-threshold guard
  (`:111-128`), and the drain-resets-flag path (`:130-153`).
- `upstream-reader.test.js:28-227` — 5 cases including the
  `\r\n`-normalisation assertion (`:39,49-57`), the stall → reconnect with
  `Last-Event-ID` (`:61-101`), the per-read-window dynamic timeout
  (`:103-142`), the unavailable-body cancel assertion (`:144-190`), and
  the listener-count-after-stop assertion (`:192-227`).
- `runtime.test.js:95-561` — 8 cases that exercise the runtime end-to-end
  including the shared-upstream invariant (`:96-149`), the
  `lastEventId` replay (`:151-210`), per-directory fetch isolation
  (`:212-255`), the 503 → health-check path (`:348-396`), and the
  synthetic-event fan-out (`:514-561`).
- `global-hub.test.js:23-156` — 4 cases covering sync-throw fan-out,
  status-subscriber throw, the eviction-replay fallback, and async-reject
  fan-out.

Gaps worth noting:

- **No direct unit tests for `global-ws-bridge.js` or
  `directory-ws-bridge.js`.** They are exercised only transitively through
  `runtime.test.js`. The wedge-fix branch at `global-ws-bridge.js:140-166`
  and the synthetic-forward callback at
  `directory-ws-bridge.js:108-113` would benefit from direct unit cases
  that do not depend on the reader's async timing.
- **No direct test for the trailing-buffer flush** at
  `upstream-reader.js:196-211` (final block emitted without a trailing
  `\n\n`). Add a fixture whose last block has no terminator and assert
  `onEvent` still fires once.
- **No SSE failure test for the broadcaster.** The asymmetric SSE/WS
  behaviour in `runtime.js:23-29` is not asserted anywhere; a test that
  has `writeSseEvent` throw and checks `sseClients.size` would lock the
  fix recommended in Step 5.

## Step 8 Findings register

One finding is on file for this unit:

- `findings/AUDIT-desktop-web-event-stream-empty-catch.md` —
  `silent-error`, **Medium**, 10 sites, status `deferred`, expiry
  2026-09-11. Per-site dispositions: 4 `needs-log`
  (`global-ws-bridge.js:66,163`, `protocol.js:77,87`),
  6 `review-needed` (`directory-ws-bridge.js:50,60,216`,
  `global-ws-bridge.js:177`, `runtime.js:27,162`).

This review confirms the Medium rating: every site is a best-effort close,
ping, terminate, or write where swallowing the error is defensible, with
the two real concerns being the SSE write-failure leak at `runtime.js:27`
and the swallowed upgrade error at `runtime.js:142-144`. **No Critical
findings were raised in this pass**, and the existing Medium finding does
not block the gate.

A minor follow-up is suggested (not filed as a new finding because the
fix is one line and the blast radius is tiny): add `sseClients.delete(res)`
inside the catch at `runtime.js:27` to mirror the WS branch at
`runtime.js:38-40`.

## Step 9 Verification and sign-off

Evidence for this review:

- All 14 candidate source files under
  `desktop/packages/web/server/lib/event-stream/` were read in full this
  run (see `reviewer-run.json` → `filesRead`).
- `MODULE-AUDIT.md` and
  `findings/AUDIT-desktop-web-event-stream-empty-catch.md` were read to
  align with the existing finding ledger.
- The 9-step pass above is grounded in specific `file:line` citations
  from those files.

The existing test suite for this unit lives in the same folder
(`*.test.js`) and runs under the desktop vitest configuration per
`AGENTS.md` (`pnpm --dir desktop exec vitest run <file>`). The test cases
cited in Step 7 exercise the protocol helpers, the upstream reader, the
global hub, and the runtime; they back the correctness claims in Steps 3
and 4.

No Critical findings exist for this unit, so no `reverify.md` is required
for the gate. The independent verifier lane (codex-sol) can confirm by
re-reading the same evidence paths and the single Medium finding.

Reviewer sign-off: ax-code-glm on 2026-08-11. Independent verifier
(codex-sol) pending.
