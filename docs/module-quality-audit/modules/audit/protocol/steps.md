# Protocol Steps: audit

- Slug: `audit`
- Lane: `codex-sol`
- Date: `2026-08-11`

## Step 1 Map

The unit defines the SIEM record schema in `packages/ax-code/src/audit/index.ts:3-32`, branded call IDs in `id.ts:3-5`, JSON decoding in `json.ts:4-13`, and SQLite storage in `schema.sql.ts:28-61` plus `query.ts:14-96`. Higher-level surfaces are `AuditSemanticCall.record/flushNow` in `semantic-call.ts:28-133`, JSONL replay export in `export.ts:119-167`, and human-readable session report generation in `report.ts:162-401`.

## Step 2 Threat model

Audit inputs include tool arguments, envelopes, model/error metadata, session messages, policy context, and filesystem targets, so confidentiality and tamper-resistant attribution are the main assets (`packages/ax-code/src/audit/index.ts:3-31`, `packages/ax-code/src/audit/report.ts:163-260`). Failure modes include losing queued records on abrupt termination or database failure, emitting unbounded/sensitive tool output, mismatching call/result events, and silently accepting malformed policy metadata; exports cap output summaries and policy loading rethrows every error except ENOENT (`packages/ax-code/src/audit/export.ts:11-16`, `packages/ax-code/src/audit/export.ts:153-167`).

## Step 3 Correctness

`AuditSemanticCall.record` assigns the identifier before either synchronous insert or queued batching, while `flushQueue` splices a single batch and process hooks drain it during normal shutdown (`packages/ax-code/src/audit/semantic-call.ts:39-127`). `AuditExport.streamAll` advances a composite timestamp/session/sequence cursor, preventing duplicate or skipped ordering at equal timestamps, and invalid timestamps normalize deterministically to epoch (`packages/ax-code/src/audit/export.ts:34-37`, `packages/ax-code/src/audit/export.ts:127-150`). `AuditReport.generate` pairs tool calls and results by call ID, leaves unmatched calls visibly pending, and aggregates token/route/diff/verification evidence without treating absent messages as fatal (`packages/ax-code/src/audit/report.ts:163-260`).

## Step 4 Performance

Queued semantic calls are combined into one multi-value SQLite insert per event-loop turn, reducing database round trips (`packages/ax-code/src/audit/semantic-call.ts:82-120`, `packages/ax-code/src/audit/query.ts:51-72`). JSONL export is generator-based and global export is paginated, but a single-session report and `stream(sessionID)` materialize the session query result before iteration (`packages/ax-code/src/audit/export.ts:119-150`, `packages/ax-code/src/audit/report.ts:163-165`), which is acceptable for normal sessions but is the scaling limit for very long histories.

## Step 5 Design

The split is cohesive: schema/query own durable row shapes, semantic-call owns write timing, export owns machine-readable projection, and report owns the narrative projection (`packages/ax-code/src/audit/query.ts:6-13`, `packages/ax-code/src/audit/semantic-call.ts:107-125`). Both projections consume replay events rather than duplicating event capture, and `packages/ax-code/src/audit/json.ts` provides a small shared boundary for route/CLI JSONL decoding.

## Step 6 Dead code/hygiene

No TODO, FIXME, or empty catch was found in the eight source files; `packages/ax-code/src/audit/report.ts:171-184` catches missing session messages with an explicit fallback goal, and `export.ts:163-167` narrows the absence policy to ENOENT. Queue-mode database failure is deliberately logged and drops the spliced batch at `packages/ax-code/src/audit/semantic-call.ts:82-95`; this is a documented durability tradeoff rather than a silent path, with `AX_CODE_AUDIT_SYNC` available where callers require surfaced failures.

## Step 7 Tests

`packages/ax-code/test/audit/semantic-call.test.ts:27-216` covers queued/synchronous writes, error codes, hooks, and bounded recent queries; `report.test.ts:36-203` and `siem.test.ts:52-350` cover report pairing and export schema. `packages/ax-code/test/audit/json.test.ts`, `bugfix.test.ts`, `packages/ax-code/test/cli/audit.test.ts`, and `packages/ax-code/test/server/audit-route.test.ts` cover decoding, LSP error recording, CLI output, and the server boundary. The largest remaining gap is a high-volume report/export test that demonstrates memory behavior and cursor continuity across many pages.

## Step 8 Findings

`docs/module-quality-audit/modules/audit/MODULE-AUDIT.md` contains no accepted finding, and the source review found no untracked Critical or High defect. The visible record-drop behavior in queue mode is logged, documented, and switchable to synchronous writes (`packages/ax-code/src/audit/semantic-call.ts:82-120`), so it was retained as an operational tradeoff rather than promoted to a new finding.

## Step 9 Verification

I ran the ten-file audit/control-plane command using `AX_TEST_FILES=... pnpm --dir packages/ax-code exec vitest run`; all ten files and 104 tests passed, including `packages/ax-code/test/audit/semantic-call.test.ts`, `report.test.ts`, `siem.test.ts`, `json.test.ts`, and `bugfix.test.ts`. `pnpm --dir packages/ax-code run typecheck` also passed; `test/cli/audit.test.ts` and `test/server/audit-route.test.ts` are sensible integration additions when changing transport formatting.
