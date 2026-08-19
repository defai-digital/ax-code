import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
import { type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import type { StatementResultingChanges } from "node:sqlite"
import type { DrizzleTypeError } from "drizzle-orm"
import path from "path"
import { init } from "#db"
import { Context } from "../util/context"
import { Global } from "../global"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { DurableStoragePolicy } from "./policy"
import type { ProjectID } from "../project/schema"

// Per-project SQLite shards (Phase 2). Slice 0 lays the foundation: path
// derivation, an LRU-bounded handle cache, a scoped `{ use, transaction,
// effect }` handle with its own AsyncLocalStorage context, and teardown wired
// into Database.close(). Slice 1 adds the message/part schema and the routing
// helper in src/session/shard.ts.
export namespace Shard {
  export const MAX_OPEN = 8

  const log = Log.create({ service: "storage.shard" })

  // `init` returns the drizzle client intersected with its raw node:sqlite
  // `$client` (see #db), so `ReturnType<typeof init>` carries `$client.close()`.
  type ShardClient = ReturnType<typeof init>
  export type Transaction = SQLiteTransaction<"sync", StatementResultingChanges>
  // Deliberately NOT `ShardClient` (which adds `$client`): a callback `tx` only
  // runs query builders, so keep the union identical to Database.TxOrDb
  // (db.ts) so a Shard handle is structurally interchangeable with Database in
  // the routing helper (src/session/shard.ts).
  export type TxOrDb = Transaction | NodeSQLiteDatabase
  type SyncTransactionResult<T> =
    T extends Promise<any> ? DrizzleTypeError<"Sync drivers can't use async functions in transactions!"> : T

  type Effect = () => void
  type SyncEffect<F extends () => unknown> =
    ReturnType<F> extends Promise<unknown>
      ? DrizzleTypeError<"Shard.effect callbacks must be synchronous — wrap async work as `() => { void doAsync().catch(log) }`">
      : F

  // LRU of open shard clients keyed by projectID. `Map` preserves insertion
  // order, so the first key is the least-recently-used. Capped at MAX_OPEN so
  // a long-running server/desktop host never accumulates a SQLite handle for
  // every project it has touched.
  const cache = new Map<string, ShardClient>()

  // A separate context from the registry's "database" context (db.ts). Sharing
  // one would let a shard `use` leak its tx into a registry write (or vice
  // versa) when a shard callback nests a registry operation. See db.ts:222.
  const shardCtx = Context.create<{ tx: TxOrDb; effects: Effect[] }>("shard")

  function encodeProjectID(projectID: ProjectID): string {
    return Buffer.from(projectID, "utf8").toString("base64url")
  }

  // Deterministic, filesystem-safe path derivation: the raw projectID may
  // contain characters (or be path-unsafe for non-git directory-derived IDs),
  // so it is base64url-encoded rather than used verbatim as a filename.
  export function pathFor(projectID: ProjectID): string {
    return path.join(Global.Path.data, "shards", encodeProjectID(projectID) + ".db")
  }

  // Mirrors Database.applyStartupPragmas (db.ts) but self-contained to avoid a
  // db.ts <-> shard.ts import cycle. Values stay single-sourced in
  // DurableStoragePolicy.
  function applyStartupPragmas(db: ShardClient, file: string) {
    db.run(`PRAGMA busy_timeout = ${DurableStoragePolicy.busyTimeoutMs}`)
    db.run(`PRAGMA journal_mode = ${DurableStoragePolicy.journalMode}`)
    // NORMAL (not FULL): ~10-20% faster writes; on OS crash/power loss only the
    // most recent transaction may roll back. Consistent with the registry DB.
    db.run(`PRAGMA synchronous = ${DurableStoragePolicy.synchronous}`)
    db.run(`PRAGMA cache_size = -${DurableStoragePolicy.cacheSizeKiB}`)
    db.run(`PRAGMA temp_store = ${DurableStoragePolicy.tempStore}`)
    db.run(`PRAGMA wal_autocheckpoint = ${DurableStoragePolicy.walAutoCheckpointPages}`)
    db.run(`PRAGMA journal_size_limit = ${DurableStoragePolicy.journalSizeLimitBytes}`)
    db.run("PRAGMA foreign_keys = ON")
    try {
      db.run("PRAGMA wal_checkpoint(PASSIVE)")
    } catch (error) {
      log.warn("shard wal checkpoint during open failed", { file, error: toErrorMessage(error) })
    }
  }

  function closeClient(key: string, db: ShardClient) {
    try {
      db.run(`PRAGMA wal_checkpoint(${DurableStoragePolicy.shutdownCheckpointMode})`)
    } catch (error) {
      log.warn("shard wal checkpoint during close failed", { projectID: key, error: toErrorMessage(error) })
    }
    db.$client.close()
  }

  // Session-scoped tables that live in the shard (Slice 1: message + part;
  // Slice 2: event_log).
  // Data-driven so later slices append todo/session_goal/task_queue/
  // scheduled_task/workflow_*. Written as raw DDL rather than reusing the
  // migration journal because (1) the original migrations create every table in
  // one mixed migration, so per-table statement filtering would require parsing
  // SQL, and (2) the original message/part DDL declares `session_id` FKs into
  // the registry `session` table, which cannot exist in the shard — the session
  // table stays in the registry. `session_id`/`message_id` are therefore plain
  // columns; the registry `session` row is the source of truth for project
  // membership.
  const SHARD_SCHEMA_DDL = [
    `CREATE TABLE IF NOT EXISTS "message" (
      "id" text PRIMARY KEY NOT NULL,
      "session_id" text NOT NULL,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      "data" text NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "message_session_time_created_id_idx" ON "message" ("session_id","time_created","id")`,
    `CREATE TABLE IF NOT EXISTS "part" (
      "id" text PRIMARY KEY NOT NULL,
      "message_id" text NOT NULL,
      "session_id" text NOT NULL,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      "data" text NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "part_message_id_id_idx" ON "part" ("message_id","id")`,
    `CREATE INDEX IF NOT EXISTS "part_session_idx" ON "part" ("session_id")`,
    `CREATE TABLE IF NOT EXISTS "event_log" (
      "id" text PRIMARY KEY NOT NULL,
      "session_id" text NOT NULL,
      "step_id" text,
      "event_type" text NOT NULL,
      "event_data" text NOT NULL,
      "sequence" integer NOT NULL,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "event_log_session_idx" ON "event_log" ("session_id")`,
    `CREATE INDEX IF NOT EXISTS "event_log_session_sequence_idx" ON "event_log" ("session_id","sequence")`,
    `CREATE INDEX IF NOT EXISTS "event_log_session_type_sequence_idx" ON "event_log" ("session_id","event_type","sequence")`,
    `CREATE INDEX IF NOT EXISTS "event_log_time_created_idx" ON "event_log" ("time_created")`,
    // Slice 3: todo + session_goal. `todo` keeps the composite primary key
    // (session_id, position) from session.sql.ts so onConflictDoNothing during
    // backfill is idempotent. `session_goal.session_id` is the primary key.
    `CREATE TABLE IF NOT EXISTS "todo" (
      "session_id" text NOT NULL,
      "content" text NOT NULL,
      "status" text NOT NULL,
      "priority" text NOT NULL,
      "position" integer NOT NULL,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      PRIMARY KEY ("session_id","position")
    )`,
    `CREATE INDEX IF NOT EXISTS "todo_session_idx" ON "todo" ("session_id")`,
    `CREATE TABLE IF NOT EXISTS "session_goal" (
      "session_id" text PRIMARY KEY NOT NULL,
      "objective" text NOT NULL,
      "status" text NOT NULL,
      "token_budget" integer,
      "tokens_used" integer NOT NULL DEFAULT 0,
      "time_used_seconds" integer NOT NULL DEFAULT 0,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "session_goal_status_idx" ON "session_goal" ("status")`,
    // Slice 4: task_queue + scheduled_task + workflow_*. Cross-file FKs into
    // registry tables (`project`, `session`) are dropped — `project_id`,
    // `session_id`, and `parent_session_id` become plain text columns (the
    // registry `project`/`session` rows stay the source of truth for
    // membership). Intra-shard FKs are preserved where both ends live in the
    // shard: scheduled_task.last_queue_id -> task_queue.id (set null) and the
    // workflow_* internal chain (phase/child/artifact/budget_ledger -> run;
    // child -> phase; child/artifact/budget_ledger phase/child refs).
    `CREATE TABLE IF NOT EXISTS "task_queue" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "session_id" text,
      "directory" text NOT NULL,
      "worktree" text,
      "kind" text NOT NULL,
      "status" text NOT NULL,
      "priority" integer NOT NULL DEFAULT 0,
      "position" integer NOT NULL,
      "title" text NOT NULL,
      "agent" text,
      "model" text,
      "source_message_id" text,
      "source_task_id" text,
      "payload" text NOT NULL,
      "error" text,
      "execution_timeout_ms" integer,
      "time_started" integer,
      "time_completed" integer,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "task_queue_project_position_idx" ON "task_queue" ("project_id","position","id")`,
    `CREATE INDEX IF NOT EXISTS "task_queue_project_status_idx" ON "task_queue" ("project_id","status")`,
    `CREATE INDEX IF NOT EXISTS "task_queue_session_idx" ON "task_queue" ("session_id")`,
    `CREATE TABLE IF NOT EXISTS "scheduled_task" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "directory" text NOT NULL,
      "title" text NOT NULL,
      "prompt" text NOT NULL,
      "schedule" text NOT NULL,
      "status" text NOT NULL,
      "agent" text,
      "model" text,
      "workflow_template_id" text,
      "workflow_start_options" text,
      "last_queue_id" text,
      "last_workflow_run_id" text,
      "error" text,
      "next_run_at" integer,
      "last_run_at" integer,
      "catch_up_policy" text NOT NULL DEFAULT 'run_once',
      "max_run_duration_ms" integer,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      FOREIGN KEY ("last_queue_id") REFERENCES "task_queue"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "scheduled_task_project_status_idx" ON "scheduled_task" ("project_id","status")`,
    `CREATE INDEX IF NOT EXISTS "scheduled_task_project_next_run_idx" ON "scheduled_task" ("project_id","next_run_at")`,
    `CREATE TABLE IF NOT EXISTS "workflow_run" (
      "id" text PRIMARY KEY NOT NULL,
      "project_id" text NOT NULL,
      "directory" text NOT NULL,
      "parent_session_id" text,
      "source_template_id" text,
      "source_task_id" text,
      "status" text NOT NULL,
      "current_phase_id" text,
      "spec_snapshot" text NOT NULL,
      "input_values" text NOT NULL,
      "budget" text NOT NULL,
      "budget_usage" text NOT NULL,
      "verification_envelope_ids" text NOT NULL,
      "error" text,
      "time_started" integer,
      "time_completed" integer,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "workflow_run_project_status_idx" ON "workflow_run" ("project_id","status")`,
    `CREATE INDEX IF NOT EXISTS "workflow_run_project_created_idx" ON "workflow_run" ("project_id","time_created","id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_run_parent_session_idx" ON "workflow_run" ("parent_session_id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_run_source_task_idx" ON "workflow_run" ("source_task_id")`,
    `CREATE TABLE IF NOT EXISTS "workflow_phase" (
      "id" text PRIMARY KEY NOT NULL,
      "run_id" text NOT NULL,
      "spec_phase_id" text NOT NULL,
      "position" integer NOT NULL,
      "name" text NOT NULL,
      "kind" text NOT NULL,
      "status" text NOT NULL,
      "agent" text,
      "model_policy" text,
      "budget" text,
      "outputs" text NOT NULL,
      "error" text,
      "time_started" integer,
      "time_completed" integer,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      FOREIGN KEY ("run_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS "workflow_phase_run_position_idx" ON "workflow_phase" ("run_id","position")`,
    `CREATE INDEX IF NOT EXISTS "workflow_phase_run_status_idx" ON "workflow_phase" ("run_id","status")`,
    `CREATE TABLE IF NOT EXISTS "workflow_child" (
      "id" text PRIMARY KEY NOT NULL,
      "run_id" text NOT NULL,
      "phase_id" text NOT NULL,
      "task_queue_id" text,
      "session_id" text,
      "status" text NOT NULL,
      "agent" text,
      "model" text,
      "budget_slice" text,
      "artifact_ids" text NOT NULL,
      "evidence_refs" text NOT NULL,
      "output_summary" text,
      "error" text,
      "time_started" integer,
      "time_completed" integer,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      FOREIGN KEY ("run_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE,
      FOREIGN KEY ("phase_id") REFERENCES "workflow_phase"("id") ON DELETE CASCADE,
      FOREIGN KEY ("task_queue_id") REFERENCES "task_queue"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "workflow_child_run_phase_idx" ON "workflow_child" ("run_id","phase_id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_child_run_status_idx" ON "workflow_child" ("run_id","status")`,
    `CREATE INDEX IF NOT EXISTS "workflow_child_task_queue_idx" ON "workflow_child" ("task_queue_id")`,
    `CREATE TABLE IF NOT EXISTS "workflow_artifact" (
      "id" text PRIMARY KEY NOT NULL,
      "run_id" text NOT NULL,
      "phase_id" text,
      "child_id" text,
      "spec_artifact_id" text,
      "kind" text NOT NULL,
      "retention" text NOT NULL,
      "expose_to_main_context" integer NOT NULL,
      "summary" text,
      "payload" text,
      "redaction" text,
      "evidence_refs" text NOT NULL,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      FOREIGN KEY ("run_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE,
      FOREIGN KEY ("phase_id") REFERENCES "workflow_phase"("id") ON DELETE SET NULL,
      FOREIGN KEY ("child_id") REFERENCES "workflow_child"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "workflow_artifact_run_idx" ON "workflow_artifact" ("run_id","time_created","id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_artifact_phase_idx" ON "workflow_artifact" ("phase_id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_artifact_child_idx" ON "workflow_artifact" ("child_id")`,
    `CREATE TABLE IF NOT EXISTS "workflow_budget_ledger" (
      "id" text PRIMARY KEY NOT NULL,
      "run_id" text NOT NULL,
      "phase_id" text,
      "child_id" text,
      "kind" text NOT NULL,
      "usage_delta" text NOT NULL,
      "message" text,
      "time_created" integer NOT NULL,
      "time_updated" integer NOT NULL,
      FOREIGN KEY ("run_id") REFERENCES "workflow_run"("id") ON DELETE CASCADE,
      FOREIGN KEY ("phase_id") REFERENCES "workflow_phase"("id") ON DELETE SET NULL,
      FOREIGN KEY ("child_id") REFERENCES "workflow_child"("id") ON DELETE SET NULL
    )`,
    `CREATE INDEX IF NOT EXISTS "workflow_budget_ledger_run_idx" ON "workflow_budget_ledger" ("run_id","time_created","id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_budget_ledger_phase_idx" ON "workflow_budget_ledger" ("phase_id")`,
    `CREATE INDEX IF NOT EXISTS "workflow_budget_ledger_child_idx" ON "workflow_budget_ledger" ("child_id")`,
  ]

  function open(projectID: ProjectID): ShardClient {
    const key = projectID as string
    const existing = cache.get(key)
    if (existing) {
      // LRU touch: re-insert to move this entry to the most-recently-used end.
      cache.delete(key)
      cache.set(key, existing)
      return existing
    }

    const file = pathFor(projectID)
    log.info("opening shard", { projectID, file })
    const db = init(file)
    applyStartupPragmas(db, file)
    for (const statement of SHARD_SCHEMA_DDL) db.run(statement)

    cache.set(key, db)
    while (cache.size > MAX_OPEN) {
      const oldestKey = cache.keys().next().value
      if (oldestKey === undefined) break
      const evicted = cache.get(oldestKey)!
      cache.delete(oldestKey)
      closeClient(oldestKey, evicted)
    }
    return db
  }

  function runEffects(effects: Effect[]) {
    for (let i = 0; i < effects.length; i++) {
      try {
        const result = effects[i]() as unknown
        if (result instanceof Promise) {
          result.catch((err) =>
            log.error("shard post-commit async effect rejected", { index: i, error: toErrorMessage(err) }),
          )
        }
      } catch (error) {
        // One immediate retry for transient post-commit failures (mirrors db.ts).
        try {
          effects[i]()
        } catch (retryError) {
          log.warn("shard post-commit effect failed after retry", {
            index: i,
            firstError: toErrorMessage(error),
            retryError: toErrorMessage(retryError),
          })
        }
      }
    }
  }

  function requireSync<T>(result: T): T {
    if (result instanceof Promise) {
      throw new Error("Shard transaction callback must be synchronous (do not pass async functions).")
    }
    return result
  }

  /**
   * Scoped handle for a single project's shard. `use` runs a single auto-commit
   * statement, `transaction` wraps in BEGIN IMMEDIATE, `effect` defers a
   * post-commit side-effect. All three operate on this project's shard client
   * and never on the registry DB.
   */
  export function handle(projectID: ProjectID) {
    return {
      use<T>(callback: (tx: TxOrDb) => T): T {
        try {
          return requireSync(callback(shardCtx.use().tx))
        } catch (err) {
          if (err instanceof Context.NotFound) {
            const effects: Effect[] = []
            const result = shardCtx.provide({ effects, tx: open(projectID) }, () => callback(open(projectID)))
            runEffects(effects)
            return result
          }
          throw err
        }
      },
      transaction<T>(callback: (tx: TxOrDb) => T): SyncTransactionResult<T> {
        try {
          return requireSync(callback(shardCtx.use().tx)) as SyncTransactionResult<T>
        } catch (err) {
          if (err instanceof Context.NotFound) {
            const effects: Effect[] = []
            // BEGIN IMMEDIATE, matching Database.transaction (db.ts) so shard
            // write transactions acquire the RESERVED lock up front.
            const result = open(projectID).transaction<T>(
              (tx) => {
                return requireSync(
                  shardCtx.provide({ tx, effects }, () => callback(tx)) as SyncTransactionResult<T>,
                ) as SyncTransactionResult<T>
              },
              { behavior: "immediate" },
            ) as SyncTransactionResult<T>
            runEffects(effects)
            return result
          }
          throw err
        }
      },
      effect<F extends () => unknown>(fn: F & SyncEffect<F>) {
        try {
          shardCtx.use().effects.push(fn as Effect)
        } catch (err) {
          if (!(err instanceof Context.NotFound)) throw err
          ;(fn as Effect)()
        }
      },
    }
  }

  /** Close one project's shard handle (idempotent). */
  export function close(projectID: ProjectID): void {
    const key = projectID as string
    const db = cache.get(key)
    if (!db) return
    cache.delete(key)
    closeClient(key, db)
  }

  /** Close and evict every cached shard handle (idempotent). Wired into Database.close(). */
  export function closeAll(): void {
    for (const [key, db] of [...cache.entries()]) {
      cache.delete(key)
      closeClient(key, db)
    }
  }

  /** Number of currently-open shard handles (test observability). */
  export function openCount(): number {
    return cache.size
  }

  /** Peek at an open shard client without opening it (test observability). */
  export function peek(projectID: ProjectID): ShardClient | undefined {
    return cache.get(projectID as string)
  }
}
