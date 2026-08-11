# Nine-step review: share

Unit slug: `share`  
Reviewer: codex-sol  
Verifier lane: ax-code-glm

## Step 1 Establish Scope and Public Contract

The `share` unit consists of the persistence definition in `packages/ax-code/src/share/share.sql.ts:5-13`. Its only export is `SessionShareTable`, and the central schema barrel re-exports that table at `packages/ax-code/src/storage/schema.ts:13`. The row contract permits one share record per session because `session_id` is the primary key (`share.sql.ts:6-8`); the remaining stored fields are the remote share identifier, secret, URL, and common timestamps (`share.sql.ts:9-12`). The audit inventory independently identifies the same one-file scope and one export at `docs/module-quality-audit/modules/share/MODULE-AUDIT.md:20-32`.

## Step 2 Inspect Sensitive Data and Trust Boundaries

The security-sensitive value is explicitly persisted as non-null plaintext in `packages/ax-code/src/share/share.sql.ts:10`, alongside the share URL at line 11. The legacy JSON importer is the only production writer found: it derives the session identity from the filename, rejects an absent `id`, `secret`, or `url`, and inserts the accepted object at `packages/ax-code/src/storage/json-migration.ts:489-513`. Its diagnostics disclose the source filename and field names, not the secret value (`json-migration.ts:504-505`), and its completion log emits only a count (`json-migration.ts:517`). The active session projection reads the separate `session.share_url` column at `packages/ax-code/src/session/index.ts:78-100`; it does not expose `SessionShareTable.secret`. Plaintext storage remains a local-at-rest sensitivity, but this review found no logging or API projection of that credential.

## Step 3 Verify Relational and Insert Correctness

`packages/ax-code/src/share/share.sql.ts:6-8` ties each share row to `SessionTable.id` and requests `ON DELETE CASCADE`; the original generated DDL confirms the same primary key and foreign-key action at `packages/ax-code/migration/20260127222353_familiar_lady_ursula/migration.sql:75-82`. Required payload columns are non-null (`share.sql.ts:9-11`), while `Timestamps` supplies insert/update time behavior at `packages/ax-code/src/storage/schema.sql.ts:3-10`. Before insertion, migration code checks the derived session ID against the already migrated session set (`packages/ax-code/src/storage/json-migration.ts:499-503`), so ordinary migration does not rely solely on an FK failure to reject an orphan. One type-hardening opportunity remains: `session_id` is unbranded `text()` in `share.sql.ts:6`, whereas `SessionTable.id` is branded with `SessionID` at `packages/ax-code/src/session/session.sql.ts:15-18`; the runtime FK and filename conversion still enforce the relationship.

## Step 4 Review Lifecycle, Concurrency, and Cost

There is no executable loop or in-memory state in `share.sql.ts`; lifecycle behavior comes from SQLite. Session removal deletes descendants and the root within one database transaction at `packages/ax-code/src/session/index.ts:757-785`, allowing the cascade to remove corresponding share rows atomically. The regression observes an empty share table after deleting a parent and child at `packages/ax-code/test/session/session.test.ts:273-304`. Import cost is bounded: JSON records are processed in batches of 1,000 with 32 read workers (`packages/ax-code/src/storage/json-migration.ts:126-154`), and the insert helper first uses a multi-row statement before isolating bad rows (`json-migration.ts:157-180`). The primary key already supports the table's session-keyed conflict and deletion paths, so no additional index is justified by the observed consumers.

## Step 5 Evaluate Ownership and Representation Boundaries

The table definition is cohesive and depends only on the owning session table and shared timestamp mixin (`packages/ax-code/src/share/share.sql.ts:1-3`). Storage integration imports it directly for legacy conversion at `packages/ax-code/src/storage/json-migration.ts:14-16`, while current session serialization owns the user-visible share URL through `share_url` at `packages/ax-code/src/session/index.ts:134-155`. This creates two historical representations—`session_share.url` and `session.share_url`—but current code does not pretend they are synchronized: the cascade test deliberately populates both independently at `packages/ax-code/test/session/session.test.ts:284-299`. If remote sharing is reactivated, the implementation must explicitly select an authority rather than treating these columns as interchangeable; today the table's live obligation is compatibility and cleanup.

## Step 6 Examine Hygiene and Failure Handling

The candidate is a compact declarative schema with no branches, exception suppression, casts, or maintenance markers in `packages/ax-code/src/share/share.sql.ts:1-13`. Failure policy sits in the importer: unreadable JSON is recorded per file at `packages/ax-code/src/storage/json-migration.ts:138-150`, malformed share payloads are skipped at lines 496-506, and a failed bulk insert falls back to individual records at lines 157-183. The overall migration wraps dependent inserts in a transaction beginning at `json-migration.ts:240-241` and commits only after shares at line 522. The validation is deliberately structural and truthiness-based rather than semantic—there is no URL parser or secret-strength rule—but no runtime consumer reads these legacy values, so that limitation is a future-reactivation concern rather than a current correctness defect.

## Step 7 Assess Behavioral Coverage

Happy-path preservation is covered at `packages/ax-code/test/storage/json-migration.test.ts:625-655`, including exact assertions for session ID, remote ID, secret, and URL. Orphan handling is exercised by paired valid and missing-session share files at `json-migration.test.ts:798-819`, and the mixed-corruption case combines a valid share, orphan, and invalid JSON at lines 909-945. Cascading cleanup is separately exercised at `packages/ax-code/test/session/session.test.ts:272-305`. The main narrow gap is share-specific conflict coverage: the generic idempotence case at `json-migration.test.ts:507-520` creates only a project, so it does not directly prove that a second legacy share file for the same session preserves the intended first-row semantics of `onConflictDoNothing()` at `packages/ax-code/src/storage/json-migration.ts:510-513`.

## Step 8 Reconcile Compatibility and Findings

The checked-in DDL has preserved the same five data columns, timestamp columns, session primary key, and cascade relation since its creation (`packages/ax-code/migration/20260127222353_familiar_lady_ursula/migration.sql:75-82`), and the schema still matches that contract at `packages/ax-code/src/share/share.sql.ts:5-12`. The module register contains no accepted issue at `docs/module-quality-audit/modules/share/MODULE-AUDIT.md:46-50`, and there are no files under this unit's `findings/` path. This pass found no Critical defect. The unbranded TypeScript key, plaintext-at-rest sensitivity, dual URL representation, and share-specific idempotence gap are documented as non-blocking hardening or coverage observations; none demonstrates a present data leak, broken cascade, or failed migration. Therefore no Critical secondary-confirmation artifact is warranted.

## Step 9 Execute Verification and Determine Exit

The exact-file run `AX_TEST_FILES=test/session/session.test.ts,test/storage/json-migration.test.ts pnpm exec vitest run` completed with 2 files and 36 tests passing, exercising the cascade assertion at `packages/ax-code/test/session/session.test.ts:301-304` and migrated secret/URL assertions at `packages/ax-code/test/storage/json-migration.test.ts:644-654`. `pnpm --dir packages/ax-code run typecheck` also completed successfully, covering the schema re-export at `packages/ax-code/src/storage/schema.ts:13` and the inferred insert type used at `packages/ax-code/src/storage/json-migration.ts:68-74`. With focused behavior and static typing green, no Critical finding, and the compatibility risks recorded above, the codex-sol review of `share` is complete for verifier handoff.
