# Nine-step review: storage

## Step 1 Scope and boundaries

The `storage` unit has two persistence paths with distinct responsibilities. `packages/ax-code/src/storage/db.node.ts:6-15` creates the Node SQLite handle, while `packages/ax-code/src/storage/db.ts:35-150` selects the database path, applies startup policy, loads the journal, and exposes the lazy client. Legacy JSON state and its migration marker remain owned by `packages/ax-code/src/storage/storage.ts:14-30` and `packages/ax-code/src/storage/storage.ts:247-333`. The schema barrel at `packages/ax-code/src/storage/schema.ts:1-21` deliberately gathers tables owned by account, project, session, share, prompt-history, and workflow modules.

## Step 2 Assets and failure modes

The protected assets are committed SQLite rows, legacy JSON records, migration position, and session-share credentials. `packages/ax-code/src/storage/json-migration.ts:489-513` validates share id/secret/url before inserting them, and its logs report counts or source paths rather than secret values (`packages/ax-code/src/storage/json-migration.ts:535-550`). Principal failure modes are malformed JSON, orphaned foreign-key children, lock contention, interrupted migration, WAL growth, and power loss; the durability trade-off is explicit in `packages/ax-code/src/storage/db.ts:92-104` and the concrete limits live at `packages/ax-code/src/storage/policy.ts:1-14`.

## Step 3 Correctness and atomicity

SQLite startup configures foreign keys before applying journal entries (`packages/ax-code/src/storage/db.ts:104-147`). Root transactions establish one context, reject Promise-returning callbacks, commit through Drizzle, and only then run queued effects (`packages/ax-code/src/storage/db.ts:277-326`); nested calls reuse that context. The JSON import wraps all table inserts in `BEGIN TRANSACTION`, attempts rollback on any error, preserves the original error even if rollback fails, and commits only after every entity class is processed (`packages/ax-code/src/storage/json-migration.ts:240-242` and `packages/ax-code/src/storage/json-migration.ts:522-533`).

## Step 4 Performance and concurrency

The importer scans each entity family once (`packages/ax-code/src/storage/json-migration.ts:189-209`), limits reads to 32 workers (`packages/ax-code/src/storage/json-migration.ts:133-154`), and tries multi-row inserts before isolating a bad row (`packages/ax-code/src/storage/json-migration.ts:157-186`). Runtime JSON operations combine process-local reader/writer locks with a cross-process file lock for remove, read, update, and write (`packages/ax-code/src/storage/storage.ts:335-402`). SQLite uses a 15-second busy timeout, WAL autocheckpointing, and a bounded journal (`packages/ax-code/src/storage/policy.ts:6-13`), with a TRUNCATE checkpoint on graceful close (`packages/ax-code/src/storage/db.ts:169-189`).

## Step 5 Design and ownership

The runtime-specific database construction is isolated to `packages/ax-code/src/storage/db.node.ts:1-15`; orchestration depends on it through the `#db` alias at `packages/ax-code/src/storage/db.ts:18`. `packages/ax-code/src/storage/migrate-journal.ts:23-32` is a narrow compatibility adapter that converts bundled journal entries into the shared Drizzle dialect shape. `packages/ax-code/src/storage/schema.sql.ts:3-10` owns only reusable timestamp columns, while `packages/ax-code/src/storage/schema.ts:1-21` is a discoverability barrel rather than a second schema authority. These boundaries avoid coupling table definitions to the Node driver.

## Step 6 Error handling and code hygiene

Expected best-effort failures are observable: startup and shutdown checkpoint failures are warned with path and normalized error data (`packages/ax-code/src/storage/db.ts:105-112` and `packages/ax-code/src/storage/db.ts:175-180`), and legacy corrupt records are warned per file (`packages/ax-code/src/storage/storage.ts:55-70` and `packages/ax-code/src/storage/storage.ts:168-177`). The only actual empty catch is the checkpoint-existence probe at `packages/ax-code/src/storage/storage.ts:287-296`, where absence is the normal case and an adjacent comment states that intent. The low finding's cited `packages/ax-code/src/storage/storage.ts:436` is text inside a comment about an old bare catch; current `list` code returns empty only for ENOENT and rethrows other errors at lines 433-441.

## Step 7 Test coverage

`packages/ax-code/test/storage/db.test.ts:23-60` verifies every startup pragma and the non-fatal checkpoint warning. Marker parsing is exercised for malformed, numeric, and out-of-range inputs at `packages/ax-code/test/storage/storage.test.ts:4-33`. Import rollback behavior is checked at `packages/ax-code/test/storage/json-migration.test.ts:144-172`, and mixed corrupt plus valid data is asserted through all entity tables at `packages/ax-code/test/storage/json-migration.test.ts:822-946`. The Critical legacy-copy behavior is source-verifiable, but there is no focused test that drives the older `Storage` migration catches at `packages/ax-code/src/storage/storage.ts:55-70`; that is a non-blocking regression-coverage gap.

## Step 8 Finding dispositions

`AUDIT-storage-001` remains verified-fixed: corrupt message, session, part, and summary JSON is warned and skipped without advancing through an uncaught per-record error (`packages/ax-code/src/storage/storage.ts:55-70`, `packages/ax-code/src/storage/storage.ts:168-177`, and `packages/ax-code/src/storage/storage.ts:207-212`). `AUDIT-storage-empty-catch` remains Low/deferred as recorded, but its extracted site is stale: the relevant empty catch is the documented checkpoint probe at lines 287-296, whereas operational listing failures are no longer swallowed at `packages/ax-code/src/storage/storage.ts:433-441`. No new Critical defect was identified in this review.

## Step 9 Verification and exit

The exact storage test selection completed with four files and 33 passing tests: `AX_TEST_FILES=test/storage/db.test.ts,test/storage/storage.test.ts,test/storage/json-migration.test.ts,test/storage/session-parent-fk.test.ts pnpm --dir packages/ax-code exec vitest run`. The foreign-key test covers rejection of orphan parents and nulling on parent deletion at `packages/ax-code/test/storage/session-parent-fk.test.ts:30-67` and `packages/ax-code/test/storage/session-parent-fk.test.ts:69-129`. `pnpm --dir packages/ax-code run typecheck` also completed successfully. The source evidence, findings, and verification results support completing all nine review steps for slug `storage`.
