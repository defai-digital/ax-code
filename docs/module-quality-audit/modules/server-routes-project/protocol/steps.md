# Review Protocol — server-routes-project

Unit: `server-routes-project`
Primary source: `packages/ax-code/src/server/routes/project.ts` (119 lines, single export `ProjectRoutes`).
Reviewer lane: `ax-code-glm`. Independent verifier lane: `codex-sol`.
Baseline commit: `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945`.

The module under review mounts four HTTP routes onto a `Hono` sub-app built inside a
`lazy()` initializer (`packages/ax-code/src/server/routes/project.ts:12`): `GET /` (list),
`GET /current`, `POST /git/init`, and `PATCH /:projectID`. The sub-app is mounted at
`/project` by `packages/ax-code/src/server/server.ts:299`.

## Step 1 Scope and inventory

`ProjectRoutes` is the only export (`packages/ax-code/src/server/routes/project.ts:12`).
It is constructed once via `lazy()` from `packages/ax-code/src/util/lazy.ts:7`, which caches
the `Hono` instance on first call and exposes `reset()`/`peek()` for tests. Four routes are
chained: list at `project.ts:14-35`, current at `project.ts:36-56`, git/init at `project.ts:57-92`,
update at `project.ts:93-118`. Each route uses `describeRoute` from `hono-openapi` to declare
its OpenAPI operationId (`project.list`, `project.current`, `project.initGit`, `project.update`)
and response schema via `resolver(...)`. No `validator` is applied to the two GETs or to
`POST /git/init` (they take no body/param); `PATCH /:projectID` applies both a param validator
(`PROJECT_ID_PARAM`, `project.ts:111`) and a json validator (`Project.UpdateInput.omit({ projectID: true })`,
`project.ts:112`).

## Step 2 Threat surface and inputs

The network boundary is the HTTP server. Trust model is local single-user (loopback), but the
generated SDK consumes the OpenAPI contract, so status-code fidelity still matters for clients.
User-controlled inputs reaching handlers: the `:projectID` path segment (validated against
`ProjectID.zod` via `PROJECT_ID_PARAM` at `route-params.ts:25-27`) and the PATCH json body
(validated against `Project.UpdateInput` at `project.ts:112`, which omits `projectID` to prevent
the client from rewriting the key). The `POST /git/init` and `GET /current` handlers do not
parse client body; they read `Instance.directory` / `Instance.project` from the request-scoped
ALS context established by upstream middleware (`packages/ax-code/src/project/instance.ts:215-235`).
No secrets, filesystem paths, or shell input are taken from the request body in this module.

## Step 3 Control-flow correctness

`GET /` (`project.ts:31-34`) calls `Project.list()` (`packages/ax-code/src/project/project.ts:450-461`),
which runs a synchronous Drizzle `select().all()` and filters rows through `Project.safe` so
corrupt rows are dropped rather than thrown. `GET /current` (`project.ts:53-55`) returns
`Instance.project`; if no instance context is active, `context.use()` inside the getter
(`instance.ts:233-235`) throws and is normalized upstream. `POST /git/init` (`project.ts:74-91`)
short-circuits when `prev.vcs === "git"` (line 77), otherwise awaits `Project.initGit`
(`project.ts:475-487`) which itself rejects with `"Git is not installed"` or a git-stderr message.
The post-call equality check at `project.ts:83` (`next.id === prev.id && next.vcs === prev.vcs
&& next.worktree === prev.worktree`) correctly suppresses the expensive `Instance.reload` when
init ran but produced no material change; when vcs flips from undefined/"fake" to "git" the
check is false and `Instance.reload` fires (`project.ts:84-89`), passing `InstanceBootstrap` as
the re-init function. `PATCH /:projectID` (`project.ts:113-117`) delegates to `Project.update`
which throws a plain `Error("Project not found: …")` at `project.ts:382` when the row is absent.

## Step 4 Error-contract fidelity (issue)

`PATCH /:projectID` advertises `...errors(400, 404)` at `project.ts:108`, implying a missing
project yields 404. In practice `Project.update` throws a bare `Error` (`project.ts:382`), and
the global normalizer `plainErrorEnvelope` (`packages/ax-code/src/server/error.ts:189-240`) only
matches specific message prefixes ("Session … is busy", "Tool … unavailable", "No LSP server
available", "MCP server not found", "Access denied:"). "Project not found" matches none of them,
so the response becomes `{ name: "UnknownError", message: "Internal server error", status: 500 }`
(`error.ts:233-240`). The `notFoundEnvelope` path that _does_ recognize "Project not found"
(`error.ts:37-65`) is only reachable for `NamedError`/`NotFoundError` instances, which this throw
is not. Net effect: clients (including the generated SDK) receive a 500 for a routine
not-found condition, contradicting the documented 404. This is a real correctness/contract bug,
severity MEDIUM. Recommended fix: throw `NotFoundError` (or a `NamedError` carrying the
"Project not found" message) from `updatePromise`, matching the pattern already used by other
project lookups; alternatively extend `plainErrorEnvelope`'s pattern list. No security impact
(loopback, no information leak beyond a status code), but it degrades client retry/diagnostic
behavior. Registered as the single accepted finding for this unit.

## Step 5 Performance and resource use

No N+1 or unbounded fan-out in this file. `Project.list()` loads every project row in one query
(`project.ts:450-461`); acceptable for a local single-user install where project count is small,
and `safe()` filtering is O(rows). `POST /git/init` triggers `Instance.reload`
(`instance.ts:274-308`) which disposes per-directory state and re-boots — heavy, but it is gated
by the equality check at `project.ts:83` so idempotent repeats pay only the `git init` cost.
No streaming/SSE concerns; all handlers return a single `c.json(...)`.

## Step 6 Design and ownership boundaries

Layering is clean: the route file owns HTTP concerns only (OpenAPI metadata, validation wiring,
`withProjectID` param extraction from `route-params.ts:56-58`) and delegates all domain work to
`Project.*` and `Instance.*`. The `lazy()` construction matches the convention used by sibling
route modules mounted in `server.ts:299-319`. One minor redundancy: the vcs short-circuit at
`project.ts:77` overlaps with the guard inside `Project.initGit` (`project.ts:476`); both are
defensible (the route-level check avoids an await round-trip), so no change recommended. The
post-init equality gate at `project.ts:83` is the only place that decides whether a reload is
needed, which is the right ownership — the route observes the before/after project snapshots.

## Step 7 Hygiene and dead code

No empty `catch` blocks, no TODO/FIXME, no commented-out code. Every import is used: `Hono`,
`describeRoute`, `validator`, `resolver`, `Instance`, `Project`, `errors`, `lazy`,
`InstanceBootstrap`, `PROJECT_ID_PARAM`, `withProjectID` (`project.ts:1-10`). `InstanceBootstrap`
is referenced once at `project.ts:88`. The `Project.UpdateInput.omit({ projectID: true })`
shape correctly prevents the body from overriding the path-derived id before it is spread back
in at `project.ts:115`.

## Step 8 Test coverage

`packages/ax-code/test/server/project-init-git.test.ts` exercises `POST /git/init` with three
targeted cases: fresh directory triggers exactly one `Instance.reload` and emits
`server.instance.disposed` (`project-init-git.test.ts:20-75`); an already-git directory skips
reload (`:77-120`); a nested subdirectory of an existing git repo does not initialize a new repo
(`:122-157`). Coverage of the trickiest route is strong. By contrast, `GET /`,
`GET /current`, and `PATCH /:projectID` have no dedicated route-level tests in
`packages/ax-code/test/server/`; their HTTP-layer contracts (status codes, error-envelope
shape) are only indirectly exercised. Consequence: the Step-4 404-vs-500 discrepancy is not
caught by any current test. A focused test asserting the response status/envelope for a PATCH
to a nonexistent `projectID` would lock the contract once the underlying throw is fixed.

## Step 9 Verification and disposition

No Critical or High findings. One MEDIUM finding accepted: `PATCH /:projectID` returns 500
where its OpenAPI metadata promises 404, because `Project.update` throws a plain `Error` that
`plainErrorEnvelope` (`error.ts:189-240`) does not recognize. Recommended remediation is a
one-line change at `packages/ax-code/src/project/project.ts:382` to throw a `NotFoundError`
(or equivalent `NamedError`) so `notFoundEnvelope` (`error.ts:46-65`) maps it to 404, plus a
route-level test. Independent verification of this MEDIUM item is requested from the
`codex-sol` lane via the normal review gate; because severity is below Critical, no separate
`reverify.md` is required by the protocol. `server-routes-project` is cleared pending the
single MEDIUM remediation.
