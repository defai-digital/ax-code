# Protocol Steps: server-routes-session-lookup

Unit: `server-routes-session-lookup`
Source: `packages/ax-code/src/server/routes/session-lookup.ts` (33 LOC, 3 exports)
Reviewer lane: `ax-code-glm` · Model: `zai-coding-plan/glm-5.2[1m]`
Date: 2026-08-11

## Step 1 Scope and map

The unit is a single 33-line module that centralizes session lookup + cross-project authorization for the HTTP server layer. Three exports form an escalating ladder:

- `assertSessionExists(sessionID)` — `packages/ax-code/src/server/routes/session-lookup.ts:6-8`
- `requireCurrentProjectSession(sessionID)` — `packages/ax-code/src/server/routes/session-lookup.ts:16-22`
- `parseCurrentProjectSessionID(c)` — `packages/ax-code/src/server/routes/session-lookup.ts:29-32`

Consumers confirmed by repo-wide grep: `packages/ax-code/src/server/routes/session-impl.ts:35` (import) with 30+ call sites (e.g. `:172, :177, :306, :541-542, :942, :1139, :1502`); `packages/ax-code/src/server/routes/graph.ts:10,34,70`; `packages/ax-code/src/server/routes/audit.ts:13,104,152`; `packages/ax-code/src/server/routes/dre-graph.ts:28,182,207`; `packages/ax-code/src/server/routes/super-long.ts:16,176`; `packages/ax-code/src/server/routes/tui.ts:10,270,297`; and `packages/ax-code/src/server/routes/route-params.ts:9,40` (the only consumer of `assertSessionExists`). This is a shared guard on the request-handling critical path, not a leaf.

## Step 2 Threat and failure model

Asset surface = the three exported functions on a `network, api` risk-tagged module. Failure modes traced against `packages/ax-code/src/server/error.ts`:

1. Missing session → `Session.get` (`packages/ax-code/src/session/index.ts:468-474`) throws `NotFoundError` → `packages/ax-code/src/server/error.ts:87` routes through `notFoundEnvelope` (`:46-65`) → HTTP 404 `SessionNotFoundError`.
2. Session exists but belongs to another project → `requireCurrentProjectSession` throws `HTTPException(409, ...)` at `session-lookup.ts:19-21` → `packages/ax-code/src/server/error.ts:67-84` maps status 409 to envelope name `ServiceUnavailableError` with `retryable: true`.
3. Session exists and matches → returns the `Session.Info` row (or the parsed id).

Mode (2) is the one worth flagging: a _permanent_ cross-project conflict is reported to the client as a _transient_ `ServiceUnavailableError` that is safe to retry.

## Step 3 Correctness of public helpers

- `assertSessionExists` (`:6-8`) awaits `Session.get(sessionID)` and discards the row. Correctness depends entirely on `Session.get` throwing `NotFoundError` for both "no row" and "row present but `parseRow` returns null" (`packages/ax-code/src/session/index.ts:470-472`). It does — but the discarded row means any caller that also needs the session pays for a second indexed lookup.
- `requireCurrentProjectSession` (`:16-22`) fetches once and delegates project affinity to `Session.isCompatibleWithCurrentProject` (`packages/ax-code/src/session/index.ts:486-494`), which requires both `projectID === Instance.project.id` and a directory-overlap/`Filesystem.contains` check. On mismatch it throws `HTTPException(409)` with a descriptive message. The contract matches the docstring (`:10-15`) and the protected `GET /session/:sessionID` route behavior.
- `parseCurrentProjectSessionID` (`:29-32`) composes `parseSessionID(c)` (`packages/ax-code/src/server/routes/route-params.ts:17-19`) with `requireCurrentProjectSession` and returns the parsed id, deliberately _not_ the fetched session. The docstring (`:24-28`) explains why: downstream must use this returned id rather than the raw route param, so a session-scoped operation cannot drift back to an unverified value. Control flow is sound.

## Step 4 Performance

Each helper performs at most one `Session.get`, which is a single primary-key indexed SQLite read (`packages/ax-code/src/session/index.ts:468-469`). `parseCurrentProjectSessionID` adds a synchronous zod param validation (`SessionID.make` via `route-params.ts:18`) before the I/O. There are no loops, no fan-out, and the only allocation on the unhappy path is the `HTTPException` (`:19`). The helper sits on the critical path of every session-derived route, but per-request cost is O(1); nothing here would benefit from memoization or batching.

## Step 5 Design and boundaries

The three-function ladder is well-factored: existence → existence+ownership (returns row) → route-bound+ownership (returns id). Callers pick the narrowest guarantee they need.

Coupling is narrow and intentional: `hono/http-exception`, `Session` from `../../session`, and `parseSessionID`/`SessionRouteContext` from `./route-params`. Note the bidirectional edge — `packages/ax-code/src/server/routes/route-params.ts:9` imports `assertSessionExists` back from this module. Function-level `import` makes this resolve fine, but the pair forms a small dependency cycle between two route-helper modules. Not actionable at this size, but if `assertSessionExists` is removed (see Step 6) the cycle disappears for free.

## Step 6 Dead code and misleading exports

`assertSessionExists` (`session-lookup.ts:6-8`) has exactly one caller in the entire repo: `parseExistingSessionID` at `packages/ax-code/src/server/routes/route-params.ts:38-42`. `parseExistingSessionID` in turn has **zero** production callers — the only reference outside its own definition is `packages/ax-code/test/server/session-messages.test.ts:379`, which asserts its _absence_ from `session-impl.ts`. So `assertSessionExists` is transitively dead.

More pointedly, `assertSessionExists` offers existence-without-ownership — precisely the bypass that the rest of this module exists to prevent. The sibling unit `server-routes-route-params` already recommends removing `parseExistingSessionID`; from this module's side, `assertSessionExists` becomes orphaned the moment that happens and should be deleted in the same change (or at minimum unexported). No empty catches, no TODOs, no stray logging in this file.

## Step 7 Test coverage

There is no direct unit test for `session-lookup.ts`. The only coverage is structural source-text assertion: `packages/ax-code/test/server/session-messages.test.ts:362-400` reads `session-impl.ts` as text and requires `parseCurrentProjectSessionID` to appear on destructive + detail routes (`:369, :373, :393, :398-399`) while forbidding bare `parseSessionID(c)` (`:370, :394`) and `parseExistingSessionID` (`:379`). That polices _which helper_ is wired in, but never exercises the helpers themselves.

Concretely missing behavioral coverage for a `network, api` authorization guard: no test asserts that a request whose session belongs to a different project actually surfaces HTTP 409 through `requireCurrentProjectSession`, and no test asserts that a missing session surfaces 404 through `assertSessionExists`. The 409 envelope shape (`ServiceUnavailableError`, `retryable: true`) is likewise unasserted at this boundary.

## Step 8 Findings register

1. **[MEDIUM] Dead, guard-bypassing export `assertSessionExists`** — `packages/ax-code/src/server/routes/session-lookup.ts:6-8`. Sole caller is `parseExistingSessionID` (`route-params.ts:40`), which itself has zero production callers and is actively policed away by `session-messages.test.ts:379`. The helper provides existence-without-ownership — the exact failure mode `requireCurrentProjectSession` exists to prevent. Recommend deletion in the same change as `parseExistingSessionID` removal.
2. **[LOW] 409 mapped to retryable `ServiceUnavailableError`** — thrown at `session-lookup.ts:19`, envelope produced by `packages/ax-code/src/server/error.ts:69-83`. A permanent cross-project conflict is reported as `retryable: true`, inviting indefinite client retries. Trigger originates in this module; fix belongs in `error.ts` (or a status change here).
3. **[LOW] Existence oracle via 409 message** — `session-lookup.ts:20` echoes the raw `sessionID` in `Session ${sessionID} belongs to a different project directory`. A caller probing ids can distinguish 404 (absent) from 409 (present, foreign). SessionIDs are high-entropy so practical exploitability is low, but on an authz boundary the message could omit the id.
4. **[LOW] No behavioral test of the 409/404 paths** — see Step 7.

No Critical findings.

## Step 9 Verification and exit

The `findings/` directory for this unit is empty and no Critical items were raised above, so no `reverify.md` second pass is required from this primary reviewer lane. The static-extract fingerprint in `MODULE-AUDIT.md` (`be858cabeef76faa`) is consistent with what was read: 3 exports, 0 empty catches, 0 TODOs, 34 LOC (`MODULE-AUDIT.md:26`).

Recommended gate before any code change from this review: after removing `assertSessionExists` (finding 1), run `pnpm --dir packages/ax-code run typecheck` to confirm no transitive caller breaks, then `pnpm --dir packages/ax-code run test:unit -- AX_TEST_FILES=test/server/session-messages.test.ts` to confirm the structural guard at `session-messages.test.ts:362-400` still passes. The four findings above are the complete disposition for `server-routes-session-lookup`; none block merge, and finding 1 is the only one worth acting on in this wave.
