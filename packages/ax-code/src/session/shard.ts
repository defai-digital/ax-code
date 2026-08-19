import { Database, eq, inArray, NotFoundError } from "../storage/db"
import { Shard } from "../storage/shard"
import { ProjectShardTable, type ShardState } from "../storage/shard.sql"
import { SessionTable, MessageTable, PartTable } from "./session.sql"
import { EventLogTable } from "../replay/event-log.sql"
import { SessionID } from "./schema"
import type { ProjectID } from "../project/schema"
import { Flag } from "../flag/flag"

// Routing for session-scoped tables (message/part, event_log) between the
// registry DB and per-project shards (Phase 2). Resolution is
// sessionID-authoritative: a session's project is read from the registry
// `session` row (which stays in the registry). The ambient project resolver
// (Database.resolveProjectID) is used only for messageID-only reads
// (MessageV2.parts), where the caller runs inside the session's own project
// context.
export namespace SessionShard {
  // Backfill coverage version. Each slice that moves a table into the shard
  // bumps this so projects backfilled under an earlier slice re-run the
  // (idempotent) copy on next access. 1 = message/part (Slice 1),
  // 2 = +event_log (Slice 2). New slices bump to 3, 4, ...
  export const BACKFILL_VERSION = 2

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
  export function projectIDForSession(sessionID: SessionID): ProjectID {
    const row = Database.use((db) =>
      db.select({ project_id: SessionTable.project_id }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
    )
    if (!row) throw new NotFoundError({ message: `Session not found: ${sessionID}` })
    return row.project_id
  }

  function shardRow(projectID: ProjectID): { state: ShardState; backfill_version: number } | undefined {
    return Database.use((db) =>
      db
        .select({ state: ProjectShardTable.state, backfill_version: ProjectShardTable.backfill_version })
        .from(ProjectShardTable)
        .where(eq(ProjectShardTable.project_id, projectID))
        .get(),
    )
  }

  // A shard is complete for reads only once it is active AND its backfill
  // coverage version is current. A shard left "active" by an earlier slice has
  // version < BACKFILL_VERSION and is missing the tables that slice added, so
  // reads must fall back to the registry (which retains every row until the
  // later contract step) rather than serve partial data.
  function isCurrent(projectID: ProjectID): boolean {
    const row = shardRow(projectID)
    return row?.state === "active" && row.backfill_version >= BACKFILL_VERSION
  }

  // True when a write must (re-)run the backfill copy first: no row yet, a
  // crash left state !== active, or the shard is stale (an earlier slice
  // backfilled a subset of tables).
  function needsBackfill(projectID: ProjectID): boolean {
    const row = shardRow(projectID)
    if (!row) return true
    if (row.state !== "active") return true
    return row.backfill_version < BACKFILL_VERSION
  }

  // Copy a project's existing message+part+event_log rows from the global DB
  // into its shard (idempotent via onConflictDoNothing), then flip state to
  // active and stamp the coverage version. Crash-safety: the registry
  // project_shard row carries state; a crash mid-copy leaves state="backfilling"
  // and the next access re-runs the copy (skipping already-copied rows). Global
  // rows are NOT deleted here — that is the later contract step.
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
    const events =
      sessionIDs.length === 0
        ? []
        : Database.use((db) =>
            db.select().from(EventLogTable).where(inArray(EventLogTable.session_id, sessionIDs)).all(),
          )

    Shard.handle(projectID).transaction((db) => {
      for (const message of messages) {
        db.insert(MessageTable).values(message).onConflictDoNothing().run()
      }
      for (const part of parts) {
        db.insert(PartTable).values(part).onConflictDoNothing().run()
      }
      for (const event of events) {
        db.insert(EventLogTable).values(event).onConflictDoNothing().run()
      }
    })

    Database.use((db) =>
      db
        .update(ProjectShardTable)
        .set({ state: "active", backfill_version: BACKFILL_VERSION, time_updated: Date.now() })
        .where(eq(ProjectShardTable.project_id, projectID))
        .run(),
    )
  }

  /**
   * Resolve the store for a project (skip the session lookup).
   *  - Read: shard-first when the shard is active and version-current, else global.
   *  - Write: flag ON → backfill (if needed) then shard; flag OFF → global.
   */
  export function storeForProject(projectID: ProjectID, opts: { write?: boolean } = {}): Store {
    if (!Flag.AX_CODE_SHARD_SESSIONS) return registryStore
    if (opts.write) {
      if (needsBackfill(projectID)) backfill(projectID)
      return shardStore(projectID)
    }
    return isCurrent(projectID) ? shardStore(projectID) : registryStore
  }

  /**
   * Resolve the message/part/event_log store for a session.
   *  - Read: shard-first when `project_shard.state === "active"` and version-
   *    current, else global.
   *  - Write: flag ON → backfill (if needed) then shard; flag OFF → global.
   */
  export function storeFor(sessionID: SessionID, opts: { write?: boolean } = {}): Store {
    if (!Flag.AX_CODE_SHARD_SESSIONS) return registryStore
    return storeForProject(projectIDForSession(sessionID), opts)
  }

  /**
   * Enumerate projects whose shard is active. Used by the allSince / prune
   * fan-out to know which shards hold (a copy of) a project's event_log.
   * Stale-version shards (earlier slice) are still returned: their event_log
   * table is empty, so they contribute nothing and their rows remain in the
   * global table that the fan-out also reads.
   */
  export function activeProjectIDs(): ProjectID[] {
    return Database.use((db) =>
      db
        .select({ project_id: ProjectShardTable.project_id })
        .from(ProjectShardTable)
        .where(eq(ProjectShardTable.state, "active"))
        .all(),
    ).map((row) => row.project_id)
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
    return isCurrent(projectID) ? shardStore(projectID) : registryStore
  }
}
