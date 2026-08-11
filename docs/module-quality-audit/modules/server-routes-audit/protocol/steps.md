# Protocol — server-routes-audit (9-step)

Unit slug: `server-routes-audit`
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Primary source read end-to-end: `/Users/akiralam/code/ax-code/packages/ax-code/src/server/routes/audit.ts` (158 lines).
Supporting files read to verify imports: `src/audit/export.ts`, `src/audit/json.ts`, `src/server/routes/session-lookup.ts`, `src/server/routes/route-params.ts`, `src/server/routes/query.ts`, `src/project/instance.ts`, `src/risk/score.ts`, `src/replay/replay.ts`, `src/session/index.ts`.

## Step 1 Scope and inventory

The unit under review is the single Hono router module `packages/ax-code/src/server/routes/audit.ts`. It exports three symbols: `parseAuditJsonLine` at `audit.ts:44`, `collectAuditExportRecords` at `audit.ts:53`, and the lazy `AuditRoutes` factory at `audit.ts:89`. Three HTTP routes are declared inside the factory: `GET /audit/export/:sessionID` (`audit.ts:91-109`), `GET /audit/export` (`audit.ts:110-138`), and `GET /audit/replay/:sessionID` (`audit.ts:139-157`). This matches the MODULE-AUDIT inventory of 3 exports / 159 LOC and zero TODOs.

## Step 2 Threat surface and boundaries

This router sits behind the local HTTP server (risk tags `network`, `api`). The trust boundary that matters most is project isolation: a client bound to one project directory must not read another project's audit events. Two indirect inputs also flow in — on-disk JSON-Lines audit logs written by other subsystems, and route/query parameters. Per-session routes rely on `parseCurrentProjectSessionID(c)` (`session-lookup.ts:29-32`), which calls `Session.get` then `Session.isCompatibleWithCurrentProject` and throws HTTP 409 on a foreign project. The cross-session `/export` route relies on building an allow-list from `Instance.directory` and `Session.list` (`audit.ts:128-129`), then dropping non-matching records at `audit.ts:71`.

## Step 3 Correctness — per-route control flow

- `GET /audit/export/:sessionID` (`audit.ts:103-108`): the project guard runs first; `collectAuditExportRecords` is called with just `limit`. Isolation enforced. ✓
- `GET /audit/export` (`audit.ts:121-137`): `allowedSessions = new Set(Session.list({ directory }).map((s) => s.id))` is computed once and passed as `sessionIDs`; records whose `session_id` is not in the set are skipped at `audit.ts:71`. No leak path exists. However, `Session.list` is a generator whose query defaults to `limit = 100` (`session/index.ts:629`) and is invoked without an explicit limit here, so for any directory with more than 100 sessions the allow-set is silently truncated and audit events for older sessions are filtered out. This violates the documented "Export all audit events for the current project" contract (`audit.ts:114`). See F1.
- `GET /audit/replay/:sessionID` (`audit.ts:151-156`): same project guard via `parseCurrentProjectSessionID`. `Replay.reconstructStream` uses the strict event loader (`replay.ts:175`) so truncated sessions surface rather than synthesise divergent steps. ✓

## Step 4 Public surface and contract

`parseAuditJsonLine` is documented as null-on-failure and verified to never throw (`audit.ts:44-51`); the inline comment records a prior incident where one corrupt line blew up the whole export. `collectAuditExportRecords` accepts an `Iterable<string>` and is therefore reusable from non-HTTP call sites (CLI, tests). `AuditRoutes` is `lazy`-wrapped so the Hono instance is not constructed at import time. The OpenAPI `operationId`s (`audit.export`, `audit.exportAll`, `audit.replay`) feed the generated SDK and are stable. **Contract gap:** both export response descriptions say "JSON Lines audit export" (`audit.ts:95, 114`) and the per-session description says "as JSON Lines" (`audit.ts:95`), but the handlers actually return `c.json({ data: records })` (`audit.ts:107, 136`) — a single JSON envelope object, not newline-delimited JSON. SDK clients generated from the OpenAPI description will assume the wrong media type and shape. See F5.

## Step 5 Performance and resource use

`collectAuditExportRecords` walks the input generator linearly and breaks at `options.limit` (`audit.ts:83`); the `AUDIT_EXPORT_MAX_LIMIT` ceiling of 10 000 (`audit.ts:19,22`) bounds the common path. When `risk` is supplied, `RiskEngine` is dynamically imported once (`audit.ts:66`) and `RiskEngine.fromSession(record.session_id)` is invoked per unique session, memoised in `sessionRisks` (`audit.ts:74-79`). `Risk.fromSession` itself performs a full `EventQuery.bySession` read plus a per-session diff-file read (`risk/score.ts:395-510`), so risk-filtered exports on long audit histories exhibit an N+1-style access pattern. See F2. Separately, `GET /audit/replay/:sessionID` returns the full reconstructed step array with no row cap (`audit.ts:154-155`); the only ceiling is the size of the session itself. See F3.

## Step 6 Design and module boundaries

Collaborator ownership is coherent: serialisation lives in `AuditExport` (`audit/export.ts`), JSON-line parsing in `audit/json.ts`, project compatibility in `session-lookup.ts`, current-directory resolution in `Instance` (`instance.ts:227-229`), and risk assessment in `risk/score.ts`. No layer violation — routes do not touch the database directly and import nothing from the UI layer. The local `AuditRecord` shape (`audit.ts:34`) is structurally similar to but separate from the `AuditRecord` type in `../../audit/index` consumed by `AuditExport`; minor structural drift, not blocking.

## Step 7 Hygiene, error handling, dead code

`parseAuditJsonLine` swallows parse errors and emits a warn log with a 200-char excerpt (`audit.ts:47`); rationale comment preserved. No empty catches. The constants `AUDIT_EXPORT_DEFAULT_LIMIT` and `AUDIT_EXPORT_MAX_LIMIT` are both `10_000` (`audit.ts:18-19`) — the `.max(AUDIT_EXPORT_MAX_LIMIT)` on line 22 is the real ceiling and the default equals the ceiling, so keeping both is documentary rather than behavioural. `isAuditRecord` (`audit.ts:36-38`) only checks key presence, not value types; `record.session_id` is later cast to the branded `SessionID` at `audit.ts:76` even though the local type declares it as `string`. See F4. All three exports are referenced by the server mount and by CLI/tests, so nothing is dead.

## Step 8 Findings register

- **F1 (HIGH, correctness/availability)** `GET /audit/export` silently drops audit events for any session beyond the first 100 in the directory, because `Session.list({ directory })` defaults to `limit=100` (`session/index.ts:629`). Evidence: `audit.ts:128-135` plus `session/index.ts:629-638`. The route's stated contract is "Export all audit events for the current project" (`audit.ts:114`). For audit/compliance consumers, silently incomplete exports are dangerous. Fix: pass an explicit large `limit` (or use a dedicated "all sessions for directory" query) when building `allowedSessions`.
- **F2 (MEDIUM, performance)** Risk-filtered export triggers one `RiskEngine.fromSession` call per unique session in the stream (`audit.ts:66-79`), each of which performs a full `EventQuery.bySession` read plus a diff-file read (`risk/score.ts:395-510`). For long audit histories with many distinct sessions this is quadratic-ish in session count. Mitigation: pre-compute risk once for the allowed-session set, or short-cache the assessment.
- **F3 (MEDIUM, resource)** `GET /audit/replay/:sessionID` returns `{ steps }` with no row cap (`audit.ts:154-155`); `Replay.reconstructStream` itself has no internal limit (`replay.ts:169-177`). Long sessions can produce arbitrarily large JSON responses. Add a `limit` / `toStep` query param consistent with the export route.
- **F4 (LOW, type safety)** `record.session_id as SessionID` at `audit.ts:76` is an unsafe cast on a value typed as `string` (`audit.ts:34`). Prefer `SessionID.make(record.session_id)` so the branded type is honoured and a malformed audit record surfaces loudly.
- **F5 (LOW, API contract)** Response descriptions on both export routes claim "JSON Lines" (`audit.ts:95, 114`) but handlers return a JSON envelope `c.json({ data: records })` (`audit.ts:107, 136`). SDK clients generated from the OpenAPI description will assume newline-delimited JSON. Align description and media type with the actual envelope.

No Critical findings; nothing in `findings/` to re-verify; no `reverify.md` required.

## Step 9 Verification and exit

Independent verification performed while writing this protocol:

1. Re-read `audit.ts` end-to-end and cross-referenced every imported symbol against its source.
2. Confirmed `parseCurrentProjectSessionID` is invoked on both `:sessionID` routes (`audit.ts:104`, `audit.ts:152`).
3. Confirmed `Session.list` default `limit=100` (`session/index.ts:629`) is the root cause of F1.
4. Confirmed `RiskEngine.fromSession` cost (`risk/score.ts:395-510`) for F2.
5. Confirmed there is no row cap on `Replay.reconstructStream` output (`replay.ts:169-177`) for F3.
6. Confirmed the description/handler media-type mismatch at `audit.ts:95, 107, 114, 136` for F5.

Disposition: F1 should be addressed before the next release because it produces silently incomplete audit exports; F2 and F3 are scaling concerns that can be sequenced; F4 and F5 are cleanups. Exit checklist: 9 steps complete, evidence paths recorded, no Critical items, no reverify.md required.
