import fs from "node:fs"
import path from "node:path"
import { Log } from "../util/log"
import { createProcessLockBody, isSameProcessLockHost, parseProcessLockBody } from "../util/process-lock"

// Synchronous cross-process mutex for schema migrations.
//
// drizzle's dialect.migrate() reads `__drizzle_migrations` BEFORE opening its
// BEGIN/COMMIT block and filters pending migrations by name from that stale
// snapshot. Two ax-code processes booting simultaneously after an upgrade
// (double-launch, TUI + CLI, desktop + headless) therefore both decide the
// same new migration is pending and both run its DDL. Migration SQL is not
// idempotent (plain CREATE TABLE / CREATE INDEX), so the loser dies with
// "table already exists" and the whole bootstrap fails fatally — the v7.7.7
// `scheduled_task_run` boot crash. PRAGMA busy_timeout cannot help: the
// conflict is a stale journal read, not an SQLite page lock.
//
// This is an advisory lockfile, not an SQLite lock — the same pattern as the
// code-index lock (code-intelligence/lockfile.ts), but synchronous because
// Database.Client init (and dialect.migrate) is synchronous. The critical
// section is a few milliseconds of DDL, so a brief sync spin at boot is
// acceptable and blocks nothing else (the event loop has no other work yet).
//
// Design notes:
//
// - Lockfile lives next to the database file (`<db>.migrate.lock`), so
//   per-channel and AX_CODE_DB-override databases each get their own lock.
// - Acquired via fs.openSync(path, "wx") — atomic create-or-fail. On EEXIST
//   we inspect the body (PID + timestamp + host) and steal when the holder
//   is dead, the lock is stale, or it outlives ACQUIRE_TIMEOUT_MS.
// - Crash-on-held is handled by the staleness/dead-pid checks on the next
//   acquire, same as IndexLock.

const log = Log.create({ service: "db.migrate-lock" })

// Migrations are sub-second DDL. A lock older than this belongs to a crashed
// process (generous: IndexLock uses 8h for multi-minute index batches).
const STALE_LOCK_MS = 5 * 60 * 1000

// If a live holder wedges past this, steal anyway. Proceeding unlocked
// degrades to the pre-fix race in a pathological case; blocking boot forever
// would be worse.
const ACQUIRE_TIMEOUT_MS = 60 * 1000

const POLL_MS = 100

export namespace MigrationLock {
  // Acquire the lock for the given database path. Returns a release function
  // that MUST be called (use try/finally) once migration completes.
  export function acquire(dbPath: string): () => void {
    const target = dbPath + ".migrate.lock"
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const deadline = Date.now() + ACQUIRE_TIMEOUT_MS
    while (true) {
      try {
        const handle = fs.openSync(target, "wx")
        try {
          fs.writeFileSync(handle, JSON.stringify(createProcessLockBody()))
        } finally {
          fs.closeSync(handle)
        }
        return () => release(target)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err
      }
      const body = readBody(target)
      if (stealable(body)) {
        log.warn("stealing stale or abandoned migration lock", { target, body })
        fs.rmSync(target, { force: true })
        continue
      }
      if (Date.now() >= deadline) {
        log.warn("migration lock held past timeout; stealing", { target, body })
        fs.rmSync(target, { force: true })
        continue
      }
      sleep(POLL_MS)
    }
  }

  function stealable(body: ReturnType<typeof readBody>): boolean {
    if (!body) return true // corrupt or unreadable — safe to steal
    if (Date.now() - body.startedAt > STALE_LOCK_MS) return true
    if (body.pid === process.pid) return false // our own (should not happen; Client is lazy-once)
    if (!isSameProcessLockHost(body)) return false // NFS-style foreign host: never steal
    return !pidAlive(body.pid)
  }

  function readBody(target: string) {
    try {
      return parseProcessLockBody(fs.readFileSync(target, "utf-8"))
    } catch {
      return undefined
    }
  }

  // Signal-0 liveness probe, mirroring IndexLock: EPERM means alive (no
  // permission to signal), ESRCH means dead, anything else is treated as
  // alive out of caution.
  function pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err) {
      return (err as NodeJS.ErrnoException)?.code !== "ESRCH"
    }
  }

  // Synchronous sleep. Atomics.wait on a fresh SharedArrayBuffer blocks the
  // thread without burning CPU; legal on Node's main thread (unlike browsers).
  function sleep(ms: number) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }

  function release(target: string) {
    try {
      fs.rmSync(target, { force: true })
    } catch (err) {
      // Best-effort: a stolen lock is already gone, and a leftover file is
      // reclaimed by the staleness check on the next boot.
      log.error("failed to release migration lock", { target, err })
    }
  }
}
