# Review Protocol — unit `bus`

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Scope: `packages/ax-code/src/bus` — three files: `bus-event.ts`, `global.ts`, `index.ts`.
Baseline commit: `94e95c161c7deb8e055d8806a5f285e516285715`.

## Step 1 Scope and map

The `bus` unit is a small (217 LOC across 3 files) in-process event layer with two distinct buses that the rest of the runtime leans on heavily (131 publish/subscribe callsites across `session/`, `provider/`, `pty/`, `lsp/`, `server/routes`, etc.).

- `packages/ax-code/src/bus/bus-event.ts:4` — `BusEvent` namespace: a module-level `registry: Map<string, Definition>` (`bus-event.ts:7`) populated by `define()` (`bus-event.ts:9`), plus `payloads()` (`bus-event.ts:18`) that materializes the registry into a Zod discriminated union used as the OpenAPI response schema at `server/routes/event.ts:29`.
- `packages/ax-code/src/bus/global.ts:3` — `GlobalBus`, a process-wide typed `EventEmitter` raised to `setMaxListeners(200)` (`global.ts:19`).
- `packages/ax-code/src/bus/index.ts:9` — `Bus` namespace: instance-scoped subscription map held in `Instance.state(...)` (`index.ts:22`) with a dispose hook, and the `publish` / `publishDetached` / `subscribe` / `once` / `subscribeAll` surface.

Exports reconcile exactly with MODULE-AUDIT §1 (12 exports). No stray files.

## Step 2 Threat and failure model

The unit's risk tag is `concurrency`; that is the right lens. The fail-prone surfaces I traced:

1. Subscriber invocation in `deliver()` (`index.ts:43`) — a throwing or never-resolving subscriber could block or poison a publish. Mitigated by wrapping each call in `withTimeout(..., BUS_SUBSCRIBER_TIMEOUT_MS=10_000)` (`index.ts:11`, `index.ts:45-51`) with a dedicated `.catch` that logs (`index.ts:51`). The underlying `withTimeout` (`util/timeout.ts:10`) unrefs the timer and guards against post-timeout unhandled rejections. This is sound.
2. Iteration during mutation: `raw()` mutates arrays in place (`index.ts:143` push, `index.ts:152` splice). `prepare()` defends by snapshotting `[...state().subscriptions.get(key) ?? []]` (`index.ts:68`) before iterating, so a subscriber that unsubscribes itself or adds a subscription mid-deliver cannot corrupt the active loop. Sound.
3. Unbounded listener growth on `GlobalBus`: addressed structurally by `setMaxListeners(200)` plus per-SSE `off()` on disconnect (`server/routes/global.ts:320`). See Step 4 for the ceiling choice.

No file/process/secret IO in this unit; `Instance.directory` is the only value that crosses the boundary (`index.ts:37`, `index.ts:81`) and it is a path string already trusted inside the instance context.

## Step 3 Correctness — control flow of the public surface

- `publish()` (`index.ts:86`) → `prepare()` then `emitGlobal()` then `await Promise.all(pending)`. Delivery order: the `for (const key of [def.type, "*"])` loop (`index.ts:67`) means typed subscribers fire before wildcard subscribers for a given event; within a key, array order is preserved. `publishDetached()` (`index.ts:100`) reuses `prepare()`/`emitGlobal()` but detaches with `void Promise.all(pending).catch(...)` (`index.ts:106`) — the two are genuinely different semantics, and `test/bus/publish-callsite.test.ts` is an AST guardrail that forbids non-awaited `Bus.publish` callsites repo-wide, explicitly tied to a prior "hang cleanup" regression (see test message lines 56-60).
- `subscribe()` → `raw(def.type, ...)` (`index.ts:119`); `subscribeAll()` → `raw("*", ...)` (`index.ts:136`). `raw()` returns an idempotent unsubscribe (`index.ts:146-153`): re-entry after a prior splice is a no-op via the `indexOf === -1` guard. Correct.
- `once()` (`index.ts:122`) wraps `subscribe` and self-unsubscrives when the callback returns `"done"`. The sentinel return type is unusual (Step 6).
- **Correctness gap (MEDIUM):** the dispose hook registered at `index.ts:30-41` only delivers `InstanceDisposed` to wildcard subscribers: `const wildcard = entry.subscriptions.get("*")` (`index.ts:31`). A consumer that registers via the typed API — `Bus.subscribe(Bus.InstanceDisposed, cb)` — lands under key `"server.instance.disposed"` and is silently skipped at instance teardown. `InstanceDisposed` is an exported, typed event (`index.ts:15`), so the typed form looks valid but would never fire on disposal. Today the only in-repo consumer is `server/routes/event.ts:118`, which uses `subscribeAll` and then string-compares `event.type === Bus.InstanceDisposed.type`, so there is no live breakage — but the asymmetry is a latent footgun and a contract violation between the exported typed API and actual disposal behavior.

## Step 4 Performance

Hot path is `publish`/`publishDetached` for high-frequency events (`session/index.ts:1053` `MessageV2.Event.PartDelta`, `tool/monitor.ts:103` `MonitorLine`). `prepare()` is O(subscribers per key): one `Map.get` + one spread per key over `[def.type, "*"]`. No allocation explosion, no hidden awaits in the fan-out (each subscriber is wrapped once in `deliver`). The 10s per-subscriber timeout caps total worst-case `publish` latency at roughly `10s × N` for N subscribers on one key, but in practice subscribers are few and fast; acceptable.

`payloads()` (`bus-event.ts:18`) rebuilds the discriminated union by iterating the registry, but it is invoked exactly once behind the `lazy(...)` route initializer (`server/routes/event.ts:17`), not per request — no concern.

`GlobalBus` `setMaxListeners(200)` (`global.ts:19`): the accompanying comment justifies the ceiling by the `/global/event` SSE route, and that route does attach one `GlobalBus.on("event", handler)` per connected client (`server/routes/global.ts:366`) removed on disconnect (`global.ts:320`). The 200 figure is a magic number with no metric/backpressure signal when approached; LOW.

## Step 5 Design

Two coexisting buses is intentional and defensible: `Bus` is instance-scoped (keyed by `Instance.directory` via `Instance.state`, `index.ts:22`), while `GlobalBus` is the cross-instance/process fan-out used by the control-plane workspace server (`control-plane/workspace-server/server.ts:86`), the TUI worker (`cli/cmd/tui/worker.ts:105`), and the `/global/event` route. `publish()` bridges them: local typed/wildcard delivery first, then `emitGlobal()` (`index.ts:79-84`) re-broadcasts the same payload process-wide tagged with `directory`. Consumers filter by directory (`server/routes/event.ts:110` `shouldForward`, `server/routes/global.ts`). This is a coherent directory-tagged broadcast design, not accidental duplication.

Registry pattern in `bus-event.ts` (module-level `Map`, populated by `define()` at module load of whatever file declares an event) keeps event declaration co-located with owners. The only wrinkle: `payloads()` reflects whatever has been imported by the time it runs — `server/routes/event.ts:12` does `import "@/notification/events"` to ensure side-effect registration, indicating the registry is import-order-sensitive. Documented implicitly; not a defect.

## Step 6 Dead code and hygiene

No empty catches, no TODOs, no unreachable branches found. Minor type-erosion points:

- `type Subscription = (event: any) => void` (`index.ts:12`) — the public `subscribe` is generic over the `Definition`, but internally callbacks collapse to `any`. Acceptable for a fan-out helper, but it means a wrong-shape payload would not be caught internally.
- `payloads()` casts the member array `as any` (`bus-event.ts:34`) to satisfy Zod's `discriminatedUnion` overload; a localized escape hatch, not a type lie that reaches callers.
- `once()`'s `"done" | undefined` sentinel (`index.ts:127`) is a stringly-typed gate where a boolean read more naturally. Cosmetic.

The `deliver()` double-catch (inner `.catch` for subscriber throw at `index.ts:48`, outer `.catch` for timeout at `index.ts:51`) is intentional and commented; not dead code.

## Step 7 Tests

`test/bus/bus.test.ts` exercises the three load-bearing semantics: `publish` awaits async subscribers (lines 20-55), `publishDetached` returns before subscribers finish (lines 57-100), and detached delivery preserves sequential order for synchronous subscribers (lines 102-124). `test/bus/publish-callsite.test.ts` is a repo-wide TypeScript AST lint that fails if any `Bus.publish(...)` is neither awaited nor returned — a strong regression guard tied to a real past incident.

Gaps in coverage: (a) no test asserts the `Instance.state` dispose hook actually delivers `InstanceDisposed` to wildcard subscribers on `Instance.disposeAll()` — the Step 3 correctness gap is therefore uncaught by the suite; (b) no test for the 10s subscriber timeout path; (c) no test for subscriber-throw isolation (a throwing subscriber not blocking siblings). None of these are release-blocking, but (a) is the one that would surface the typed-vs-wildcard asymmetry.

## Step 8 Findings

| #   | Severity | Finding                                                                                                                                                                                                       | Location                                |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | MEDIUM   | Dispose hook delivers `InstanceDisposed` only to wildcard (`*`) subscribers; typed `Bus.subscribe(Bus.InstanceDisposed, cb)` would silently never fire on teardown. Latent — no in-repo typed callsite today. | `packages/ax-code/src/bus/index.ts:31`  |
| 2   | LOW      | `GlobalBus.setMaxListeners(200)` is an unjustified-by-metric magic ceiling; no telemetry warns when approaching the limit, only Node's `MaxListenersExceededWarning` once breached.                           | `packages/ax-code/src/bus/global.ts:19` |
| 3   | LOW      | Internal `Subscription = (event: any) => void` erases the generic payload type inside `deliver`/`raw`.                                                                                                        | `packages/ax-code/src/bus/index.ts:12`  |
| 4   | LOW      | `once()` uses a `"done" \| undefined` string sentinel instead of a boolean for its "keep subscribing?" gate.                                                                                                  | `packages/ax-code/src/bus/index.ts:127` |

No Critical or High findings. Because there are no Critical items, no `reverify.md` second-pass is required for this unit.

## Step 9 Verification

This is a read-only architecture review; no source edits were made to the `bus` unit, so no test/typecheck re-run is mandated by this protocol step. The evidence above is grounded in direct reads of `packages/ax-code/src/bus/bus-event.ts`, `packages/ax-code/src/bus/global.ts`, `packages/ax-code/src/bus/index.ts`, `packages/ax-code/src/project/state.ts`, `packages/ax-code/src/util/timeout.ts`, `packages/ax-code/src/server/routes/event.ts`, `packages/ax-code/src/server/routes/global.ts`, `test/bus/bus.test.ts`, and `test/bus/publish-callsite.test.ts`, plus callsite enumeration of all 131 `Bus.publish*`/`subscribe*` references. Sign-off: primary reviewer ax-code-glm complete; independent verifier codex-sol to confirm the MEDIUM finding at `index.ts:31` and the four LOW items.
