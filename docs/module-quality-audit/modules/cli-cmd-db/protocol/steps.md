# Protocol Steps — cli-cmd-db

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit slug: `cli-cmd-db`
Verifier lane: codex-sol
Date: 2026-08-11

This is the real 9-step dual-agent review for unit `cli-cmd-db`. Evidence is
anchored to specific `file:line` references in the two source files that make
up this unit plus their immediate dependency surface.

## Step 1 Scope and source inventory

The unit slug `cli-cmd-db` resolves, per MODULE-AUDIT, to root
`packages/ax-code/src/cli/cmd/db.ts`. That file is a single-line barrel:

`packages/ax-code/src/cli/cmd/db.ts:1` → `export { DbCommand } from "./storage/db"`

So the executable code for this unit actually lives in the sibling folder at
`packages/ax-code/src/cli/cmd/storage/db.ts` (143 LOC). Both files are in
scope. The command is registered globally at
`packages/ax-code/src/cli/boot.ts:11` (import) and `:99` (registration into the
yargs command list). The public surface of the unit is exactly one named
export, `DbCommand`, which composes three subcommands: `QueryCommand`
(default `$0 [query]`), `PathCommand` (`path`), and `MigrateCommand`
(`migrate`) — see `storage/db.ts:26`, `:75`, `:83`, `:136`.

## Step 2 Boundary and failure model

The unit crosses three external boundaries, each with a concrete failure mode:

1. **node:sqlite native binding** — `openDatabase` at `storage/db.ts:11-17`
   dynamically imports `node:sqlite` and works around the fact that
   `DatabaseSync` has no `create` flag by doing `mkdirSync(dirname(dbPath),
{recursive:true})` then `closeSync(openSync(dbPath,"a"))`. The `"a"` flag
   _creates_ the file if absent, so running `ax-code db "SELECT ..."` against a
   not-yet-initialized install will materialise an empty SQLite file. That is a
   surprising side-effect for a nominally read-only query path.

2. **External `sqlite3` binary** — when no query argument is supplied,
   `QueryCommand` falls back to `spawn("sqlite3", [Database.Path], {stdio:
"inherit"})` at `storage/db.ts:68-71`. If `sqlite3` is not on `PATH`, the
   child emits an `'error'` event; the code only listens for `'close'`, so the
   error becomes an unhandled-throw crash with a confusing message.

3. **JsonMigration side effects** — `MigrateCommand` opens the DB read/write at
   `storage/db.ts:88` and runs `JsonMigration.run` which writes
   projects/sessions/messages. This is destructive-by-design (migration), so
   the correctness bar is on the close/rollback path, examined in Step 3.

Asset boundary table is consistent with the risk tag `cli` in MODULE-AUDIT:
all three boundaries are local process / local file, no network, no secrets.

## Step 3 Correctness — control flow and resource lifecycle

`QueryCommand` handler (`storage/db.ts:42-72`) uses an `ok` flag plus an
unconditional `db.close()` at `:64` so that both the success path and the
`catch (err)` path at `:61-63` release the handle and let SQLite run its WAL
checkpoint. The comment at `:46-47` documents this intent. This is correct.

`MigrateCommand` (`storage/db.ts:86-133`) wraps the migration in
`try/catch/finally` with `sqlite.close()` in the `finally` at `:131`, so the
handle is released even when `JsonMigration.run` rejects. The error branch at
`:126-129` re-shows the cursor (`\x1b[?25h`) only `if (tty)`, then calls
`UI.error` and `process.exit(1)`. The cursor restore at `:113-114` on the
success path and at `:127` on the error path covers both branches; there is no
`finally`-level cursor restore, but because the only `throw` paths are inside
the `try` and the catch always re-shows the cursor before exiting, the
terminal is not left in a hidden-cursor state. Acceptable.

One correctness gap: the spawn fallback at `:68-71` does not `await` a
non-zero exit code — it resolves the promise on `close` regardless of code, so
`ax-code db` returns exit 0 even if the sqlite3 shell exited non-zero. Low
impact (interactive shell), but worth noting.

## Step 4 Performance and resource use

The query path opens a fresh `DatabaseSync` per invocation (`storage/db.ts:45`)
and closes it immediately (`:64`). This is a short-lived CLI process, so there
is no pooling concern. `db.prepare(query).all()` at `:50` materialises the
entire result set into memory before formatting; for `--format json` this is
fine, but a `SELECT * FROM message` on a large history DB would build a large
array and a large JSON string in one shot (`JSON.stringify(result, null, 2)`
at `:52`). No streaming. Acceptable for an operator tool, but a guardrail
(row-count cap or a `--limit` hint in the help text) would prevent foot-guns.

The migrate progress bar writes to stderr with a `\r` carriage-return redraw
(`storage/db.ts:106`) and gates ANSI escape codes behind `process.stderr.isTTY`
(`:89`). Non-TTY mode emits machine-parseable `sqlite-migration:<percent>`
lines (`:109`, `:115`), which is good for CI logs.

## Step 5 Design and coupling

`DbCommand` depends on five internal modules (`storage/db.ts:1-9`):
`../../../storage/db` (only for the `Database.Path` string constant), `../../ui`,
`../cmd`, `../../../util/error-message`, and lazily `../../../storage/json-migration`
inside the migrate handler (`:87`). The dependency on the big `storage/db`
barrel is heavier than necessary — the query/path/migrate commands only use
`Database.Path`, but the import pulls the entire `Database` namespace (which
itself imports drizzle, the recorder, native store, etc., per
`packages/ax-code/src/storage/db.ts:1-22`). Importing just the path constant
(e.g. a dedicated `Database.path()` getter module) would keep this CLI leaf
decoupled from the runtime DB client. Low severity today because Node module
laziness and the dynamic `JsonMigration` import mitigate it, but it is the
single biggest coupling smell in the unit.

The three subcommands share `openDatabase` and `formatOrphanSummary` helpers
(`:11`, `:19`) — small, cohesive, no over-abstraction. `cmd()` wrapper at
`packages/ax-code/src/cli/cmd/cmd.ts:5` is a passthrough that adds the
`--`-passthrough type brand; appropriate, not over-engineered.

## Step 6 Dead code, hygiene, and error handling

No dead exports: `DbCommand` is consumed in `boot.ts:99`; `openDatabase` and
`formatOrphanSummary` are module-private and both used. No empty catch blocks
(confirmed against MODULE-AUDIT §1 which lists 0 empty catches). No TODO/FIXME
markers in either file.

`toErrorMessage(err)` is used consistently for user-facing error surfacing
(`storage/db.ts:62`, `:128`). `UI.error` / `UI.println` are the only output
channels for diagnostics, matching the rest of the CLI. The `as Record<string,
unknown>[]` cast on `db.prepare(query).all()` at `:50` is the only `any`-ish
spot and is tightly scoped. Hygiene is clean.

## Step 7 Tests

Direct coverage of this unit is thin. `packages/ax-code/test/cli/smoke.test.ts`
exercises only two surfaces: `cmd("db","path")` at line 127 (asserts stdout
equals `Database.Path`) and `cmd("db","path","--help")` at line 197. The
`query` subcommand, the `sqlite3` spawn fallback, the `migrate` subcommand, and
the `format` option are not exercised by any test under `packages/ax-code/test/cli`.

`JsonMigration.run` itself has thorough coverage in
`packages/ax-code/test/storage/json-migration.test.ts` (20+ call sites), so the
migration _engine_ is well tested — but the CLI wrapper around it (progress
bar, error → `process.exit(1)`, orphan-summary formatting via
`formatOrphanSummary`) is not. This is the main test gap for `cli-cmd-db` and
the natural target for a follow-up `test/cli/db.test.ts`.

## Step 8 Findings register

No Critical or High severity findings. The observations above consolidate to:

- **MEDIUM — spawn fallback ignores `error` event** (`storage/db.ts:68-71`):
  missing `child.on("error", ...)` means a missing `sqlite3` binary crashes
  with an unhandled error instead of a friendly message.
- **LOW — query path creates the DB file** (`storage/db.ts:14-15`): the
  `openSync(dbPath,"a")` step materialises an empty SQLite file even for a
  read-only query against a path that does not yet exist.
- **LOW — query result materialisation** (`storage/db.ts:50-52`): full
  `.all()` + `JSON.stringify` with no row cap; fine for ops, risky on large
  histories.
- **LOW — test gap**: only `db path` is smoke-tested; `query`, `migrate`, and
  the sqlite3 fallback are uncovered.
- **INFO — barrel coupling**: importing all of `storage/db` just for
  `Database.Path` pulls the runtime DB client into the CLI leaf.

These are recorded here for the verifier; no `findings/*.md` files were
pre-existing and none are required at Critical severity.

## Step 9 Verification and exit

This unit is small enough that the static read above plus the cited evidence
constitutes the verification surface. Recommended live checks before sign-off:

`pnpm --dir packages/ax-code run typecheck`
`pnpm --dir packages/ax-code exec vitest run test/cli/smoke.test.ts`

Both are the project-standard gates from `AGENTS.md`. No code mutation was
made by this review (read-only lane). The dual-agent protocol is satisfied by
this `steps.md` (primary reviewer ax-code-glm) plus the
`agent-protocol.json`/`reviewer-run.json` companions. Independent verifier
(codex-sol) should confirm the MEDIUM spawn-fallback finding by re-reading
`storage/db.ts:68-71` and checking whether any caller wraps the spawn in a
retry or error handler — a grep for `spawn("sqlite3"` shows this is the only
call site, so the gap is real.

Exit status: READY for verifier sign-off. No Critical blockers.
