import { Database, and, eq, inArray, isNotNull, notInArray, NotFoundError } from "../storage/db"
import { Shard } from "../storage/shard"
import { ProjectShardTable, type ShardState } from "../storage/shard.sql"
import {
  SessionTable,
  MessageTable,
  PartTable,
  TodoTable,
  SessionGoalTable,
  TaskQueueTable,
  ScheduledTaskTable,
} from "./session.sql"
import { EventLogTable } from "../replay/event-log.sql"
import {
  WorkflowRunTable,
  WorkflowPhaseTable,
  WorkflowChildTable,
  WorkflowArtifactTable,
  WorkflowBudgetLedgerTable,
} from "../workflow/workflow.sql"
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
  // 2 = +event_log (Slice 2), 3 = +todo/session_goal (Slice 3),
  // 4 = +task_queue/scheduled_task/workflow_* (Slice 4). New slices bump to 5,
  // 6, ...
  export const BACKFILL_VERSION = 4

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
    const todos =
      sessionIDs.length === 0
        ? []
        : Database.use((db) => db.select().from(TodoTable).where(inArray(TodoTable.session_id, sessionIDs)).all())
    const goals =
      sessionIDs.length === 0
        ? []
        : Database.use((db) =>
            db.select().from(SessionGoalTable).where(inArray(SessionGoalTable.session_id, sessionIDs)).all(),
          )

    // Slice 4 tables are project-keyed (task_queue/scheduled_task/workflow_run
    // carry project_id); the workflow detail tables are run-keyed, so backfill
    // them by the project's run IDs. Insert order below is dependency-ordered to
    // satisfy the intra-shard FKs (scheduled_task -> task_queue; workflow_*
    // -> workflow_run/phase/child).
    const queue = Database.use((db) =>
      db.select().from(TaskQueueTable).where(eq(TaskQueueTable.project_id, projectID)).all(),
    )
    const scheduled = Database.use((db) =>
      db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.project_id, projectID)).all(),
    )
    const runs = Database.use((db) =>
      db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.project_id, projectID)).all(),
    )
    const runIDs = runs.map((row) => row.id)
    const phases =
      runIDs.length === 0
        ? []
        : Database.use((db) =>
            db.select().from(WorkflowPhaseTable).where(inArray(WorkflowPhaseTable.run_id, runIDs)).all(),
          )
    const children =
      runIDs.length === 0
        ? []
        : Database.use((db) =>
            db.select().from(WorkflowChildTable).where(inArray(WorkflowChildTable.run_id, runIDs)).all(),
          )
    const artifacts =
      runIDs.length === 0
        ? []
        : Database.use((db) =>
            db.select().from(WorkflowArtifactTable).where(inArray(WorkflowArtifactTable.run_id, runIDs)).all(),
          )
    const budgetLedger =
      runIDs.length === 0
        ? []
        : Database.use((db) =>
            db.select().from(WorkflowBudgetLedgerTable).where(inArray(WorkflowBudgetLedgerTable.run_id, runIDs)).all(),
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
      for (const todo of todos) {
        db.insert(TodoTable).values(todo).onConflictDoNothing().run()
      }
      for (const goal of goals) {
        db.insert(SessionGoalTable).values(goal).onConflictDoNothing().run()
      }
      for (const row of queue) {
        db.insert(TaskQueueTable).values(row).onConflictDoNothing().run()
      }
      for (const row of scheduled) {
        db.insert(ScheduledTaskTable).values(row).onConflictDoNothing().run()
      }
      for (const row of runs) {
        db.insert(WorkflowRunTable).values(row).onConflictDoNothing().run()
      }
      for (const row of phases) {
        db.insert(WorkflowPhaseTable).values(row).onConflictDoNothing().run()
      }
      for (const row of children) {
        db.insert(WorkflowChildTable).values(row).onConflictDoNothing().run()
      }
      for (const row of artifacts) {
        db.insert(WorkflowArtifactTable).values(row).onConflictDoNothing().run()
      }
      for (const row of budgetLedger) {
        db.insert(WorkflowBudgetLedgerTable).values(row).onConflictDoNothing().run()
      }
    })

    Database.use((db) =>
      db
        .update(ProjectShardTable)
        .set({ state: "active", backfill_version: BACKFILL_VERSION, time_updated: Date.now() })
        .where(eq(ProjectShardTable.project_id, projectID))
        .run(),
    )

    // Slice 5: after (re-)backfill, sweep any shard rows whose session no longer
    // exists in the registry (a Session.remove whose shard cascade was
    // interrupted). Backfill is a rare per-project-per-version event, so this
    // bounded reconciler never runs on every boot.
    sweepOrphans(projectID)
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

  /**
   * Delete a set of sessions' rows from the project's shard (Slice 5).
   *
   * Replicates the registry's `ON DELETE CASCADE` semantics for the shard copies
   * whose cross-file `session_id` FKs were dropped (§5 of the sharding plan):
   *
   *  - DELETE (cascade): message, part, todo, session_goal, event_log,
   *    task_queue. `scheduled_task.last_queue_id` and `workflow_child.task_queue_id`
   *    are nulled automatically by the intra-shard `ON DELETE SET NULL` FKs
   *    preserved in the shard DDL (no explicit scheduled_task delete is needed —
   *    scheduled_task has no `session_id` column).
   *  - SET NULL (not delete): `workflow_run.parent_session_id` and
   *    `workflow_child.session_id`, matching the registry `onDelete: "set null"`.
   *
   * Runs in a single shard transaction. Flag-gated: when sharding is off, the
   * registry FK cascade handles everything and this is a no-op. When the project
   * has no `project_shard` row (never backfilled), the session's rows live
   * entirely in the global DB, so the registry cascade is the only cleanup
   * required and we skip opening a (junk) shard file.
   */
  export function deleteSessions(projectID: ProjectID, sessionIDs: SessionID[]): void {
    if (!Flag.AX_CODE_SHARD_SESSIONS) return
    if (sessionIDs.length === 0) return
    if (!shardRow(projectID)) return
    Shard.handle(projectID).transaction((db) => {
      db.delete(PartTable).where(inArray(PartTable.session_id, sessionIDs)).run()
      db.delete(MessageTable).where(inArray(MessageTable.session_id, sessionIDs)).run()
      db.delete(TodoTable).where(inArray(TodoTable.session_id, sessionIDs)).run()
      db.delete(SessionGoalTable).where(inArray(SessionGoalTable.session_id, sessionIDs)).run()
      db.delete(EventLogTable).where(inArray(EventLogTable.session_id, sessionIDs)).run()
      db.delete(TaskQueueTable).where(inArray(TaskQueueTable.session_id, sessionIDs)).run()
      db.update(WorkflowRunTable)
        .set({ parent_session_id: null })
        .where(inArray(WorkflowRunTable.parent_session_id, sessionIDs))
        .run()
      db.update(WorkflowChildTable)
        .set({ session_id: null })
        .where(inArray(WorkflowChildTable.session_id, sessionIDs))
        .run()
    })
  }

  /**
   * Delete shard rows whose `session_id` no longer exists in the registry
   * `session` table (Slice 5 maintenance reconciler).
   *
   * Safety net for a `Session.remove` whose shard-cascade step was interrupted
   * (crash) or a historical bug. Session-scoped tables are deleted by
   * `session_id NOT IN (registry session ids for this project)`; the nullable
   * workflow references (`workflow_run.parent_session_id`,
   * `workflow_child.session_id`) are set null, and `task_queue` rows with a null
   * `session_id` (project-scoped tasks) are left untouched.
   *
   * Deliberately NOT run on every boot: it is wired into `backfill()` completion
   * (a rare, per-project-per-version event) and exposed for direct maintenance /
   * tests. Flag-gated; a no-op when sharding is off or the project has no shard.
   */
  export function sweepOrphans(projectID: ProjectID): void {
    if (!Flag.AX_CODE_SHARD_SESSIONS) return
    if (!shardRow(projectID)) return
    const sessionIDs = Database.use((db) =>
      db.select({ id: SessionTable.id }).from(SessionTable).where(eq(SessionTable.project_id, projectID)).all(),
    ).map((row) => row.id)

    Shard.handle(projectID).transaction((db) => {
      if (sessionIDs.length === 0) {
        // Every session-scoped row in this shard is orphaned (the project has no
        // registry sessions left).
        db.delete(PartTable).run()
        db.delete(MessageTable).run()
        db.delete(TodoTable).run()
        db.delete(SessionGoalTable).run()
        db.delete(EventLogTable).run()
        db.delete(TaskQueueTable).where(isNotNull(TaskQueueTable.session_id)).run()
        db.update(WorkflowRunTable)
          .set({ parent_session_id: null })
          .where(isNotNull(WorkflowRunTable.parent_session_id))
          .run()
        db.update(WorkflowChildTable).set({ session_id: null }).where(isNotNull(WorkflowChildTable.session_id)).run()
        return
      }
      db.delete(PartTable).where(notInArray(PartTable.session_id, sessionIDs)).run()
      db.delete(MessageTable).where(notInArray(MessageTable.session_id, sessionIDs)).run()
      db.delete(TodoTable).where(notInArray(TodoTable.session_id, sessionIDs)).run()
      db.delete(SessionGoalTable).where(notInArray(SessionGoalTable.session_id, sessionIDs)).run()
      db.delete(EventLogTable).where(notInArray(EventLogTable.session_id, sessionIDs)).run()
      db.delete(TaskQueueTable)
        .where(and(isNotNull(TaskQueueTable.session_id), notInArray(TaskQueueTable.session_id, sessionIDs)))
        .run()
      db.update(WorkflowRunTable)
        .set({ parent_session_id: null })
        .where(
          and(
            isNotNull(WorkflowRunTable.parent_session_id),
            notInArray(WorkflowRunTable.parent_session_id, sessionIDs),
          ),
        )
        .run()
      db.update(WorkflowChildTable)
        .set({ session_id: null })
        .where(and(isNotNull(WorkflowChildTable.session_id), notInArray(WorkflowChildTable.session_id, sessionIDs)))
        .run()
    })
  }
}
