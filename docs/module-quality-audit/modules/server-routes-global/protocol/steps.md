# Protocol Steps — server-routes-global

Unit: `server-routes-global`
Primary file: `packages/ax-code/src/server/routes/global.ts` (503 LOC, single export `GlobalRoutes`)
Reviewer: ax-code-glm · Verifier: codex-sol · Date: 2026-08-11

## Step 1 Scope and map

The unit is a single Hono sub-app built lazily (`global.ts:231` `export const GlobalRoutes = lazy(() => new Hono()…)`). It mounts seven routes onto the `/global` prefix: `GET /health` (`:233`), `GET /capabilities` (`:258`), `GET /event` SSE (`:280`), `GET /config` (`:381`), `PATCH /config` (`:402`), `POST /dispose` (`:427`), `POST /upgrade` (`:456`). Two named helpers carry the real logic: `getGlobalHealthInfo` (`:159`) and `getGlobalCapabilitiesInfo` (`:180`); readiness derivation lives in `readinessFromServices` (`:137`). The module imports redaction helpers from a sibling `./config` (`:15`) and the SSE backpressure primitive from `../sse-queue` (`:17`, re-export of `@/util/sse-queue`). No other unit owns these surfaces, so the file under review is the complete boundary.

## Step 2 Threat and failure model

Risk tags are `network, api`. Three concrete exposures: (a) `GET /health?directory=` at `:251-255` accepts an arbitrary caller-supplied path, applying only a null-byte guard (`if (directory?.includes("\0"))`) before `Filesystem.resolve(rawDirectory || process.cwd())` at `:111` and `ServiceManager.peek(directory)` at `:112` — a local caller can probe runtime/service state for any path on disk. (b) `POST /upgrade` at `:485-501` runs `Installation.upgrade(method, target)` (`:492`) with no authn/authz gate; any process that can reach the loopback socket can replace the binary. (c) `POST /dispose` at `:444-454` tears down every instance via `Instance.disposeAll()` with no idempotency check. These are consistent with the local-first server model documented elsewhere, but the upgrade/dispose surfaces in particular warrant explicit trust-boundary confirmation rather than silent assumption.

## Step 3 Correctness of control flow

`SERVER_STARTED_AT = Date.now()` at `:23` is captured at module-eval time. Because `GlobalRoutes` itself is wrapped in `lazy()` (`:231`), and the routes file is only constructed on first hit, `startedAt`/`uptimeMs` reported in `getGlobalHealthInfo` (`:166-167`) reflect module-load time, not process-start time — the two diverge whenever the route is touched after boot. In `readinessFromServices` (`:137-157`) the expression `ServiceManager.peek(runtime.directory)?.snapshot().tasks.filter(...) ?? []` (`:141-143`) is safe because the optional chain short-circuits the whole postfix; the `?? []` only fires when `peek` is absent. The SSE teardown in `GET /event` (`:310-378`) is idempotent: `stop()` guards on `done` (`:316`) and is registered both on `stream.onAbort(stop)` (`:368`) and the `finally` block (`:375-377`), so double-fire is harmless. Version parsing in `POST /upgrade` uses `semver.valid(semver.coerce(rawTarget))` (`:488`) and rejects with `invalidRequest` (`:490`) — coercing then validating is the correct order for loose user input.

## Step 4 Performance and resource behavior

`getGlobalHealthInfo` (`:159`) calls `getRuntimeHealthInfo(rawDirectory)` which snapshots once at `:112`, then invokes `readinessFromServices` twice (`:173` providers, `:174` index). Each `readinessFromServices` call re-asks `ServiceManager.peek(runtime.directory)?.snapshot()` at `:141-143`, so a single `/health` request triggers three `snapshot()` computations on the service manager. If `snapshot()` walks tasks/services maps this is wasted work on a hot liveness endpoint; passing the already-computed `runtime.tasks`/`runtime.services` into `readinessFromServices` instead of re-peeking would remove the duplication. The SSE path caps data frames via `pushSseFrame` (SSE_HARD_MAX 4096, `sse-queue.ts:9`) at `:329`, and control frames via a local `CONTROL_FRAME_QUEUE_LIMIT = 256` at `:335`; the heartbeat interval is `unref`-ed at `:361` so it cannot keep the event loop alive on its own — both correct backpressure choices.

## Step 5 Design and cohesion

One file fuses five distinct concerns: health/readiness, capability advertisement, SSE event fan-out, config get/set (delegated to `./config`), and lifecycle mutation (dispose/upgrade). The capability block duplicates values between the Zod schema `GlobalCapabilitiesInfo` (`:61-108`) and the literal-returning `getGlobalCapabilitiesInfo()` (`:180-229`) — endpoint paths (`/global/health`, `/global/event`, …), feature flags, and event-name strings each appear in both places, so renaming a route requires editing two coordinated literals. A single source-of-truth object feeding both the schema `.literal(...)` and the runtime return would eliminate the drift risk. Splitting `dispose`/`upgrade` into a `lifecycle.ts` sibling (mirroring the existing `config.ts` split) would also reduce the surface area of this 503-line file, though it is not yet large enough to be urgent.

## Step 6 Hygiene and dead code

No empty `catch` blocks and no `TODO` markers exist in the file (confirmed by audit and by reading). All imports are exercised: `streamSSE` (`:4`) at `:310`, `pushSseFrame` (`:17`) at `:329`, `redactConfig`/`stripRedactedConfig` (`:15`) at `:399`/`:422`/`:424`, `errors`/`invalidRequest` (`:16`) at `:417`/`:476`/`:253`/`:490`, `Event` (`:18`) at `:343`/`:449`. The `using _ = log.time("providers")` pattern is not used here (it lives in `config.ts:205`); the local `log` at `:22` is only exercised for `log.info`/`log.warn` in the SSE path (`:307`, `:324`, `:358`). `compatibility.minDesktopVersion: null` (`:186`) is intentionally null rather than dead. No unreachable branches detected in `readinessFromServices` despite the dense conditional ladder at `:144-156`.

## Step 7 Tests and verification coverage

The audit ledger lists adjacent tests (`capability.test.ts`, `app-context-routes.test.ts`, `audit-route.test.ts`, `workspace-server-sse.test.ts`) but no dedicated `global.test.ts` targeting this file. Specific behaviors that lack direct coverage signals: the `done`-guarded double teardown of the `/event` SSE stream (`:315-325`), the `semver.coerce`+`valid` rejection path in `/upgrade` (`:488-491`), the triple-`snapshot()` path in `/health` (`:112`,`:141`,`:173-174`), and the `Disposed` emission after `Instance.disposeAll()` (`:445-453`). Adding focused tests for the upgrade-validation and dispose-emit branches would close the highest-value gaps; the SSE backpressure path is partially exercised by `control-plane/workspace-server-sse.test.ts`.

## Step 8 Findings register

Findings accepted by this primary review (no Critical severity; verifier second-pass not triggered):

| #   | Severity | Category                | Location                            | Note                                                                                               |
| --- | -------- | ----------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| F1  | MEDIUM   | design/duplication      | `global.ts:61-108` vs `:180-229`    | Capability literals duplicated between schema and producer; drift hazard.                          |
| F2  | MEDIUM   | security/trust-boundary | `global.ts:485-501`                 | `/upgrade` performs binary replacement with no auth gate; confirm intended trust boundary.         |
| F3  | LOW      | performance             | `global.ts:112,141,173-174`         | `snapshot()` invoked three times per `/health`; pass runtime into readiness helper.                |
| F4  | LOW      | correctness/timing      | `global.ts:23,166-167`              | `SERVER_STARTED_AT` captured at module eval, diverges from process start when route is lazily hit. |
| F5  | LOW      | security/enumeration    | `global.ts:251-255`                 | `/health?directory=` allows arbitrary path probing with only null-byte guard.                      |
| F6  | INFO     | test-coverage           | `global.ts:445-453,488-491,315-325` | Dispose/upgrade/SSE-teardown branches lack dedicated unit tests.                                   |

No Critical findings → no `reverify.md` required for the gate.

## Step 9 Verification and exit

Verification commands for this unit (node workspace, per `AGENTS.md`): `pnpm --dir packages/ax-code run typecheck` (typecheck the core package that owns `src/server/routes/global.ts`) and `pnpm run test:scripts` (root script tests). Targeted route test execution: `AX_TEST_FILES=test/server/capability.test.ts,test/server/app-context-routes.test.ts,test/control-plane/workspace-server-sse.test.ts pnpm --dir packages/ax-code exec vitest run`. OpenAPI drift check (relevant because `describeRoute` annotations here feed the generated SDK): `pnpm --dir packages/sdk/js run build` followed by the CI drift gate. Static extract fingerprint `c6d9e45c94c725d8` from the MODULE-AUDIT matches the file as read (503 LOC, 1 export). Exit checklist: map ✅, findings ledger consistent (6 rows above, no Critical) ✅, full 9-step protocol completed this run ✅, sign-off roles: primary reviewer ax-code-glm done, independent verifier codex-sol pending its second pass.
