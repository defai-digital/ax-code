import { Database, eq, inArray, NotFoundError } from "../storage/db"
import { Shard } from "../storage/shard"
import { ProjectShardTable } from "../storage/shard.sql"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { SessionID } from "./schema"
import type { ProjectID } from "../project/schema"
import { Flag } from "../flag/flag"

// Routing for session-scoped (message/part) tables between the registry DB and
// per-project shards (Phase 2 Slice 1). Resolution is sessionID-authoritative:
// a session's project is read from the registry `session` row (which stays in
// the registry). The ambient project resolver (Database.resolveProjectID) is
// used only for messageID-only reads (MessageV2.parts), where the caller runs
// inside the session's own project context.
export namespace SessionShard {
  // Structurally interchangeable with the registry Database: `Shard.TxOrDb` is
  // kept identical to `Database.TxOrDb` (see shard.ts) so a Shard handle is
  // assignable here.
  export type Store = {
    use: typeof Database.use
    transaction: typeof Database.transaction
    effect: (fn: () => void) => void
  }

  // The registry DB as a Store (flag-off path and read fallback).
  const registryStore: Store = {
    use: (callback) => Database.use(callback),
    transaction: (callback) => Database.transaction(callback),
    effect: (fn) => Database.effect(fn),
  }

  function shardStore(projectID: ProjectID): Store {
    const handle = Shard.handle(projectID)
    return {
      use: (callback) => handle.use(callback),
      transaction: (callback) => handle.transaction(callback),
      effect: (fn) => handle.effect(fn),
    }
  }

  // Resolve the project for a session from the registry (authoritative). A
  // cheap PK point-read on the registry `session` table.
  function projectIDForSession(sessionID: SessionID): ProjectID {
    const row = Database.use((db) =>
      db.select({ project_id: SessionTable.project_id }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
    return row.project_id
  }

  function state(projectID: ProjectID): "none" | "backfilling" | "active" {
    const row = Database.use((db) =>
      db
        .select({ state: ProjectShardTable.state })
        .from(ProjectShardTable)
        .where(eq(ProjectShardTable.project_id, projectID))
        .get(),
    )
    return row?.state ?? "none"
  }

  // Copy a project's existing message+part rows from the global DB into its
  // shard (idempotent via onConflictDoNothing), then flip state to active.
  // Crash-safety: the registry project_shard row carries state; a crash
  // mid-copy leaves state="backfilling" and the next access re-runs the copy
  // (skipping already-copied rows). Global rows are NOT deleted here — that is
  // the later contract step.
  function backfill(projectID: ProjectID): void {
    const file = Shard.pathFor(projectID)
    const now = Date.now()
    Database.use((db) =>
      db
        .insert(ProjectShardTable)
        .values({ project_id: projectID, shard_file: file, state: "backfilling", time_created: now, time_updated: now })
        .onConflictDoUpdate({ target: ProjectShardTable.project_id, set: { state: "backfilling", time_updated: now } })
        .run(),
    )

    const sessionIDs = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.project_id, projectID)).all(),
    ).map((row) => row.id)

    const messages =
      sessionIDs.length === 0
        ? []
        : Database.use((db) => db.select().from(MessageTable).where(inArray(MessageTable.session_id, sessionIDs)).all())
    const parts =
      sessionIDs.length === 0
        ? []
        : Database.use((db) => db.select().from(PartTable).where(inArray(PartTable.session_id, sessionIDs)).all())

    Shard.handle(projectID).transaction((db) => {
      for (const message of messages) {
        db.insert(MessageTable).values(message).onConflictDoNothing().run()
      }
      for (const part of parts) {
        db.insert(PartTable).values(part).onConflictDoNothing().run()
      }
    })

    Database.use((db) =>
      db
        .update(ProjectShardTable)
        .set({ state: "active", time_updated: Date.now() })
        .where(eq(ProjectShardTable.project_id, projectID))
        .run(),
    )
  }

  /**
   * Resolve the message/part store for a session.
   *  - Read: shard-first when `project_shard.state === "active"`, else global.
   *  - Write: flag ON → backfill (if needed) then shard; flag OFF → global.
   */
  export function storeFor(sessionID: SessionID, opts: { write?: boolean } = {}): Store {
    if (!Flag.AX_CODE_SHARD_SESSIONS) return registryStore
    const projectID = projectIDForSession(sessionID)
    if (opts.write) {
      if (state(projectID) !== "active") backfill(projectID)
      return shardStore(projectID)
    }
    return state(projectID) === "active" ? shardStore(projectID) : registryStore
  }

  /**
   * Store resolved from the ambient project (for messageID-only reads where the
   * caller runs inside the session's own project context). Falls back to the
   * registry when no ambient project is available or the flag is off.
   */
  export function ambientStore(): Store {
    if (!Flag.AX_CODE_SHARD_SESSIONS) return registryStore
    const projectID = Database.resolveProjectID()
    if (!projectID) return registryStore
    return state(projectID) === "active" ? shardStore(projectID) : registryStore
  }
}
