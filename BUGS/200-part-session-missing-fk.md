# BUG-200 — `part.session_id` missing FK to `session`

**Date:** 2026-04-06  
**Severity:** MEDIUM  
**Category:** Data Integrity  
**Status:** DEFERRED — requires DB migration, high risk  

## Location

- `src/session/session.sql.ts:73` — `session_id: text().$type<SessionID>().notNull()`

## Description

The `PartTable.session_id` column is declared as `notNull()` but has no `.references(() => SessionTable.id)`. Contrast with `MessageTable.session_id` which correctly has `.references(() => SessionTable.id, { onDelete: "cascade" })`.

The `part.session_id` is a denormalized shortcut for lookups (avoiding JOIN through `message_id`). Without a FK:
- If a session is deleted outside the cascade chain, parts retain a dangling `session_id`.
- The `part_session_idx` index could return parts pointing to non-existent sessions.

## Fix

Add `.references(() => SessionTable.id, { onDelete: "cascade" })` to `PartTable.session_id`.
