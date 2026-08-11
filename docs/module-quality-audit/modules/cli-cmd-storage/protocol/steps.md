# Protocol — cli-cmd-storage (9-step review)

Unit slug: `cli-cmd-storage`
Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Verifier lane: codex-sol
Scope root: `packages/ax-code/src/cli/cmd/storage`
Baseline commit: `5fefa00cdc847667d3ba3d38509a751498ee4180`

## Step 1 — Scope and map

Five TypeScript files compose the `ax-code storage` CLI subtree. `packages/ax-code/src/cli/cmd/storage/db.ts` (143 lines) exports `DbCommand` and registers `QueryCommand` (`$0 [query]`), `PathCommand`, and `MigrateCommand`. `packages/ax-code/src/cli/cmd/storage/export.ts` (89 lines) exports `ExportCommand`. `packages/ax-code/src/cli/cmd/storage/import.ts` (102 lines) exports `readSessionTransferFile` and `ImportCommand`. `packages/ax-code/src/cli/cmd/storage/session.ts` (505 lines) exports the `SessionCommand` tree plus six subcommand builders (`SessionListCommand`, `SessionDeleteCommand`, `SessionPruneCommand`, `SessionBackupProjectCommand`, `SessionClearProjectCommand`, `SessionProjectStatusCommand`) and the `sessionProjectStatusPayload` helper. `packages/ax-code/src/cli/cmd/storage/transfer.ts` (116 lines) exports the `TransferEvent` / `SessionTransfer` types plus the `buildTransfer` / `writeTransfer` primitives. Every command is wired through the identity helper `cmd()` (`packages/ax-code/src/cli/cmd/cmd.ts:5`) and, where state is needed, through `bootstrap()` (`packages/ax-code/src/cli/bootstrap.ts:4`), which provisions `Instance` and disposes it in a `finally` block. `transfer.ts` is the shared kernel reused both by `export.ts` (static import of `buildTransfer` at line 10) and by `session.ts` (dynamic import of `buildTransfer` at line 138 for the project-backup path).

## Step 2 — Threat and failure model

The trust boundary that actually ingests untrusted bytes is `readSessionTransferFile` (`packages/ax-code/src/cli/cmd/storage/import.ts:43`), which reads an arbitrary JSON file and runs it through a deliberately permissive zod schema (`.passthrough()` at import.ts:20, 30, 34 — only `id` on records and `sequence`/`timeCreated` on events are required). Stricter validation is deferred to `Session.Info.parse` / `MessageV2.Info.parse` / `MessageV2.Part.parse` inside `writeTransfer` (transfer.ts:56, 73, 86). The deletion surfaces are `SessionClearProjectCommand` (session.ts:214, calls `Session.remove` at line 257), `SessionDeleteCommand` (session.ts:375, removes at line 396), and `SessionPruneCommand` (session.ts:340, delegates to `Session.pruneExpired` at line 363). `clear-project` always writes a backup first (session.ts:238) and is dry-run by default unless `--yes` is passed (session.ts:251). `db.ts` executes raw user SQL via `db.prepare(query).all()` (db.ts:50) but on a handle opened `readOnly: true` (db.ts:45, 16) — acceptable for a local developer DB shell. No network calls, no secret material, and no environment-variable expansion appear in any of the five files.

## Step 3 — Correctness

Confirmed atomicity: `writeTransfer` wraps every insert in `Database.transaction` (transfer.ts:66), and `packages/ax-code/src/storage/db.ts:314-329` shows that `Database.transaction` binds to `Client().transaction`, so a mid-batch FK violation rolls the whole import back — matching the all-or-nothing intent stated in the transfer.ts:61-65 comment.

Genuine correctness defects found this pass:

- `packages/ax-code/src/cli/cmd/storage/import.ts:83-94` — on a read/parse failure the handler writes the error to stdout and `return`s, so the process exits 0. `ax-code storage import missing.json` therefore reports success to a shell `&&` chain. Scripting hazard (Low/Medium).
- `packages/ax-code/src/cli/cmd/storage/export.ts:83-86` — the catch reports `Session not found: ${sessionID!}` for any error thrown by `Session.get`, `Session.messages`, `EventQuery.bySessionLog`, or `buildTransfer`. A DB error or message-fetch failure is mislabeled "not found", hiding the root cause from the operator (Low).
- `packages/ax-code/src/cli/cmd/storage/session.ts:256-260` — `clear-project` deletes only `deletionRoots` when any are present, but the success line at session.ts:260 prints `sessions.length`. The reported deletion count overstates the rows actually removed when roots are a strict subset of all sessions (Low, cosmetic but misleading for a destructive op).
- `packages/ax-code/src/cli/cmd/storage/db.ts:11-16` — `openDatabase` runs `mkdirSync` + `openSync(dbPath, "a")` (db.ts:14-15) even when `readonly: true`, so a read-only query creates or touches the DB file. Benign, but it contradicts the read-only contract the option advertises (Low hygiene).
- `packages/ax-code/src/cli/cmd/storage/db.ts:48-66` — the query path calls `db.close()` outside a `finally`. It is correct today because `db.close()` is the sole statement after try/catch, but the shape is fragile to future edits; a `try/finally` would be safer.

No Critical or High correctness defects: the transactional import prevents half-written state, and the destructive `clear-project` path is backup-gated.

## Step 4 — Performance

`packages/ax-code/src/cli/cmd/storage/session.ts:142-154` `backupSessions` loops over every session and, per session, awaits `Session.messages` and `EventQuery.bySessionLog`, accumulating all transfers in a single in-memory array before one `Filesystem.writeJson` at session.ts:155. For a project with many sessions this is O(N) awaited round trips and one large resident buffer; acceptable for an explicit, operator-run backup, but it should become a streaming writer (newline-delimited JSON or per-session appends) if session counts grow. `formatSessionTable` (session.ts:479-480) spreads every id/title length into `Math.max` — fine at typical N. The `db.ts` query path is single-statement; no N+1. `transfer.ts:100` sorts the events array on every import, which is trivially sized. No hot-path concerns in normal CLI use.

## Step 5 — Design and coupling

Layering is clean: all five files depend downward on `../../../session`, `../../../replay`, `../../../storage`, `../../../project`, never the reverse, and `transfer.ts` is the reused kernel for both the export and the backup paths. Two design inconsistencies are worth noting. First, `packages/ax-code/src/cli/cmd/storage/transfer.ts:69` uses `onConflictDoUpdate` (updating only `project_id`) for the session row while messages (transfer.ts:82), parts (transfer.ts:95), and events (transfer.ts:112) all use `onConflictDoNothing`. Re-importing an existing session therefore mutates only `project_id` and silently drops any changed message/part/event payloads — an insert-only policy that the public name `writeTransfer` does not advertise. Either unify the conflict policy or document the asymmetry at the function. Second, `writeTransfer` unconditionally overrides `info.projectID` with `Instance.project.id` (transfer.ts:58). This is intentional for current-project import and is consistent with the backup writer at session.ts:162, but it makes cross-project restore lossy with respect to origin attribution — worth a one-line comment so future readers do not treat it as a bug. `session.ts` at 505 lines is the largest file; splitting the backup/clear block (session.ts:130-294) into a sibling module would improve navigability but is not urgent.

## Step 6 — Dead code and hygiene

No dead exports were detected: all 16 surfaced symbols are consumed by the CLI wiring or by neighboring test files. The single empty catch is at `packages/ax-code/src/cli/cmd/storage/session.ts:453` (`try { return Process.killProcessTree(proc) } catch {}`), already registered as `AUDIT-cli-cmd-storage-empty-catch` (Low, silent-error, deferred). Its disposition as best-effort during shutdown is defensible — killing the pager must not itself abort the process — but adding a debug-level log would satisfy the `needs-log` tag without changing behavior. The ANSI literal constants in `db.ts:91-93` (`orange`, `muted`, `reset`) are local and fine. The two-step validation in `import.ts` (loose zod gate at import.ts:11-34, then strict parse inside `writeTransfer`) is deliberate — cheap structural rejection before the expensive `Session.Info.parse` — but the rationale is not commented at the schema declaration and should be. No TODOs, no commented-out blocks, no unused imports across the five files.

## Step 7 — Tests

The test inventory in `MODULE-AUDIT.md` lists fifteen files under `packages/ax-code/test/`, but none of them exercise `packages/ax-code/src/cli/cmd/storage` directly — they cover account, acp, agent, audit, boot, and TUI concerns. The highest-leverage gaps for this unit are: (a) `writeTransfer` rollback — inject a part whose `message_id` was never inserted and assert the whole transaction rolls back so no orphan session row remains; (b) `readSessionTransferFile` — assert it returns `{ error }` rather than throwing for both `ENOENT` (import.ts:62) and a structurally invalid file missing `sequence` (import.ts:16); (c) the `export.ts` failure path — stub `Session.get` to throw a synthetic DB error and assert the surfaced message reflects the real cause rather than the generic "Session not found" string at export.ts:84. These are low-cost, high-signal additions and would also pin the behaviors flagged in Step 3.

## Step 8 — Finding register

Carried forward:

- `AUDIT-cli-cmd-storage-empty-catch` — Low, silent-error, deferred — `session.ts:453` empty catch in the pager kill path. Confirmed present; keep disposition, add a debug log when the file is next touched.

New this pass (all Low, none Critical/High):

- `export.ts:83-86` misleading "Session not found" catch masks arbitrary failures.
- `import.ts:83-94` import failure exits 0 (stdout message + `return`), breaking shell `&&` chains.
- `session.ts:256-260` `clear-project` success count uses `sessions.length` while only `deletionRoots` are removed.
- `transfer.ts:69` vs `transfer.ts:82/95/112` conflict-policy asymmetry between session row and message/part/event rows (design clarity).
- `db.ts:14-16` `openDatabase` creates the file even when `readonly: true` (hygiene).

The destructive `clear-project` path is backup-gated (session.ts:238) and the transactional import (transfer.ts:66) prevents partial writes, so none of the new items warrant escalation to Critical.

## Step 9 — Verification and exit

This is a read-only review lane; the suite was not executed here. Cross-checks performed against source: the `Database.transaction` atomicity claim in `transfer.ts:66` was verified against `packages/ax-code/src/storage/db.ts:314-329` (it delegates to `Client().transaction`), and the `bootstrap()` disposal contract used by every stateful command was verified at `packages/ax-code/src/cli/bootstrap.ts:4-16` (cleanup runs in `finally`). Because no Critical findings exist in `findings/` or arose this pass, the dual-agent Critical-verify gate is satisfied trivially and no `protocol/reverify.md` is required. Recommended commands for the implementer who picks up the Low items: `pnpm --dir packages/ax-code run typecheck` after edits, and a targeted `AX_TEST_FILES=test/cli/<new>.test.ts pnpm exec vitest run` once the Step-7 transfer/import tests land. Recommended status transition for `MODULE-AUDIT.md`: `REVIEWING` → `REVIEWED` once the four new Low findings are filed and the empty-catch item is resolved or formally accepted.
