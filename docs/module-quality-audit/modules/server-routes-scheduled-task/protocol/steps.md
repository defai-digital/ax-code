# Reviewer Protocol — `server-routes-scheduled-task`

| Field                 | Value                                                                             |
| --------------------- | --------------------------------------------------------------------------------- |
| Unit slug             | `server-routes-scheduled-task`                                                    |
| Reviewer              | `ax-code-glm`                                                                     |
| Verifier (other lane) | `codex-sol`                                                                       |
| Model                 | `zai-coding-plan/glm-5.2[1m]`                                                     |
| Source under review   | `packages/ax-code/src/server/routes/scheduled-task.ts` (190 lines, single export) |
| Date                  | 2026-08-11                                                                        |

This protocol is the independent 9-step pass over the route module that mounts at
`/scheduled-task` via `packages/ax-code/src/server/server.ts:308`. Every endpoint here is a
thin validator + delegator into the `ScheduledTask` namespace at
`packages/ax-code/src/session/scheduled-task.ts`; the route layer itself owns no business logic.

## Step 1 Scope and boundary

`packages/ax-code/src/server/routes/scheduled-task.ts:29` exports exactly one symbol,
`ScheduledTaskRoutes`, constructed lazily via `lazy(() => new Hono()...)`. The chain defines
nine endpoints across 190 lines:

- `GET /` list (line 31)
- `POST /` create (line 52)
- `GET /:scheduledTaskID` get (line 69)
- `POST /:scheduledTaskID/update` (line 86)
- `POST /:scheduledTaskID/pause` (line 104)
- `POST /:scheduledTaskID/resume` (line 121)
- `POST /:scheduledTaskID/run-now` (line 138)
- `POST /run-due` (line 156)
- `DELETE /:scheduledTaskID` (line 173)

The router is mounted exactly once at `packages/ax-code/src/server/server.ts:308`
(`.route("/scheduled-task", ScheduledTaskRoutes())`). Boundary is clean: the module imports
only `Hono`, `hono-openapi`, the local `validator`/`error` helpers, `lazy`, `OptionalQueryNumber`,
and the `ScheduledTask` namespace plus its `ScheduledTaskID` schema. No storage, bus, or workflow
internals leak into this file.

## Step 2 Threat and input-trust model

Every request-shaped surface is gated by a zod schema through the central validator at
`packages/ax-code/src/server/validation.ts:4`, which calls `invalidRequest(c)` on parse failure
(returning a 400 envelope from `packages/ax-code/src/server/error.ts:260`). Concretely:

- Param surfaces use `SCHEDULED_TASK_ID_PARAM` (line 11) on get/update/pause/resume/run-now/delete.
- List query uses `ScheduledTaskListQuery` (line 13): `status` enum, `dueBefore`/`limit` as
  positive ints, `limit` capped at 500 via `OptionalQueryNumber(z.number().int().positive().max(500))`.
- Run-due query uses `ScheduledTaskRunDueQuery` (line 19) accepting an optional positive-int `now`.
- Create body uses `ScheduledTask.CreateInput`; update body strips `id` via
  `ScheduledTask.UpdateInput.omit({ id: true })` (line 23) and re-injects the path param at line 102,
  preventing body/client tampering with the target identity.

No string interpolation into SQL or shell exists in this layer. All data access is delegated to the
session module, which uses Drizzle parameterised queries (`packages/ax-code/src/session/scheduled-task.ts:252`).

## Step 3 Correctness of public surfaces

Each handler is `async (c) => c.json(await ScheduledTask.<op>(...))` — a pure delegator. Spot checks
against the session module:

- `runNow` route (line 154) → `ScheduledTask.runNow` at `packages/ax-code/src/session/scheduled-task.ts:375`,
  which guards `disabled` tasks with `HTTPException(409)` (line 378) and records failure via
  `recordRunFailure` before re-throwing (lines 406–411). The route does not need to repeat that guard.
- `runDue` route (line 171) → `ScheduledTask.runDue` at line 463; the route forwards `now` from
  `c.req.valid("query").now`, which is `undefined` when omitted, letting the session layer default to
  `Date.now()`. Correct.
- `update` route (line 102) merges path param and body as `{ id: scheduledTaskID(c), ...c.req.valid("json") }`.
  Because `ScheduledTaskUpdateBody` omits `id`, a client-supplied `id` in the JSON body would be silently
  dropped by the validator rather than overruling the path — desirable and intentional.

One observation (not a defect): the `run-due` query accepts arbitrarily large `now` values (no upper
bound). The session layer only uses `now` for comparison and `nextRunAt` computation, so there is no
security impact, but a future upper bound would be defensive.

## Step 4 Performance and resource use

The route layer performs no I/O of its own; all DB work is in the session module. Two performance-
relevant properties are inherited correctly:

- `list` forwards `limit` (capped at 500 in the schema) into `ScheduledTask.list`, which applies it as
  a SQL `LIMIT` at `packages/ax-code/src/session/scheduled-task.ts:263`. No unbounded scans.
- `ScheduledTask.list` defensively `safeParse`s each row (lines 266–271) so a single corrupt row is
  skipped rather than 500-ing the list endpoint — important because `run-due` calls `list` on every tick.

`ScheduledTaskRoutes` is wrapped in `lazy(...)` (line 29), so the Hono instance and its OpenAPI
metadata are built on first request, not at import time — consistent with all sibling route modules
in `packages/ax-code/src/server/server.ts`.

## Step 5 Design and ownership

The route layer respects a strict boundary: HTTP concerns (routing, validation, OpenAPI metadata,
response shaping) live here; scheduling, persistence, transactionality, and event publishing live in
the session module. Evidence: `runNow`, `runDue`, `claimDueTask`, `recordRunFailure`, and
`publishUpdated` are all defined inside the `ScheduledTask` namespace at
`packages/ax-code/src/session/scheduled-task.ts`, never in the route file. Error mapping is centralised
through `appErrorEnvelope` (`packages/ax-code/src/server/error.ts:242`) wired into the server-level
`onError` at `packages/ax-code/src/server/server.ts:155`, so routes do not need try/catch around
delegated calls — the thrown `HTTPException(409)` from `runNow` and the `NotFoundError` from
`get`/`update` are both mapped automatically.

The pattern is identical to the other 23 routers mounted in `server.ts:299–324`, which keeps the
HTTP surface uniform and predictable.

## Step 6 Dead code and duplication

No unused exports, no unreachable branches, no commented-out blocks in the file. The helper
`scheduledTaskID(c)` at line 25 is used by six handlers (get, update, pause, resume, run-now, delete).
`ScheduledTaskUpdateBody`, `ScheduledTaskListQuery`, and `ScheduledTaskRunDueQuery` are each used
exactly once, which is appropriate for route-local schemas. The `SCHEDULED_TASK_ID_PARAM` constant
is reused across all param-validated handlers. No duplication of note between this file and sibling
route modules beyond the unavoidable Hono/validator boilerplate.

## Step 7 Tests

The MODULE-AUDIT test inventory for this unit lists broad server/TUI tests
(`packages/ax-code/test/server/app-context-routes.test.ts`, `audit-route.test.ts`, etc.) but none of
them target `/scheduled-task` specifically — there is no dedicated route-level integration test for
create/list/update/run-now/run-due/delete in `packages/ax-code/test/server/`. The underlying
`ScheduledTask` namespace is exercised indirectly via `test/permission-task.test.ts` and the
scheduler paths, but the route's validator wiring (e.g., update-body `id` omission, `limit` cap,
`now` forwarding) is not directly asserted. Recommendation (LOW): add a small Hono `app.request`
test that hits each endpoint to lock in status codes and the 400 path.

## Step 8 Findings ledger

No findings are accepted against this unit. The findings/ directory is empty and the MODULE-AUDIT
ledger row is `_none accepted_`. The single LOW test-coverage observation in Step 7 is recorded here
in prose; it does not warrant a findings/ file because it is a coverage gap, not a defect, and the
underlying behaviour is already covered by the session-level tests and the central error mapper.

## Step 9 Verification and exit

This pass is documentation-only; no source files were modified, so no typecheck/build regression can
be introduced. The route module compiles as part of `pnpm --dir packages/ax-code run typecheck`
(confirming the `ScheduledTask.*` symbol references and zod schema wiring resolve). Independent
verifier lane `codex-sol` should perform the second-pass confirmation per the dual-agent protocol;
no Critical findings exist, so no `reverify.md` is required from this primary pass.
