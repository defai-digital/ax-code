# cli-cmd-audit — 9-step review

- Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
- Date: 2026-08-11
- Unit root: `packages/ax-code/src/cli/cmd/audit.ts` (209 LOC, 4 subcommands)
- Independent verifier (other lane): codex-sol

## Step 1 Scope and inventory

The unit root `packages/ax-code/src/cli/cmd/audit.ts` defines the `ax-code audit` yargs parent command (audit.ts:198) and four leaf commands: `prune` (audit.ts:11), `export` (audit.ts:57), `report` (audit.ts:131), and `otlp` (audit.ts:168). Three values cross the file boundary: `validateAuditPruneDays` (audit.ts:39), `parseAuditExportSince` (audit.ts:47), and `AuditCommand` (audit.ts:198). Commands are wrapped through `cmd()` (cmd.ts:5), a thin identity helper around yargs `CommandModule`. Supporting code lives in sibling modules I read directly: `../bootstrap` (bootstrap.ts:4), `../../audit/export` (export.ts:119, namespace `AuditExport`), `../../audit/json` (json.ts:6), `../../audit/report` (report.ts:162, namespace `AuditReport`), `../../replay/query` (query.ts:10, namespace `EventQuery`), and `../../risk/score` (Risk namespace, lazily imported at audit.ts:99). The unit is genuinely one file plus its collaborators; there are no other files in `src/cli/cmd/audit/`.

## Step 2 Threat and failure model

The handlers write to stdout/stderr, call `process.exit(1)` in four places (audit.ts:125, 153, 183, 188), and write to arbitrary filesystem paths via `--output` (audit.ts:158, `writeFile(args.output, report)`). They read `.ax-code/policy.json` indirectly through `AuditExport.policyContext` (export.ts:154–168), which correctly narrows on `ENOENT` and re-throws other errno codes. No secrets are ingested or printed by this file; the sensitive asset is the audit record stream itself, produced by `AuditExport`/`EventQuery`, not here. The CLI surface trusts yargs `choices` validation for `--risk` (audit.ts:78) and a custom `.check` for `--days` (audit.ts:21). The `--output` path is taken verbatim from `argv` with no containment check — acceptable for a local user-run CLI, but it silently overwrites existing files (no `--force` guard, no atomic temp+rename).

## Step 3 Correctness — control flow of public surfaces

`validateAuditPruneDays` (audit.ts:39–45) coerces with `Number(days)`, rejects non-integers and values `< 1`, and returns the integer. `parseAuditExportSince` (audit.ts:47–55) treats `undefined`/`null`/empty-trimmed-string as `undefined` (no filter), parses with `new Date(...).getTime()`, and throws on non-finite values. Both are correct and unit-covered (audit.test.ts:6–23).

The four handlers each wrap their body in `bootstrap(process.cwd(), async () => { ... })`. `bootstrap` (bootstrap.ts:4–17) wraps `cb()` in `try/finally` with `await Instance.dispose()` in the `finally`. **However**, four handler paths call `process.exit(1)` (audit.ts:125, 153, 183, 188). `process.exit` terminates synchronously and does not run pending microtasks or the `finally` block, so `Instance.dispose()` is skipped on those four paths. Concretely: `audit export` with neither `sessionID` nor `--all` (audit.ts:125), `audit report <bogusID>` (audit.ts:153), and `audit otlp` for a missing session (audit.ts:188) or when telemetry is disabled (audit.ts:183) all bypass dispose. For `otlp` this matters less on the disabled path (nothing was exported yet) and the success path explicitly calls `Telemetry.shutdown()` (audit.ts:192); the broader risk is dangling SQLite handles and other instance-scoped finalizers on the other three exit paths. This is the most material correctness issue in the file.

A second inconsistency: `audit export <sessionID>` (audit.ts:84–90) computes `EventQuery.count(sid)` only to print it; if the session does not exist the command writes zero lines and exits 0. Compare to `report` (audit.ts:151–154) and `otlp` (audit.ts:186–189), which both exit 1 on `count === 0`. An operator scripting off `audit export` cannot distinguish "valid empty export" from "typo'd session ID."

## Step 4 Performance

The risk-filter branch (audit.ts:98–117) streams every audit line via `AuditExport.streamAll` (export.ts:127–151), parses each line with `parseAuditJsonLineResult` (json.ts:6), and caches the per-session risk score in `sessionRisks` (audit.ts:102) so `Risk.fromSession` runs at most once per session — the right amortization, since `Risk.fromSession` (score.ts) itself loads events, diffs, and the semantic core. `EventQuery.allSince` paginates in 500-row chunks (query.ts:13, 291) using a stable `(time_created, session_id, sequence)` cursor (query.ts:262–279), so memory is bounded regardless of total audit-log size. The `--since` cutoff is forwarded into the SQL `WHERE` (audit.ts:103 → export.ts:127 → query.ts:264), not filtered in JS, which is correct. The main performance caveat is `process.stdout.write(line + EOL)` in a tight loop (audit.ts:89, 106, 115, 120, 161): the boolean return value (the backpressure signal) is ignored, so for multi-GB exports the Node stdout buffer can grow without bound. Realistic audit exports are far smaller, so the impact is low.

## Step 5 Design and ownership

The file mixes three concerns: argument coercion (`validateAuditPruneDays`, `parseAuditExportSince` — both exported and unit-tested), yargs command assembly, and runtime orchestration (streaming, risk filtering, file writing). The first two are well-factored; the runtime orchestration in the `--risk` branch (audit.ts:98–117) is inline and would benefit from extraction into `AuditExport` so it can be tested independently — but per the project's "don't extract with fewer than three call sites" rule there is only one caller today, so the current placement is acceptable. The `Risk.fromSession(sessionID as any)` cast (audit.ts:112) bypasses the `SessionID` branded identifier (schema.ts:3–4); `SessionID.make(sessionID)` would be more honest and is what the `export <sessionID>` branch already does (audit.ts:85). The `args.risk as string | undefined` cast (audit.ts:93) is a yargs-typing workaround and benign. The `handler: async () => {}` no-op on the parent `AuditCommand` (audit.ts:208) is correct given `.demandCommand()` on audit.ts:207.

## Step 6 Hygiene and dead code

No empty catch blocks — the only `try/catch` reachable from this file is in `AuditExport.policyContext` (export.ts:163), not here. No TODOs. No unused imports: `Argv`, `SessionID`, `cmd`, `bootstrap`, `AuditExport`, `parseAuditJsonLineResult`, `auditSessionIDFromRecord`, `EventQuery`, `EOL`, `writeFile` are all referenced, and `AuditReport`/`Telemetry`/`Risk` are intentionally lazy `await import(...)` (audit.ts:99, 148, 179) to keep startup cost off the non-exporting commands. The magic-number cutoff `days * 24 * 60 * 60 * 1000` (audit.ts:28) is the only stylistic smell; a named `MS_PER_DAY` would read better but is trivial. Module coupling is one-directional and shallow: `audit.ts → bootstrap / audit/* / replay / risk / session / telemetry`; nothing imports back into `cli/cmd/audit.ts` except the yargs registration in the CLI entrypoint, so there is no cycle.

## Step 7 Tests

`packages/ax-code/test/cli/audit.test.ts` (25 lines) exercises only `validateAuditPruneDays` and `parseAuditExportSince`. None of the four yargs handlers have direct integration coverage: the `export` (single + `--all` + `--risk`), `report` (stdout + `--output`), `otlp`, and `prune` code paths — including all four `process.exit(1)` branches — are untested. The MODULE-AUDIT.md file list (MODULE-AUDIT.md:34–48) is misleading here: those tests cover the `audit/*` and `cli/*` modules broadly, not the `audit.ts` command handlers. The structural reason is that every handler opens with `bootstrap(process.cwd(), ...)` (audit.ts:26, 82, 147, 178), which forces a real instance/SQLite bootstrap against `process.cwd()` and makes the handlers hard to drive without `process.chdir` or per-PID XDG isolation. A thin `runHandler(opts, directory)` seam that takes an explicit directory (matching `bootstrap`'s first parameter, bootstrap.ts:4) would unlock handler-level tests; until then the validators are the only realistically testable surface.

## Step 8 Findings

- **F1 [MEDIUM] lifecycle bypass**: `process.exit(1)` at audit.ts:125, 153, 183, 188 terminates synchronously before `Instance.dispose()` (bootstrap.ts:13 `finally`) can run, leaking SQLite handles and other instance-scoped finalizers on those four paths. Suggested fix: throw a typed `CliExitError(code)` from inside the callback and have a CLI top-level wrapper call `process.exit(code)` only after `bootstrap` (and thus `Instance.dispose()`) resolves.
- **F2 [LOW] UX inconsistency**: `audit export <sessionID>` exits 0 with zero output for an unknown session (audit.ts:84–90), while `report` (audit.ts:151–154) and `otlp` (audit.ts:186–189) exit 1 on `count === 0`. Suggested fix: mirror the `count === 0 → exit 1 + stderr message` guard in the `export` sessionID branch.
- **F3 [LOW] typing**: `Risk.fromSession(sessionID as any)` (audit.ts:112) bypasses the `SessionID` brand (schema.ts:3). Replace with `SessionID.make(sessionID)` to match the `export <sessionID>` branch (audit.ts:85).
- **F4 [LOW] backpressure**: `process.stdout.write(...)` return value is ignored in the export/report loops (audit.ts:89, 106, 115, 120, 161). For very large exports this can grow the stdout buffer; await `once(process.stdout, "drain")` when `write` returns false.
- **F5 [LOW] coverage gap**: zero handler-level tests; only the two pure validators are covered (audit.test.ts:6–23). See Step 7 for the suggested `runHandler(opts, directory)` seam.

No Critical or High findings. The findings ledger in MODULE-AUDIT.md (lines 64–66) currently lists `_none accepted_`; the five findings above should be recorded by the implementer on disposition.

## Step 9 Verification

Commands to run from the repo root for this unit:

- `pnpm --dir packages/ax-code run typecheck` — covers the audit.ts imports and the `SessionID` branded-cast finding (F3).
- `AX_TEST_FILES=test/cli/audit.test.ts pnpm --dir packages/ax-code exec vitest run` — the targeted-file invocation documented in `packages/ax-code/test/AGENTS.md`, exercising the two unit-covered validators.
- `pnpm run test:scripts` — root script tests, per the AGENTS.md verification matrix.

I did not modify `audit.ts` (this is a read-only review pass), so no native rebuild or full build is required. The lifecycle finding F1 is the only one I would gate sign-off on; F2–F5 are LOW and suitable for a follow-up cleanup PR. Independent verifier (codex-sol) should re-read audit.ts:125/153/183/188 against bootstrap.ts:9–14 to confirm F1 before the gate closes.
