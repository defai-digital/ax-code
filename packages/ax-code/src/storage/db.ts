import { type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import { migrate } from "./migrate-journal"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
import type { StatementResultingChanges } from "node:sqlite"
import type { DrizzleTypeError } from "drizzle-orm"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { init } from "#db"
import { NativeStore } from "@/code-intelligence/native-store"
import { DurableStoragePolicy } from "./policy"
import { Recorder } from "@/replay/recorder"
import { Shard } from "./shard"
import { toErrorMessage } from "../util/error-message"
import type { ProjectID } from "../project/schema"

declare const AX_CODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = iife(() => {
    if (Flag.AX_CODE_DB) {
      if (path.isAbsolute(Flag.AX_CODE_DB)) return Flag.AX_CODE_DB
      return path.join(Global.Path.data, Flag.AX_CODE_DB)
    }
    const channel = Installation.CHANNEL
    if (["latest", "beta"].includes(channel) || Flag.AX_CODE_DISABLE_CHANNEL_DB)
      return path.join(Global.Path.data, "ax-code.db")
    const safe = channel.replace(/[^a-zA-Z0-9._-]/g, "-")
    return path.join(Global.Path.data, `ax-code-${safe}.db`)
  })

  export type Transaction = SQLiteTransaction<"sync", StatementResultingChanges>

  type Client = NodeSQLiteDatabase

  type Journal = { sql: string; timestamp: number; name: string }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export function applyStartupPragmas(input: {
    run: (sql: string) => unknown
    warn?: (message: string, extra: Record<string, unknown>) => void
    path?: string
  }) {
    input.run(`PRAGMA busy_timeout = ${DurableStoragePolicy.busyTimeoutMs}`)
    input.run(`PRAGMA journal_mode = ${DurableStoragePolicy.journalMode}`)
    // NORMAL (not FULL): ~10-20% faster writes. Trade-off: on an OS crash or
    // power loss (not app crash), the most recently committed transaction may
    // be silently rolled back. Acceptable for a local dev tool where the
    // database remains consistent (no corruption) and only the last action
    // is lost. Use FULL if write durability becomes critical.
    input.run(`PRAGMA synchronous = ${DurableStoragePolicy.synchronous}`)
    input.run(`PRAGMA cache_size = -${DurableStoragePolicy.cacheSizeKiB}`)
    input.run(`PRAGMA temp_store = ${DurableStoragePolicy.tempStore}`)
    input.run(`PRAGMA wal_autocheckpoint = ${DurableStoragePolicy.walAutoCheckpointPages}`)
    input.run(`PRAGMA journal_size_limit = ${DurableStoragePolicy.journalSizeLimitBytes}`)
    input.run("PRAGMA foreign_keys = ON")
    try {
      input.run("PRAGMA wal_checkpoint(PASSIVE)")
    } catch (error) {
      input.warn?.("failed to checkpoint wal during startup", {
        path: input.path,
        error: toErrorMessage(error),
      })
    }
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const db = init(Path)

    applyStartupPragmas({
      run: (sql) => db.run(sql),
      warn: (message, extra) => log.warn(message, extra),
      path: Path,
    })

    // Apply schema migrations
    const entries =
      typeof AX_CODE_MIGRATIONS !== "undefined"
        ? AX_CODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof AX_CODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      if (Flag.AX_CODE_SKIP_MIGRATIONS) {
        // Silent skip left developers/ops unaware their schema was frozen
        // (BP-12). Surface prominently whenever this escape hatch is used.
        log.warn(
          "AX_CODE_SKIP_MIGRATIONS is set — schema migrations are being skipped. " +
            "This is unsafe for production data and should only be used for deliberate recovery.",
          { count: entries.length },
        )
      }
      const journal = Flag.AX_CODE_SKIP_MIGRATIONS ? entries.map((item) => ({ ...item, sql: "select 1;" })) : entries
      migrate(db, journal)
    }

    return db
  })

  export function close() {
    // Drain any queued replay events before tearing down the SQLite
    // handle. Without this, emit() calls in the same tick as Database.close
    // get scheduled on a microtask that never runs (the handle closes
    // first). flushAll is synchronous and idempotent.
    try {
      Recorder.flushAll()
    } catch (error) {
      log.warn("recorder flush during shutdown failed", {
        error: toErrorMessage(error),
      })
    }
    const client = Client.peek()
    if (client) {
      try {
        // Keep the file-backed SQLite database as the durable source of truth,
        // but opportunistically shrink the WAL during graceful shutdown. This
        // addresses the "disk sidecar keeps growing" class of problems without
        // introducing a separate in-memory source of truth or async sync window
        // where acknowledged writes can be lost.
        client.run(`PRAGMA wal_checkpoint(${DurableStoragePolicy.shutdownCheckpointMode})`)
      } catch (error) {
        log.warn("failed to truncate wal during shutdown", {
          path: Path,
          error: toErrorMessage(error),
        })
      }
      client.$client.close()
      Client.reset()
    }
    // Release the native code-intelligence index store's SQLite handle
    // alongside the main DB. Without this, `ax-code-index.db` and its WAL
    // stay open for the lifetime of the process — a real fd / WAL leak in
    // long-running server / desktop / TUI hosts (BUG-008). NativeStore.close
    // is idempotent and safe to call when the addon isn't loaded.
    NativeStore.close()
    // Close + evict every open per-project shard handle (idempotent). Shard
    // handles are opened lazily, so an empty cache is a no-op — but a
    // long-running server / desktop host may hold up to Shard.MAX_OPEN of them.
    Shard.closeAll()
  }

  // node:sqlite reports lock contention as errcode 5 (SQLITE_BUSY — extended
  // result codes keep 5 in the low byte) with the message "database is locked".
  // Used to distinguish transient cross-process writer contention (retryable)
  // from real storage failures (corruption, read-only) that must stay fatal.
  export function isBusyError(error: unknown) {
    const errcode = (error as { errcode?: unknown } | null | undefined)?.errcode
    if (typeof errcode === "number") return (errcode & 0xff) === 5
    return error instanceof Error && error.message.includes("database is locked")
  }

  // Resolver for the ambient projectID, wired by project/instance.ts at module
  // init (see the ScopedFlag.setDirectoryResolver precedent there). Kept as an
  // indirection so db.ts never imports instance.ts — instance.ts imports
  // project.ts which imports db.ts, so a direct import would be a cycle.
  // Session-scoped shard routing (Slice 1+) reads this to pick a shard.
  let projectResolver: (() => ProjectID | undefined) | undefined

  export function setProjectResolver(fn: () => ProjectID | undefined) {
    projectResolver = fn
  }

  export function resolveProjectID(): ProjectID | undefined {
    return projectResolver?.()
  }

  export type TxOrDb = Transaction | Client
  type SyncTransactionResult<T> =
    T extends Promise<any> ? DrizzleTypeError<"Sync drivers can't use async functions in transactions!"> : T

  // Effects are intended to be synchronous. The narrowed type signals intent
  // but TypeScript's `void` return is bivariant: a function returning
  // `Promise<void>` is still assignable to `() => void`, so an accidental
  // `async () => { ... }` used to compile. The `SyncEffect` brand below
  // applies the same DrizzleTypeError pattern used for `SyncTransactionResult<T>`
  // so the compiler now rejects async-returning effects with a clear message.
  // The runtime guard remains as defense in depth (e.g. via `@ts-ignore`)
  // and records async returns as errors instead of just warnings.
  // Fire-and-forget async work must be wrapped explicitly:
  // `Database.effect(() => { void doAsync().catch(log) })`.
  type Effect = () => void
  type SyncEffect<F extends () => unknown> =
    ReturnType<F> extends Promise<unknown>
      ? DrizzleTypeError<"Database.effect callbacks must be synchronous — wrap async work as `() => { void doAsync().catch(log) }`">
      : F

  const ctx = Context.create<{
    tx: TxOrDb
    effects: Effect[]
  }>("database")

  function runEffects(effects: Effect[]) {
    const errors: { index: number; error: unknown }[] = []
    const asyncReturns: number[] = []
    for (let i = 0; i < effects.length; i++) {
      try {
        const result = effects[i]() as unknown
        if (result instanceof Promise) {
          const idx = i
          asyncReturns.push(idx)
          result.catch((err) => {
            log.error("post-commit async effect rejected", {
              index: idx,
              error: toErrorMessage(err),
              hint: "Database.effect callbacks must be synchronous; wrap async work as `() => { void doAsync().catch(log) }`",
            })
          })
        }
      } catch (e) {
        // One immediate retry for transient post-commit failures (STAB-08).
        // Effects are meant to be idempotent side-effects (publish, notify);
        // a second attempt covers brief lock/contention without a full queue.
        try {
          const retry = effects[i]() as unknown
          if (retry instanceof Promise) {
            asyncReturns.push(i)
            retry.catch((err) => {
              log.error("post-commit async effect rejected on retry", {
                index: i,
                error: toErrorMessage(err),
              })
            })
          }
        } catch (retryError) {
          errors.push({ index: i, error: retryError })
          log.warn("post-commit effect failed after retry", {
            index: i,
            firstError: toErrorMessage(e),
            retryError: toErrorMessage(retryError),
          })
        }
      }
    }
    if (asyncReturns.length > 0) {
      // Detected only via @ts-ignore now that the SyncEffect type brand
      // is in place. Surface as error-level because the async work runs
      // after commit and may write past the transaction boundary.
      log.error("post-commit effects returned a Promise (should be synchronous)", {
        count: asyncReturns.length,
        indices: asyncReturns,
      })
    }
    if (errors.length > 0) {
      log.warn("post-commit effects failed", {
        failed: errors.length,
        total: effects.length,
        indices: errors.map((e) => e.index),
      })
    }
  }

  function requireSyncTransactionResult<T>(result: T): T {
    if (result instanceof Promise) {
      throw new Error("Database.transaction callback must be synchronous (do not pass async functions).")
    }
    return result
  }

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return requireSyncTransactionResult(callback(ctx.use().tx))
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: Effect[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        runEffects(effects)
        return result
      }
      throw err
    }
  }

  export function effect<F extends () => unknown>(fn: F & SyncEffect<F>) {
    try {
      ctx.use().effects.push(fn as Effect)
    } catch (err) {
      // Only the "no active context" case should fall through to
      // direct execution. Any other context error (corruption,
      // disposal, internal assertion) is a real bug and must
      // propagate rather than silently turning an intended-to-be-
      // transactional effect into a non-transactional write.
      // Matches the narrowing in `use()` and `transaction()` above.
      // See BUG-80.
      if (!(err instanceof Context.NotFound)) throw err
      ;(fn as Effect)()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): SyncTransactionResult<T> {
    try {
      return requireSyncTransactionResult(callback(ctx.use().tx)) as SyncTransactionResult<T>
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: Effect[] = []
        // BEGIN IMMEDIATE (not the driver's default deferred BEGIN) so the
        // RESERVED write lock is acquired up front rather than at the first
        // write statement. Under a deferred BEGIN two processes can both open
        // a read snapshot and then deadlock upgrading to writer — one hits
        // SQLITE_BUSY at its first write even though the other hasn't
        // committed. Acquiring the write lock immediately closes that window
        // for every write transaction at this single choke point.
        const result = Client().transaction<T>(
          (tx) => {
            return requireSyncTransactionResult(
              ctx.provide({ tx, effects }, () => callback(tx)) as SyncTransactionResult<T>,
            ) as SyncTransactionResult<T>
          },
          { behavior: "immediate" },
        ) as SyncTransactionResult<T>
        runEffects(effects)
        return result
      }
      throw err
    }
  }

  export type BusyRetryOptions = {
    attempts?: number
    baseMs?: number
    maxMs?: number
    // Injectable for deterministic tests (vi.useFakeTimers). Default to a real
    // Math.random and a real setTimeout-backed sleep.
    random?: () => number
    sleep?: (ms: number) => Promise<void>
  }

  const DEFAULT_BUSY_RETRY_ATTEMPTS = 3
  const DEFAULT_BUSY_RETRY_BASE_MS = 50
  const DEFAULT_BUSY_RETRY_MAX_MS = 1_000

  function busyRetryBackoffMs(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
    // Exponential backoff capped at maxMs, then full jitter in [0, cap]. The
    // cap is inclusive so a single-option `baseMs === maxMs` yields a uniform
    // [0, baseMs] delay, matching a fixed-delay retry under jitter.
    const cap = Math.min(baseMs * 2 ** attempt, maxMs)
    return Math.floor(random() * (cap + 1))
  }

  /**
   * Run a synchronous work function, transparently retrying on SQLITE_BUSY
   * ("database is locked") with exponential backoff + full jitter. Only
   * transient cross-process writer contention is retried; a non-busy failure
   * (corruption, read-only, schema) propagates immediately. The work function
   * must be idempotent — each retry re-runs it from scratch because SQLite has
   * already rolled back whatever partial write tripped the busy error.
   */
  export async function withBusyRetry<T>(fn: () => T, options: BusyRetryOptions = {}): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? DEFAULT_BUSY_RETRY_ATTEMPTS)
    const baseMs = options.baseMs ?? DEFAULT_BUSY_RETRY_BASE_MS
    const maxMs = options.maxMs ?? DEFAULT_BUSY_RETRY_MAX_MS
    const random = options.random ?? Math.random
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return fn()
      } catch (error) {
        lastError = error
        if (!isBusyError(error) || attempt === attempts - 1) throw error
        await sleep(busyRetryBackoffMs(attempt, baseMs, maxMs, random))
      }
    }
    throw lastError
  }

  /**
   * `withBusyRetry` specialized for `Database.transaction`. The transaction
   * callback is re-invoked in full on each attempt so a busy failure re-runs
   * against a fresh BEGIN IMMEDIATE transaction (SQLite aborted the prior one).
   */
  export function transactionWithBusyRetry<T>(
    callback: (tx: TxOrDb) => T,
    options: BusyRetryOptions = {},
  ): Promise<SyncTransactionResult<T>> {
    return withBusyRetry(() => transaction(callback), options)
  }
}
