---
name: safe-db-migration
description: Plan or write a database schema change using expand/backfill/contract, with lock and rollback checks. Use when adding/altering/dropping columns or tables, backfilling data, or touching migration files.
agent: devops
argument-hint: <schema change, e.g. "add nullable user.locale then backfill">
---

Handle the database change in $ARGUMENTS without relying on "the tests passed" as the only safety net.

## Phase 1 - Inventory

- Find the migration tool the repo already uses (Prisma, Drizzle, Alembic, Active Record, golang-migrate, Flyway, raw SQL). Do not introduce a new one.
- Read the current schema and recent migrations. Note existing indexes, constraints, and how the app reads/writes the affected tables.

## Phase 2 - Classify risk

Call out, with file evidence:

- **Expand-only** (add nullable column, add table) vs **rewrite** (change type, drop, rename).
- Lock risk on large tables (full table rewrite, add unique index without concurrent option).
- Compatibility: can the current app binary run against the new schema and the new app binary run against the old schema?
- Data loss / NOT NULL backfill / default rewrites.

If the change is destructive and the user did not explicitly accept data loss, stop and propose expand/backfill/contract instead of a one-shot rewrite.

## Phase 3 - Plan (required for anything beyond expand-only)

Write a short plan before editing:

1. Expand migration (additive, reversible).
2. Deploy/migrate order vs application code.
3. Backfill strategy (batched, idempotent, estimated rows if known).
4. Contract migration (drop old column) only after both app versions no longer need it.
5. Rollback: down migration or explicit "not automatically reversible" with why.

## Phase 4 - Implement

- Prefer additive SQL. Avoid `DROP`, `RENAME`, and in-place type changes unless the user accepted the outage/lock.
- Keep migrations idempotent when the tool allows it.
- Do not put irreversible data transforms in the same step as a lock-heavy DDL change.
- Do not run migrate against a shared/prod database. Local/dev apply is allowed when the user asked to verify locally.

## Phase 5 - Verify

- SQL/schema review: the generated migration matches the plan.
- If a local database exists and the user asked to apply: migrate up, run the relevant tests, then state how to migrate down.
- Report: files, expand vs contract, lock notes, rollback, and what was **not** executed.

## Constraints

- Never guess production row counts or lock duration. Mark unknowns.
- Never store credentials in the migration.
- Application code that requires the new column must tolerate NULL until backfill completes.
