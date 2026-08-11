# Protocol Steps — server-routes-route-params

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit slug: `server-routes-route-params`
Scope: `packages/ax-code/src/server/routes/route-params.ts` (74 lines, 16 exports)

## Step 1 Scope and map

The unit is a single 74-line module that centralizes Hono route-parameter parsing for the server layer. It exports seven zod param schemas (`SESSION_ID_PARAM` route-params.ts:21, `PROVIDER_ID_PARAM`:22, `PROJECT_ID_PARAM`:25, `PTY_ID_PARAM`:28, `QUESTION_REQUEST_ID_PARAM`:31, `PERMISSION_REQUEST_ID_PARAM`:34), one generic wrapper `withRouteParam` (:44), six typed `with*` adapters (:52–73), and two context-coupled helpers `parseSessionID` (:17) and `parseExistingSessionID` (:38). Twelve route modules under `packages/ax-code/src/server/routes/` import from this file (mcp.ts:9, question.ts:9, permission.ts:8, pty.ts:11, project.ts:10, provider.ts:13, session-impl.ts:34, session-lookup.ts:4, dre-graph.ts:27, graph.ts:9, audit.ts:12, server.ts:45), so this is a shared dependency on the request-handling critical path, not a leaf.

## Step 2 Threat and failure model

This module is the first trust boundary after the network read: it converts raw Hono `c.req.valid("param")` strings into branded identifiers (`SessionID`, `ProviderID`, `ProjectID`, `PtyID`, `QuestionID`, `PermissionID`). The relevant failure modes are (a) a route forgetting to register the matching `validator("param", …)` so an unvalidated string is handed to a handler, and (b) a helper silently accepting `undefined`/malformed input. `parseSessionID` (:17–19) calls `SessionID.make(c.req.valid("param").sessionID)`; `SessionID.make` in `packages/ax-code/src/id/branded.ts:19-21` is a bare `id as ID` cast with no runtime guard, so validation is entirely delegated to whoever mounts `SESSION_ID_PARAM`. The asset at stake is the integrity of every session/provider/permission lookup downstream.

## Step 3 Correctness

`parseSessionID` (route-params.ts:17) is correct only under the implicit precondition that the route registered `SESSION_ID_PARAM` as a param validator upstream; the function itself performs no check and the `SessionRouteContext` type (:11–15) only models `req.valid("param") → { sessionID: string }` as an unvalidated `string`, not as `SessionID`. `withRouteParam` (:44–50) reads `params[key]` with no fallback; if `key` is absent from the validated params object the handler receives `undefined` typed as `TValue`. The `with*` adapters (:52–73) are wired to the correct schema key in every consumer I read (e.g. permission.ts:30–32 pairs `PERMISSION_REQUEST_ID_PARAM` with `withPermissionRequestID`, question.ts pairs `QUESTION_REQUEST_ID_PARAM` with `withQuestionRequestID`), so there is no key-mismatch defect today — the risk is structural, not active.

## Step 4 Performance

No hot-path concern. Each helper allocates one closure and performs one record lookup; the zod schemas are module-level constants built once. `parseExistingSessionID` (:38–42) issues `await assertSessionExists(sessionID)` which calls `Session.get` (session-lookup.ts:6–8) — a single indexed SQLite read — so even the I/O-bound helper is O(1). Nothing here would benefit from memoization or batching.

## Step 5 Design and coupling

The `withRouteParam`/`with*` family is a tidy factory that keeps route handlers free of `c.req.valid("param")` boilerplate, and the twelve consumers confirm the abstraction earns its keep (well past the 3-call-site rule). However the family is typed `c: any` (:44–45, :52–73), so it discards the `SessionRouteContext` type that the sibling `parseSessionID`/`parseExistingSessionID` helpers _do_ use — the module maintains two parallel context contracts and only one of them is checked by the compiler. `PROVIDER_ID_PARAM` (:22–24) is the only schema annotated `.meta({ description: "Provider ID" })`; the other six param schemas carry no OpenAPI description, so the generated spec documents the provider field but leaves session/project/pty/question/permission params undescribed.

## Step 6 Dead code and hygiene

`parseExistingSessionID` (route-params.ts:38–42) has zero callers in `src/` or `test/` — confirmed by repo-wide search returning only its own definition. It is also actively policed away: `packages/ax-code/test/server/session-messages.test.ts:379` asserts `expect(src).not.toContain("parseExistingSessionID")` against `session-impl.ts`, and lines :369–374 require the destructive `DELETE /:sessionID` and `POST /:sessionID/abort` routes to use `parseCurrentProjectSessionID` instead. The replacement in `session-lookup.ts:16-33` (`requireCurrentProjectSession` / `parseCurrentProjectSessionID`) adds the HTTP 409 cross-project ownership guard; `parseExistingSessionID` only calls `assertSessionExists → Session.get` and therefore silently bypasses that guard. Leaving it exported is both dead weight and a footgun: any future route that reaches for it inherits existence-without-ownership. No empty catches, no TODOs, no console/logging residue.

## Step 7 Tests

This unit has no direct unit test (none of the files in MODULE-AUDIT §1 import from `route-params` directly), but it is exercised by `session-messages.test.ts:362-400`, which reads `session-impl.ts` source text to enforce that the cross-project guard (`parseCurrentProjectSessionID`) is present and that both `parseSessionID(c)` (bare) and `parseExistingSessionID` are _absent_ from destructive and detail routes. That is a structural/grep-style guard rather than behavioral coverage of `withRouteParam` itself; the generic `withRouteParam<"name", string>` path used by mcp.ts:24-26 and the `withProviderID`/`withPtyID`/`withProjectID` adapters have no test that asserts they pass the validated value through correctly.

## Step 8 Findings register

1. **[MEDIUM] Dead, guard-bypassing export** — `parseExistingSessionID` route-params.ts:38. Zero callers; superseded by `parseCurrentProjectSessionID` (session-lookup.ts:29) which enforces the 409 cross-project ownership check. Remove the export, or at minimum deprecate and redirect to `parseCurrentProjectSessionID`, so future route authors cannot accidentally use the weaker existence-only helper. Evidence: route-params.ts:38-42, session-lookup.ts:16-33, session-messages.test.ts:379.
2. **[LOW] Implicit validation precondition** — `parseSessionID` route-params.ts:17 depends entirely on an upstream `validator("param", SESSION_ID_PARAM)` because `SessionID.make` (branded.ts:19-21) is an unchecked cast. Recommend either tightening `SessionRouteContext.valid` to return `{ sessionID: SessionID }` or adding a runtime assertion inside `parseSessionID` so a forgotten validator fails loudly instead of passing `undefined` downstream.
3. **[LOW] Inconsistent OpenAPI metadata** — only `PROVIDER_ID_PARAM` (route-params.ts:22-24) carries `.meta({ description })`; add descriptions to the other six param schemas so the generated OpenAPI spec is uniform.
4. **[INFO] Parallel context contracts** — `withRouteParam`/`with*` use `c: any` (route-params.ts:44-45, 52-73) while `parseSessionID` uses `SessionRouteContext`; harmless today but worth a single shared context type if the server layer gains one.

## Step 9 Verification and exit

No Critical findings; findings/ contains no Critical items, so no `reverify.md` second-pass is required for this unit. Verification of the dead-code claim is reproducible: a repo-wide search for `parseExistingSessionID` returns only route-params.ts:38, and `session-messages.test.ts:379` encodes the negative assertion. Recommended gate before sign-off: run `pnpm --dir packages/ax-code run typecheck` after removing `parseExistingSessionID` (finding 1) to confirm no transitive caller breaks, then `pnpm --dir packages/ax-code run test:unit -- AX_TEST_FILES=test/server/session-messages.test.ts` to confirm the structural guard still passes. The four findings above are the complete disposition for `server-routes-route-params`; none block merge, finding 1 is the only one worth acting on in this wave.
