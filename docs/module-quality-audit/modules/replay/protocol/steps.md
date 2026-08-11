# replay — 9-step review (ax-code-glm)

Unit slug: `replay`
Reviewer: ax-code-glm (model: zai-coding-plan/glm-5.2[1m])
Scope: `packages/ax-code/src/replay` (9 source files, ~2197 LOC)
Verifier lane: codex-sol
Date: 2026-08-11

## Step 1 Scope and map

The `replay` unit is a self-contained namespace under `packages/ax-code/src/replay/`.
The dependency graph inside the unit is acyclic and shallow:

- `index.ts:3` defines the only branded identifier (`EventLogID`); every other file imports it from here.
- `event.ts:296` declares the discriminated union `ReplayEvent` (30 variants) — the canonical event schema, validated via zod.
- `event-log.sql.ts:8` defines the `EventLogTable` Drizzle schema with four indexes (session, session+sequence, session+type+sequence, time_created).
- `query.ts:10` (`EventQuery`) is the only read/write surface over `EventLogTable`.
- `recorder.ts:10` (`Recorder`) is the in-process write buffer that calls `EventQuery.insertMany`.
- `replay.ts:36` (`Replay`) is the reconstruction/divergence engine; `tool-call-query.ts:6` and `agent-control-query.ts:8` are read-model projectors.
- `compare.ts:6` (`ReplayCompare`) is the branch-ranking scorecard.

External touchpoints are narrow: `Risk` (`../risk/score`), `AgentControl`/`SafetyPolicy` (control-plane), `Database` (`../storage/db`), `Locale`, `stringList`, `asRecord`. No UI or HTTP-layer import leaks into this directory; the HTTP route that consumes replay lives in `src/server/routes/audit.ts:154`.

## Step 2 Threat and failure model

The unit's risk tags are `persistence, correctness` (MODULE-AUDIT.md line 10). The relevant failure modes I traced:

- **Silent truncation** of long sessions. `query.ts:20` caps every per-session read at `BY_SESSION_LIMIT = 10_000`. `Replay.run` (`replay.ts:62`), `reconstructStream` (`replay.ts:175`), and `compare` (`replay.ts:345`) all use `bySessionStrict`, which throws `TruncatedError` (`query.ts:54`) when more rows exist. Diagnostic paths (`summary`, sidebar) keep using the non-strict `bySession` and only `warnIfTruncated`. This split is the right call: determinism-critical paths fail loud, observability paths tolerate partial slices.
- **Lost events on process crash.** `recorder.ts:28` buffers emits into a microtask queue. `Database.close()` calls `Recorder.flushAll()` (`packages/ax-code/src/storage/db.ts:158`) to drain synchronously before teardown — closing the gap noted in the recorder comment.
- **Sequence gaps on multi-chunk insert.** `query.ts:339` wraps the 250-row chunked insert in a single transaction explicitly citing BUG-009, so a crash between chunks cannot leave gaps.
- **Leaked sessions.** `recorder.ts:20` caps the live-session map at 10_000 and evicts the oldest begin-order entry with a `log.warn` (BUG-010). The token mechanism in `end()` (`recorder.ts:80`) prevents a stale end-tick from killing a re-begun session.

No SQL injection surface exists: every query goes through Drizzle's parameterized builder (`eq`, `and`, `or`, `gt`, `gte`, `lte`, `sql<number>\`count(\*)\``). No string interpolation into SQL.

## Step 3 Correctness

Read control flow for the public read/write paths:

- `Recorder.emit` (`recorder.ts:105`) → `pending.push` → `scheduleFlush` → microtask `flush` → `EventQuery.insertMany`. On batch failure (`recorder.ts:44`) it falls back to per-event inserts so one bad row cannot poison the whole tick. Correct.
- `Replay.run` verify mode (`replay.ts:90-135`) flags both orphan `tool.result` (no matching `tool.call`) and orphan `tool.call` (via `toolSummary.openCalls` at `replay.ts:139`). The `seenToolCalls` map keys on `callID`, which correctly handles parallel tool calls (covered by `reconstruct.test.ts:76` "matches parallel tool results by call id").
- `Replay.compare` (`replay.ts:342`) calls `bySessionStrict` exactly once per invocation (asserted by `reconstruct.test.ts:267` "compare reconstructs from one strict event load"). The internal `reconstructStreamFromEvents` reuses the already-loaded array, so there is no double DB hit.
- **Observation (not a defect):** `Replay.compare` reconstructs `tool_call` parts from `llm.output` events (`replay.ts:201-205`) but compares their count against raw `tool.call` events collected in `originalSteps` (`replay.ts:358`). These are two distinct emission sources that coincide in normal processor flow. If they ever diverge at emission time the comparison would conflate the cause. This is a fragility worth a comment but not a live bug — the processor always emits both.
- `AgentControlReplayQuery.normalizeAgentControlEvent` (`agent-control-query.ts:52`) validates a single discriminant field per branch and then casts the record `as ReplayEvent`. It bypasses the zod schema in `event.ts:296`, but downstream `AgentControlSummary.fromEvents` (`agent-control-summary.ts:43`) re-switches on `event.type` and ignores unknown fields, so the cast is contained.

## Step 4 Performance

- The dedicated `event_log_session_type_sequence_idx` (`event-log.sql.ts:29`) backs `bySessionAndType` / `bySessionAndTypeWithTimestamp` (`query.ts:140, 213`). The comment explains it exists so the TUI Route indicator no longer loads the full per-session log just to pull out `agent.route` rows — a real measured win.
- `count()` (`query.ts:227`) and `pruneOlderThan` (`query.ts:352`) both use `count(*)` via `.get()` instead of materializing rows; `pruneOlderThan` wraps count+delete in a transaction to avoid the TOCTOU the previous select-then-delete had.
- `insertMany` (`query.ts:330`) chunks at 250 rows (under SQLite's 500-row compound-insert ceiling) inside one transaction.
- **Caller-side cost (out of scope but worth flagging):** `SessionBranch.detail` (`src/session/branch.ts:162-176`) calls `Replay.compare(sid)` (one strict full load) AND `EventQuery.bySession(sid)` (one non-strict full load) for every branch candidate. For N branches that is 2N full per-session scans. The replay module itself is not at fault, but exposing a single `loadOnce` helper would let the caller avoid the double read.

## Step 5 Design

Cohesion is strong: each file owns one concern (schema, table, query, buffer, reconstruction, projection, scorecard). The `EventQuery` namespace is the single read/write chokepoint, which makes the truncation policy enforceable in one place.

The strict/non-strict split (`query.ts:67` vs `query.ts:87`) is the module's most important design decision and it is applied consistently — every determinism-critical consumer (`Replay.run`, `reconstructStream`, `compare`) uses strict, every UI/audit consumer uses non-strict.

The scorecard in `compare.ts:178-242` is pure and total-bounding (`clamp`/`round`), and `rank` (`compare.ts:254`) ends its comparator chain with `a.id.localeCompare(b.id)` for determinism. `advise` (`compare.ts:325`) returns a tie at confidence 0.5 when votes balance, and `rank` then promotes the higher-scored candidate — a reasonable tiebreak.

The empty-input guard `if (items.length === 0) throw new Error("no candidates to rank")` (`compare.ts:292`) is unreachable from the only production caller (`branch.ts:160` guards `if (list.length === 0) return`), so it is effectively a defensive assertion. Consider `NamedError` for consistency with `TruncatedError`, but low priority.

## Step 6 Dead code and hygiene

- `event-log.sql.ts:16` declares `step_id: text()` (nullable) and `recorder.ts:110` populates it from `event.stepIndex?.toString()`. `query.ts:188` returns it from `bySessionLog` but no consumer in this unit reads it. It may be used elsewhere; not dead, just under-documented inside the module.
- `agent-control-query.ts:9` exports `DETAIL_SEPARATOR` indirectly via title strings only; `safetyActionLabel` (`agent-control-query.ts:284`) special-cases `allow_with_checkpoint` to "Checkpoint" — fine, but the only call site is the title builder.
- No empty catches in the unit (MODULE-AUDIT.md line 26 confirms 0 across all 9 files). `recorder.ts:44` and `recorder.ts:54` log warnings with full context (sessionID, eventType, sequence, error) — not swallowed.
- `compare.ts:76-82` exposes `clamp`/`round` as module-private helpers; both are used. `semanticRisk`/`semanticCost`/`validationText` are each used in both `score` and `advise`. No orphan helpers found.
- `index.ts:3` is the entire barrel — just the branded ID. Clean.

## Step 7 Tests

The replay unit has the strongest coverage of any module I have reviewed in this audit pass:

- `test/replay/reconstruct.test.ts` — 12 tests, including the strict-load call-count assertion (`:286`), parallel tool-call matching (`:76`), malformed legacy fields (`:295`, `:331`, `:356`), and a full processor-roundtrip via `prepareExecution` (`:461`).
- `test/replay/recorder-batching.test.ts` — 5 tests covering same-tick bursts of 50 events (`:9`), multi-tick flushing (`:46`), the re-begin token race (`:75`), and bounded/non-finite recent limits (`:98`, `:122`).
- `test/replay/tool-result-metadata.test.ts` — asserts metadata survives reconstruction.
- `test/replay/agent-control-events.test.ts` and `agent-control-query.test.ts` — cover the projection layer.
- `test/replay/query.test.ts` and `test/cli/debug-replay.test.ts` cover the query surface and CLI entrypoints.

One gap: `Replay.summary` (`replay.ts:423`) has no direct test for the ~14 event types it silently drops (e.g. `agent.phase.changed`, `autonomous.cap_hit`, `quality.critic_finding`, `planner.architect_call`, all `agent.safety.decided`). The switch has no default branch. Adding a default case (or tests for each new event family) would prevent the summary from going stale as new event types are added to `event.ts:296`.

## Step 8 Findings register

No Critical or High-severity findings. Items I am recording for the verifier (codex-sol) to confirm:

- MEDIUM — `Replay.summary` switch (`replay.ts:427-487`) omits 14 of 30 event types with no default branch; new autonomous/planner/safety/quality events are silently invisible in the CLI debug summary. Add a default arm or extend the switch.
- LOW — `Replay.compare` compares `llm.output`-derived tool_call parts against raw `tool.call` events (`replay.ts:358` vs `:407`); document the equivalence assumption or compare like-for-like.
- LOW — `ReplayCompare.rank` throws a plain `Error("no candidates to rank")` (`compare.ts:292`); unreachable today but should be a `NamedError` for consistency with `TruncatedError`.
- INFO — `SessionBranch.detail` (`src/session/branch.ts:162`) double-loads each session (strict via `Replay.compare` + non-strict via `EventQuery.bySession`); out of this unit's scope but the module could expose a combined loader.

No findings files are being written to `findings/` because none of the above reach the bar for a tracked finding in this unit (the MEDIUM item is an observability gap in a debug helper, not a runtime defect).

## Step 9 Verification and exit

- Static map (MODULE-AUDIT.md §1) is consistent with what I read: 9 files, no empty catches, no TODOs in the unit.
- The strict/non-strict truncation discipline is enforced and tested.
- Persistence paths are transactional where sequence integrity matters (`insertMany`, `pruneOlderThan`).
- No SQL injection, path traversal, or secret-handling surface in this unit.
- Test coverage is broad and includes the race conditions and malformed-input cases that matter most for this module.

Recommendation: sign off the unit at the current severity profile. The MEDIUM summary-switch gap is worth a small follow-up but does not block the gate. Handing off to verifier codex-sol for the independent confirmation pass.
