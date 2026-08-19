import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
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
// into Database.close(). No session-scoped table has moved yet — the shard
// schema is empty until Slice 1.
export namespace Shard {
  export const MAX_OPEN = 8

  const log = Log.create({ service: "storage.shard" })

  // `init` returns the drizzle client intersected with its raw node:sqlite
  // `$client` (see #db), so `ReturnType<typeof init>` carries `$client.close()`.
  type ShardClient = ReturnType<typeof init>
  export type Transaction = SQLiteTransaction<"sync", StatementResultingChanges>
  export type TxOrDb = Transaction | ShardClient
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

    // Slice 0: the shard schema is empty — no session-scoped table has moved.
    // TODO(Slice 1): apply the session-scoped subset of the migration journal
    // here (derived from AX_CODE_MIGRATIONS / the dev journal, filtered to
    // message/part/event_log/todo/session_goal/task_queue/scheduled_task and
    // workflow_* tables) so a shard file gets its schema on first open.

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
