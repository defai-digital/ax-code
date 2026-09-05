import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Log } from "../util/log"
import {
  createProcessLockBody,
  isSameProcessLockHost,
  parseProcessLockBody,
  type ProcessLockBody,
} from "../util/process-lock"

// Synchronous cross-process mutex for schema migrations.
//
// drizzle reads `__drizzle_migrations` before opening its transaction. Two
// processes booting after an upgrade can therefore both decide the same
// non-idempotent DDL is pending. The main mutex is a write transaction on a
// tiny sidecar SQLite database. SQLite owns the OS-level lock, so it is
// released automatically on process exit and never needs unsafe stale-file
// deletion.
//
// We also hold the v7.7.7 `<db>.migrate.lock` file while migrating. That keeps
// rolling upgrades safe when an older CLI, desktop, or headless process is
// still running. New processes are serialized by the sidecar guard before
// they inspect or reclaim this compatibility file.

const log = Log.create({ service: "db.migrate-lock" })

const ACQUIRE_TIMEOUT_MS = 60 * 1000
const POLL_MS = 100

// A v7.7.7 process creates the compatibility file before writing its JSON
// body. Do not mistake that brief empty/partial state for an abandoned file.
const MALFORMED_LOCK_GRACE_MS = 5 * 1000

type Options = {
  timeoutMs?: number
  pollMs?: number
  malformedGraceMs?: number
}

type MigrationLockBody = ProcessLockBody & { token: string }

type Snapshot = {
  body: ProcessLockBody | undefined
  dev: number
  ino: number
  mtimeMs: number
  size: number
  text: string
}

export namespace MigrationLock {
  // Acquire the lock for the given database path. Returns an idempotent
  // release function that MUST be called (use try/finally) after migration.
  export function acquire(dbPath: string, options: Options = {}): () => void {
    const timeoutMs = duration("timeoutMs", options.timeoutMs, ACQUIRE_TIMEOUT_MS)
    const pollMs = duration("pollMs", options.pollMs, POLL_MS)
    const malformedGraceMs = duration("malformedGraceMs", options.malformedGraceMs, MALFORMED_LOCK_GRACE_MS)
    const target = dbPath + ".migrate.lock"
    const deadline = Date.now() + timeoutMs

    fs.mkdirSync(path.dirname(target), { recursive: true })

    const releaseGuard = acquireGuard(dbPath, deadline, target)
    let releaseCompatibility: (() => void) | undefined
    try {
      releaseCompatibility = acquireCompatibilityLock(target, deadline, pollMs, malformedGraceMs)
    } catch (error) {
      releaseGuard()
      throw error
    }

    let released = false
    return () => {
      if (released) return
      released = true
      try {
        releaseCompatibility?.()
      } finally {
        releaseGuard()
      }
    }
  }

  function acquireGuard(dbPath: string, deadline: number, target: string): () => void {
    const guardPath = dbPath + ".migrate.guard"
    fs.closeSync(fs.openSync(guardPath, "a", 0o600))

    const remaining = Math.max(1, deadline - Date.now())
    const guard = new DatabaseSync(guardPath, {
      open: true,
      readOnly: false,
      // SQLite stores the busy timeout as a signed 32-bit millisecond value.
      timeout: Math.min(remaining, 2_147_483_647),
    })
    try {
      guard.exec("BEGIN IMMEDIATE")
    } catch (error) {
      guard.close()
      if (isBusyError(error)) {
        throw new Error(`Timed out waiting for migration lock: ${target}`, { cause: error })
      }
      throw error
    }

    let released = false
    return () => {
      if (released) return
      released = true
      try {
        guard.exec("ROLLBACK")
      } catch (error) {
        log.error("failed to release migration guard transaction", { guardPath, error })
      } finally {
        try {
          guard.close()
        } catch (error) {
          log.error("failed to close migration guard database", { guardPath, error })
        }
      }
    }
  }

  function acquireCompatibilityLock(
    target: string,
    deadline: number,
    pollMs: number,
    malformedGraceMs: number,
  ): () => void {
    const body: MigrationLockBody = { ...createProcessLockBody(), token: randomUUID() }
    const ownText = JSON.stringify(body)
    const prepared = prepareOwnerFile(target, ownText)

    try {
      while (true) {
        if (prepared.tryLink()) {
          prepared.cleanup()
          return () => releaseCompatibilityLock(target, ownText)
        }

        const snapshot = readSnapshot(target)
        if (!snapshot) continue
        if (reclaimable(snapshot, malformedGraceMs) && removeIfUnchanged(target, snapshot)) {
          log.warn("reclaimed abandoned migration compatibility lock", {
            target,
            holder: snapshot.body,
          })
          continue
        }

        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for migration lock: ${target}`)
        }
        sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())))
      }
    } catch (error) {
      prepared.cleanup()
      throw error
    }
  }

  // Create a complete owner file first, then atomically hard-link it into the
  // lock path. Unlike open("wx") followed by write(), contenders can never
  // observe this version's lock with an empty or partially written body.
  function prepareOwnerFile(target: string, text: string) {
    const preparedPath = `${target}.${process.pid}.${randomUUID()}.tmp`
    const handle = fs.openSync(preparedPath, "wx", 0o600)
    try {
      fs.writeFileSync(handle, text)
    } catch (error) {
      try {
        fs.unlinkSync(preparedPath)
      } catch {
        // Preserve the write error. A uniquely named incomplete temp file is
        // never considered a lock owner and is harmless after a crash.
      }
      throw error
    } finally {
      fs.closeSync(handle)
    }

    let cleaned = false
    return {
      tryLink(): boolean {
        try {
          fs.linkSync(preparedPath, target)
          return true
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false
          throw error
        }
      },
      cleanup() {
        if (cleaned) return
        cleaned = true
        try {
          fs.unlinkSync(preparedPath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
            log.warn("failed to clean prepared migration lockfile", { preparedPath, error })
          }
        }
      },
    }
  }

  function readSnapshot(target: string): Snapshot | undefined {
    let fd: number
    try {
      fd = fs.openSync(target, "r")
    } catch {
      return undefined
    }
    try {
      const before = fs.fstatSync(fd)
      if (!before.isFile()) throw new Error(`Migration lock path is not a regular file: ${target}`)
      const text = fs.readFileSync(fd, "utf-8")
      const after = fs.fstatSync(fd)
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mtimeMs !== after.mtimeMs ||
        before.size !== after.size
      ) {
        return undefined
      }
      return {
        body: parseProcessLockBody(text),
        dev: after.dev,
        ino: after.ino,
        mtimeMs: after.mtimeMs,
        size: after.size,
        text,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return undefined
      throw error
    } finally {
      fs.closeSync(fd)
    }
  }

  function reclaimable(snapshot: Snapshot, malformedGraceMs: number): boolean {
    const body = snapshot.body
    if (!body) return Date.now() - snapshot.mtimeMs > malformedGraceMs
    if (!isSameProcessLockHost(body)) return false
    if (body.pid === process.pid) return false
    return !pidAlive(body.pid)
  }

  // The sidecar guard serializes all v7.7.8+ reclaimers. Comparing the whole
  // snapshot immediately before unlink also prevents a changed owner from
  // being removed accidentally. Older v7.7.7 contenders still coordinate via
  // the target's atomic create semantics.
  function removeIfUnchanged(target: string, expected: Snapshot): boolean {
    const current = readSnapshot(target)
    if (!current) return true
    if (
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      current.mtimeMs !== expected.mtimeMs ||
      current.size !== expected.size ||
      current.text !== expected.text
    ) {
      return false
    }
    try {
      fs.unlinkSync(target)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return true
      throw error
    }
  }

  function releaseCompatibilityLock(target: string, ownText: string) {
    try {
      const current = fs.readFileSync(target, "utf-8")
      if (current !== ownText) {
        log.warn("skipping migration lock release after ownership changed", { target })
        return
      }
      fs.unlinkSync(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return
      log.error("failed to release migration compatibility lock", { target, error })
    }
  }

  function pidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException)?.code !== "ESRCH"
    }
  }

  function isBusyError(error: unknown): boolean {
    const errcode = (error as { errcode?: unknown } | undefined)?.errcode
    return typeof errcode === "number" && (errcode & 0xff) === 5
  }

  function duration(name: string, value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be a non-negative finite number`)
    return Math.ceil(value)
  }

  function sleep(ms: number) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }
}
