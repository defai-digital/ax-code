# Nine-step review: server-routes-session-impl

## Step 1 Scope and Route Surface

The reviewed unit is `packages/ax-code/src/server/routes/session-impl.ts`, whose sole export is the lazy `SessionRoutes` application at line 190. The chain contains 40 HTTP handlers with distinct `operationId` values, beginning with session listing at `packages/ax-code/src/server/routes/session-impl.ts:192` and ending with the deprecated permission response at `packages/ax-code/src/server/routes/session-impl.ts:1543`. The one-line facade at `packages/ax-code/src/server/routes/session.ts:1` re-exports the implementation, and the server mounts it at `/session` in `packages/ax-code/src/server/server.ts:313`.

## Step 2 Trust Boundaries and Failure Modes

Every request except `/log` receives a validated project instance before routing (`packages/ax-code/src/server/server.ts:258`), while `requestDirectory` rejects null bytes, non-absolute or missing directories, dangerous roots, and sensitive home paths at `packages/ax-code/src/server/request-directory.ts:27`. Session-specific handlers call the ownership guard in `packages/ax-code/src/server/routes/session-lookup.ts:16`; the comparison route checks both identifiers independently at `packages/ax-code/src/server/routes/session-impl.ts:541`. Error redaction is exercised with a token-shaped failure in `packages/ax-code/test/server/route-validation.test.ts:32`, which expects only a generic 500 envelope.

## Step 3 Correctness and State Transitions

The shared JSON adapter combines validated bodies with the project-checked route identifier at `packages/ax-code/src/server/routes/session-impl.ts:176`, avoiding caller-supplied session-ID precedence. Message pagination validates cursors before use, requires `limit` when `before` is present, handles zero without invoking a positive-only domain schema, and emits continuation headers at `packages/ax-code/src/server/routes/session-impl.ts:1055`. Stable backward ordering uses timestamp plus message ID in `packages/ax-code/src/session/message-v2-impl.ts:577` and fetches one extra row to determine continuation at `packages/ax-code/src/session/message-v2-impl.ts:923`. Destructive rollback, move, part editing, revert, and unrevert paths apply the busy gate before mutation; representative checks appear at `packages/ax-code/src/server/routes/session-impl.ts:653`, `packages/ax-code/src/server/routes/session-impl.ts:721`, and `packages/ax-code/src/server/routes/session-impl.ts:1537`.

## Step 4 Performance and Resource Bounds

List input caps the caller-selected session count at 1,000 (`packages/ax-code/src/server/routes/session-impl.ts:218`), and omitted message limits resolve to the 100-message bound declared at `packages/ax-code/src/server/routes/session-impl.ts:44`. The storage query limits itself to `limit + 1` before hydrating parts (`packages/ax-code/src/session/message-v2-impl.ts:934`), so pagination work is proportional to the requested page rather than total history. The notable remaining cost is delete-message classification, which loads the session transcript at `packages/ax-code/src/server/routes/session-impl.ts:1180`; this is confined to a destructive operation and was not elevated without evidence of user-visible exhaustion.

## Step 5 Design and Ownership

The HTTP module owns validation, status codes, OpenAPI descriptions, and response envelopes, while domain behavior remains delegated to `Session`, `MessageV2`, rollback, move, risk, goal, and queue modules imported at `packages/ax-code/src/server/routes/session-impl.ts:7`. Async endpoints enqueue durable work and transfer execution ownership to the queue executor at `packages/ax-code/src/server/routes/session-impl.ts:81`; the executor then claims and detaches a queued item under locks at `packages/ax-code/src/session/task-queue-executor-impl.ts:87`. Although a 1,583-line fluent route chain is a maintainability hotspot, the facade and mount boundaries at `packages/ax-code/src/server/routes/session.ts:1` and `packages/ax-code/src/server/server.ts:313` remain coherent.

## Step 6 Hygiene and Defensive Validation

The cursor refinement catch at `packages/ax-code/src/server/routes/session-impl.ts:1067` deliberately converts decode failures into validation failure rather than suppressing an operational error. Part updates compare all three body identifiers with the path before persistence at `packages/ax-code/src/server/routes/session-impl.ts:1289`, and stale permission replies become typed 404 responses when the atomic reply result is false at `packages/ax-code/src/server/routes/session-impl.ts:1569`. No TODO, FIXME, unchecked `any`, or TypeScript suppression appears in the reviewed implementation; helper definitions such as `runSessionRequest` at line 182 are used by prompt, command, and shell routes at lines 1323, 1416, and 1472.

## Step 7 Test Coverage Assessment

Direct server tests are stronger than the preliminary inventory suggests. Pagination covers continuation headers, the default 100-row bound, malformed cursors, decimal parsing, and the 500-row maximum in `packages/ax-code/test/server/session-messages.test.ts:110`; domain pagination also covers multi-page order and session-scoped message lookup at `packages/ax-code/test/session/messages-pagination.test.ts:38`. Route validation exercises identifier mismatch, busy envelopes, rollback selection, and stale request errors at `packages/ax-code/test/server/route-validation.test.ts:71`, while cross-project access receives a dynamic 409 assertion at `packages/ax-code/test/server/project-identity.test.ts:31`. A residual coverage gap is the absence of a dynamic cross-project test for every mutation, though structural assertions cover the shared guard at `packages/ax-code/test/server/session-messages.test.ts:362`.

## Step 8 Finding Register Review

The unit register states `_none accepted_` at `docs/module-quality-audit/modules/server-routes-session-impl/MODULE-AUDIT.md:60`, and the unit has no files under `findings/`. The independent read found no Critical defect requiring a second-pass `reverify.md`. Pagination cost, the large route-chain size, and mutation-test breadth were recorded as bounded review observations rather than confirmed correctness or security failures, so no new finding artifact was created.

## Step 9 Verification and Exit Decision

Repository guidance requires exact Vitest targeting through `AX_TEST_FILES` at `AGENTS.md:42`. Running the five focused files—server session messages, session list, project identity, route validation, and domain message pagination—completed with 5 files and 77 tests passing; those files include the route-level assertions at `packages/ax-code/test/server/session-list.test.ts:116`. `pnpm --dir packages/ax-code run typecheck` also completed successfully, matching the documented core check at `AGENTS.md:19`. On the reviewed evidence, `server-routes-session-impl` is ready for verifier handoff with no Critical re-verification artifact.
