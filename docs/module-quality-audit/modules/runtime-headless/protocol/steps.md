# runtime-headless — 9-step module review

- Reviewer: `ax-code-glm` (model `zai-coding-plan/glm-5.2[1m]`)
- Independent verifier lane: `codex-sol`
- Unit slug: `runtime-headless`
- Scope: `packages/ax-code/src/runtime/headless`
- Date: 2026-08-11

This is an independent primary review of the `runtime-headless` unit. All line
references below were taken from the source files read for this run
(`packages/ax-code/src/runtime/headless/*.ts`). No Critical findings resulted;
`findings/` is empty and the MODULE-AUDIT ledger records none accepted.

## Step 1 Scope and boundaries

The unit is 11 files (~1407 LOC). `packages/ax-code/src/runtime/headless/index.ts:1-9`
re-exports the eight sibling modules, so the public surface is the union of
their exports. Three concerns are cleanly separated:

1. Contract surface — `command.ts` (command union + body types) and `event.ts`
   (event union + guards + schema version).
2. Pure event-sourced reducer — `projection.ts` (443 lines, the largest file),
   which mutates `HeadlessProjectionState` in place and returns side-effect
   descriptors instead of performing I/O.
3. I/O and transport — `event-sink-node.ts` (fs JSONL writer), `event-sink.ts`
   (sink composition), `runtime.ts` (HTTP + SSE via `@ax-code/sdk`), and
   `runner.ts` (subscription orchestration).

Side effects are deferred to `effects.ts`, keeping the reducer referentially
transparent with respect to the outside world. This is a healthy boundary for a
hot-path module.

## Step 2 Contract and event model

`command.ts:58-88` defines the `HeadlessRuntimeCommand` discriminated union over
six command kinds; `commandAcceptsAsyncMode` (`command.ts:94-96`) correctly
restricts async mode to `session.prompt` / `session.command` / `session.shell`,
matching the routes dispatched in `runtime.ts:60-79`.

`event.ts:84-101` unions seven event families. `HEADLESS_RUNTIME_SCHEMA_VERSION`
(`event.ts:3`) versions the wire shape. `isHeadlessRuntimeEvent`
(`event.ts:174-177`) validates against the `HEADLESS_RUNTIME_EVENT_TYPES` set
(`event.ts:107-165`). That set is a hand-maintained second source of truth
alongside the union type — drift would silently drop events during decode
(`event-log.ts:38`). The compile-time backstop is the exhaustive switch in
`projection.ts:260-261` (see Step 3), so a missing handler is caught at build
time even if the runtime set lags; still, the set and the union can diverge for
events that are valid-but-unhandled (e.g. `provider.updated`, `scheduled.task.*`
return `handled:false` intentionally at `projection.ts:173-176` and `224-225`).

## Step 3 Correctness of the reducer

`applyHeadlessProjectionEvent` (`projection.ts:79-262`) is an exhaustive switch
terminated by `const _exhaustive: never = event` (`projection.ts:260-261`), so
adding a union member without a case is a compile error — a strong correctness
guarantee for a 50+ case reducer.

- `upsertByID` (`projection.ts:321-328`) and `removeByID` (`projection.ts:431-436`)
  both rely on the list being sorted by `id`; the only insertion path maintains
  that invariant via `Binary.search`, so lookups are consistent.
- `shiftOverflow` (`projection.ts:438-443`) falls back to
  `DEFAULT_MAX_SESSION_MESSAGES = 100` (`projection.ts:6`) when
  `maxSessionMessages` is non-finite, and clamps with `Math.max(0, ...)` — no
  NaN/Infinity can reach `splice`.
- `session.error` without a `sessionID` is intentionally dropped
  (`projection.ts:158-161`), preventing a global error from polluting a
  per-session map keyed by `undefined`.
- The autonomous permission guard (`projection.ts:114`) defers to
  `Permission.isInteractiveOnly` (`packages/ax-code/src/permission/index.ts:208`)
  so isolation escalation and destructive bash stay human-gated even under
  `autonomous:true`. `question.asked`, by contrast, always auto-replies in
  autonomous mode (`projection.ts:126-133`) with no interactive-only check —
  this asymmetry appears deliberate (questions are answerable from their own
  payload) but is worth noting.

## Step 4 Effect handling and failure modes

`executeHeadlessProjectionEffect` (`effects.ts:28-59`) dispatches the four
effect kinds (`permission.auto_reply`, `question.auto_reply`, `runtime.probe`,
`bootstrap.reload`). `warnAsync` (`effects.ts:68-78`) wraps both sync throws and
async rejections into the `onWarn` callback.

The design issue: effects are fire-and-forget.
`executeHeadlessProjectionEffects` (`effects.ts:61-66`) loops without awaiting,
and `runner.ts:104-107` invokes it without awaiting before continuing to
`onEvent`. This is intentional decoupling, but the concrete gap is at
`runner.ts:106`: when `input.effects.onWarn` is unset the default is `() => {}`.
So a consumer that sets `autonomous:true` but forgets to wire `onWarn` will
silently swallow every `permission.auto_reply` / `question.auto_reply` /
`bootstrap.reload` failure. Recommendation: require `onWarn` whenever
`autonomous` is true (or fall back to a console.warn default) so autonomous
effect failures are never invisible.

## Step 5 Transport and command send

`runtime.ts:51-90` routes each command kind. `postJson` (`runtime.ts:103-127`)
throws on `!response.ok` with status and body text (`runtime.ts:116-119`),
returns `{accepted:true,status:202}` for accepted (`runtime.ts:120`), and parses
200 bodies via `parseHeadlessRuntimeJsonBody` (`runtime.ts:134-140`), which
surfaces JSON parse errors with a `cause`. `headlessHeaders`
(`runtime.ts:142-148`) folds in directory headers via `withDirectoryHeaders`.

Two `as any` casts at `runtime.ts:85` and `runtime.ts:88` bypass the SDK client
types for `permission.reply` / `question.reply`. This is a low-severity
type-safety leak: a malformed `HeadlessPermissionReplyBody` / `HeadlessQuestionReplyBody`
would not be caught at compile time. The body types are defined in
`command.ts:46-56`; tightening the SDK call signatures (or a runtime guard)
would close it.

`subscribe` (`runtime.ts:42-47`) `for await`s the stream and `await`s `onEvent`,
so a throwing `onEvent` rejects the subscription promise, which `runner.ts:120-124`
catches and converts into an abort — the error path is wired through.

## Step 6 Event log codec and durability

`event-log.ts:10-27` stringifies with a `WeakSet` circular guard that replaces
cycles with `"[Circular]"` and falls back to a
`headless.event_log.serialization_error` record on throw (`event-log.ts:21-26`),
so a single un-serializable record never aborts the whole stream — important for
a durability log. `eventCandidate` (`event-log.ts:59-62`) transparently unwraps
a `{details: event}` envelope (`HeadlessRuntimeEventEnvelope`, `event.ts:103-105`)
or accepts a bare event, giving dual-shape decode compatibility.

On the I/O side, `event-sink-node.ts:20-39` implements correct backpressure via
`drain` and cleans up listeners on both `drain` and `error`. `endStream`
(`event-sink-node.ts:41-60`) does ordered `finish`/`error` cleanup and guards
`stream.destroyed`. `createHeadlessFileJsonlEventSink` opens with `flags: "w"`
(`event-sink-node.ts:12`), i.e. each run truncates — this is an intentional
per-run log rather than an append log. The composite sink
(`event-sink.ts:16-25`) writes sequentially and closes in reverse insertion
order, which is the correct LIFO ordering for layered sinks.

## Step 7 Replay fidelity

`replay.ts` clones every event via `structuredClone` before applying
(`replay.ts:39`, `74`, `90`) so replay cannot mutate the source records —
necessary because `applyHeadlessProjectionEvent` mutates state in place and the
same record object may be replayed into multiple states. `replayHeadlessEvents`
(`replay.ts:24-45`) and `replayHeadlessEventLogLines` (`replay.ts:59-80`) share
near-identical loop bodies; the only divergence is
`decodeHeadlessEventLogRecord` vs `decodeHeadlessEventLogLine`. That is a small
extract-helper opportunity (not urgent). The `structuredClone` cost is
acceptable on the offline replay path and the hot runner path correctly avoids
cloning (`runner.ts:100`), so there is no performance concern in the live path.

## Step 8 Design, duplication, hygiene

The probe-key mapping is maintained twice inside `projection.ts`: once inline in
`applyHeadlessProjectionEvent` (`projection.ts:213-230` for mcp/lsp/index, and
`projection.ts:232-257` for the workflow block) and once standalone in
`runtimeProbeKeysForEvent` (`projection.ts:264-302`). The standalone function is
a real public API — it is asserted on in
`packages/ax-code/test/runtime/headless/projection.test.ts:256-261` and mirrored
in `packages/sdk/js/src/headless/projection.ts:252` — so it cannot be removed.
The inline copies could delegate to it so there is one truth source; otherwise a
new workflow event type must be added in three places (the type union, both
switch blocks). No empty catches and no TODOs across the unit (consistent with
the audit inventory table). Generics are heavy — up to nine type parameters on
`applyHeadlessProjectionEvent` (`projection.ts:79-91`) — which is verbose but
justified by the session/todo/diff/status/message/part/risk/goal/queue
dimensions; the readability cost is real but preferable to `any`.

## Step 9 Tests and verification

Direct unit tests cover the reducer
(`packages/ax-code/test/runtime/headless/projection.test.ts`, 433 lines):
stream-health transitions, autonomous permission and question effect emission,
the message cap, and explicit `runtimeProbeKeysForEvent` assertions
(`projection.test.ts:256-261`). The codec and fs sink are covered by
`test/runtime/headless/event-log.test.ts` and
`test/runtime/headless/event-sink-node.test.ts`. The autonomous
`Permission.isInteractiveOnly` guard at `projection.ts:114` is exercised by the
autonomy-on/off cases in `projection.test.ts:33+`. Runner orchestration
(`runner.ts`) and transport (`runtime.ts`) are exercised indirectly through the
`test/cli/tui/sync-*` suite and `test/cli/runtime-restart.test.ts`.

Test gap tied to the Step 4 finding: no test asserts the behavior when `onWarn`
is omitted while `autonomous:true`. Adding one would lock in the recommended
contract tightening (require or default `onWarn` under autonomy). No Critical
findings resulted from this review, so no Critical reverify pass is required for
`runtime-headless`; the recommended follow-ups are the MEDIUM/LOW items above.
