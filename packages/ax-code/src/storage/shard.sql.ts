import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import type { ProjectID } from "../project/schema"
import { Timestamps } from "./schema.sql"

// Backfill/activation state for a project's shard. Mirrors the CHECK
// constraint in migration 20260819020000_project_shard; the enum is enforced
// at the type layer here (matching the repo convention of plain text columns),
// with the DB-level CHECK as defense in depth.
export type ShardState = "none" | "backfilling" | "active"

// Registry-side table mapping a project to its per-project shard file. Lives in
// the global DB (ax-code.db) — never in a shard. See src/storage/shard.ts.
export const ProjectShardTable = sqliteTable("project_shard", {
  project_id: text().$type<ProjectID>().primaryKey(),
  shard_file: text().notNull(),
  state: text().$type<ShardState>().notNull(),
  // Which backfill coverage version this shard was last copied at. See
  // SessionShard.BACKFILL_VERSION (src/session/shard.ts); a stale version makes
  // the shard re-run its (idempotent) copy on next access.
  backfill_version: integer().notNull().default(0),
  ...Timestamps,
})
