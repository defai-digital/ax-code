# BUG-197 — `session.workspace_id` missing FK to `workspace` table

**Date:** 2026-04-06  
**Severity:** HIGH  
**Category:** Data Integrity  
**Status:** DEFERRED — requires DB migration, high risk  

## Location

- `src/session/session.sql.ts:37` — `workspace_id: text().$type<WorkspaceID>()`

## Description

The `workspace_id` column was added via migration `20260227213759_add_session_workspace_id` and has a Drizzle schema declaration, but **no `.references()` call** to the `WorkspaceTable`. This means:

1. SQLite never validates that a `workspace_id` stored in a session row actually exists in the `workspace` table.
2. When a workspace is deleted, sessions pointing to that workspace are not CASCADE-deleted or SET NULL-ed. The session retains a dangling `workspace_id`.
3. Any code that JOINs session → workspace via `session_workspace_idx` must handle the case where the workspace no longer exists.

## Impact

Orphaned `workspace_id` references accumulate silently over time. Sessions referencing non-existent workspaces can produce incorrect results in queries that join on workspace.

## Fix

Add `.references(() => WorkspaceTable.id, { onDelete: "set null" })` to the `workspace_id` column in the Drizzle schema, and create a migration that adds the FK constraint with `ON DELETE SET NULL`.
