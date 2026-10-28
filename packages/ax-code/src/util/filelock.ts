import fs from "fs/promises"
import { readFileSync, unlinkSync } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { DatabaseSync } from "node:sqlite"
import { Log } from "./log"
import { sleep } from "./timeout"
import {
  createProcessLockBody,
  isSameProcessLockBody,
  isSameProcessLockHost,
  parseProcessLockBody,
  type ProcessLockBody,
} from "./process-lock"

// Cross-process advisory file lock.
//
// A permanent SQLite sidecar holds the OS mutex for the whole acquisition.
// The JSON O_EXCL lockfile remains for compatibility with older processes.
// Serializing only its create is insufficient: stale recovery can rename a
// replacement owner away and admit another writer through the vacant path.
// SQLite releases the guard on process exit, including a crash during the
// JSON body write. Never unlink or independently open/read the guard file.
//
// Extracted from code-intelligence/lockfile.ts (BUG-12) to provide a
// general-purpose cross-process lock for Storage.update and any other
// read-modify-write file operations.

const log = Log.create({ service: "filelock" })

// Compatibility files older than this may be abandoned after PID reuse.
// A live holder of the SQLite guard is never evicted based on this age.
const DEFAULT_STALE_MS = 60 * 1000 // 60 seconds
const POLL_INTERVAL_MS = 50

// Grace window for a lockfile with no readable body. The body write lands
// within microseconds of the atomic O_EXCL creation, so a file still empty
// after this long is a corpse, not a mid-write holder — steal it even when
// the caller's stale window for well-formed locks is much longer (the index
// lock uses 8h; waiting that out for an empty file would stall indexing for
// hours after a crash).
const EMPTY_LOCK_GRACE_MS = 60 * 1000

export namespace FileLock {
  /** The lock stayed held by another process past the acquire deadline. */
  export class TimeoutError extends Error {
    constructor(public readonly target: string) {
      super(`timed out waiting for file lock: ${target}`)
      this.name = "FileLockTimeoutError"
    }
  }

  function tryGuard(target: string): Disposable | undefined {
    const guard = new DatabaseSync(target + ".guard", { timeout: 0 })
    try {
      // No schema or data writes, no WAL, and no journal. The RESERVED lock
      // conflicts with other contenders, including connections in this PID.
      guard.exec("BEGIN IMMEDIATE")
    } catch (error) {
      guard.close()
      if (error && typeof error === "object" && "errcode" in error && error.errcode === 5) return
      throw error
    }
    let released = false
    return {
      [Symbol.dispose]() {
        if (released) return
        released = true
        try {
          guard.exec("ROLLBACK")
        } finally {
          guard.close()
        }
      },
    }
  }

  async function writeLockFile(target: string): Promise<ProcessLockBody> {
    const body: ProcessLockBody = createProcessLockBody()
    const handle = await fs.open(target, "wx")
    try {
      await handle.writeFile(JSON.stringify(body))
    } catch (error) {
      // The exclusive create already reserved the path. A body write that
      // fails (ENOSPC, EIO) would otherwise leave an empty lockfile that no
      // other process may steal for EMPTY_LOCK_GRACE_MS, blocking the path
      // long after the failure. The file is still empty, so nobody else can
      // have taken ownership in between.
      await fs.unlink(target).catch(() => undefined)
      throw error
    } finally {
      // The body is already on disk and names this process, so the lock is
      // ours even when the descriptor fails to close. Propagating the close
      // error would reject the acquisition with no Disposable in hand —
      // orphaning a lock this process can never release.
      await handle.close().catch((error) => {
        log.warn("file lock descriptor failed to close after body write", { target, error })
      })
    }
    return body
  }

  async function readLockBody(target: string): Promise<ProcessLockBody | undefined> {
    const text = await fs.readFile(target, "utf-8").catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") return undefined
      throw err
    })
    if (!text) return undefined
    return parseProcessLockBody(text)
  }

  /**
   * Remove the lock at `target` only if it is still the one judged stale.
   * Two processes can judge the same stale body; if the first replaces it with
   * a fresh lock before the second's unlink lands, a plain unlink deletes that
   * live lock and both processes then hold the path. Renaming is atomic, so
   * move the file aside, confirm it is the expected lock, and put anything
   * else back.
   */
  async function removeIfUnchanged(target: string, expected: ProcessLockBody | undefined): Promise<void> {
    const aside = `${target}.steal-${process.pid}-${randomUUID()}`
    const moved = await fs.rename(target, aside).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err?.code === "ENOENT") return false
        throw err
      },
    )
    if (!moved) return
    const body = await readLockBody(aside).catch(() => undefined)
    const unchanged =
      expected === undefined ? body === undefined : body !== undefined && isSameProcessLockBody(body, expected)
    if (!unchanged) {
      log.warn("file lock changed hands during steal; restoring it", { target, pid: body?.pid })
      // link() fails if yet another lock already took the path; that holder wins.
      await fs.link(aside, target).catch(() => undefined)
    }
    await fs.unlink(aside).catch(() => undefined)
  }

  function readLockBodySync(target: string): ProcessLockBody | undefined {
    return parseProcessLockBody(readFileSync(target, "utf-8"))
  }

  async function maybeSteal(target: string, staleMs: number): Promise<boolean> {
    const body = await readLockBody(target)
    if (!body) {
      // An empty lockfile is ambiguous: the holder may have crashed between
      // the atomic O_EXCL creation and the body write, or another process may
      // have just created the file and not written its body yet. Stealing a
      // freshly created file lets two processes believe they hold the same
      // lock at once, so only steal once the file's mtime proves it was
      // abandoned (the body write lands within microseconds of creation, so
      // a short grace — not the caller's full stale window — is enough).
      const mtimeMs = await fs
        .stat(target)
        .then((stats) => stats.mtimeMs)
        .catch((err: NodeJS.ErrnoException) => {
          if (err?.code === "ENOENT") return undefined
          throw err
        })
      if (mtimeMs === undefined) {
        // The lock vanished between our EEXIST and this stat: the path is
        // already free. Report stealable so the caller retries — but never
        // unlink: a fresh lock another process created in that gap must not
        // be deleted.
        return true
      }
      if (Date.now() - mtimeMs <= Math.min(staleMs, EMPTY_LOCK_GRACE_MS)) return false
      await removeIfUnchanged(target, undefined)
      return true
    }
    const age = Date.now() - body.startedAt
    if (age > staleMs) {
      log.warn("stealing stale file lock", {
        target,
        age,
        staleMs,
        pid: body.pid,
        host: body.host,
      })
      await removeIfUnchanged(target, body)
      return true
    }
    const sameHost = isSameProcessLockHost(body)
    if (sameHost && body.pid !== process.pid) {
      try {
        process.kill(body.pid, 0)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ESRCH") {
          log.warn("stealing abandoned file lock", { target, pid: body.pid })
          await removeIfUnchanged(target, body)
          return true
        }
      }
    }
    return false
  }

  // One non-blocking acquisition attempt: create, then steal a stale or
  // abandoned lock once and retry the create. Returns undefined while another
  // process holds it.
  async function attempt(target: string, staleMs: number, signal?: AbortSignal): Promise<Disposable | undefined> {
    signal?.throwIfAborted()
    const guard = tryGuard(target)
    if (!guard) return
    let transferred = false
    try {
      const created = await writeLockFile(target).catch((err: NodeJS.ErrnoException) => {
        if (err?.code === "EEXIST") return undefined
        throw err
      })
      if (created) {
        transferred = true
        return acquired(target, created, guard, signal)
      }

      signal?.throwIfAborted()
      const stolen = await maybeSteal(target, staleMs)
      if (!stolen) return undefined
      const retry = await writeLockFile(target).catch((err: NodeJS.ErrnoException) => {
        if (err?.code === "EEXIST") return undefined
        throw err
      })
      if (!retry) return
      transferred = true
      return acquired(target, retry, guard, signal)
    } finally {
      if (!transferred) guard[Symbol.dispose]()
    }
  }

  /**
   * Non-blocking acquisition attempt. Returns a Disposable when the lock was
   * taken (including after stealing a stale or abandoned one), or undefined
   * while another process holds it.
   */
  export async function tryAcquire(
    filepath: string,
    opts?: { staleMs?: number; signal?: AbortSignal },
  ): Promise<Disposable | undefined> {
    opts?.signal?.throwIfAborted()
    const target = filepath + ".lock"
    await fs.mkdir(path.dirname(target), { recursive: true })
    return attempt(target, opts?.staleMs ?? DEFAULT_STALE_MS, opts?.signal)
  }

  /**
   * Acquire a cross-process file lock. Blocks until the lock is free
   * or the timeout expires. Returns a Disposable that releases the lock.
   * `onWait` fires once when the caller first has to wait for a holder.
   */
  export async function acquire(
    filepath: string,
    opts?: { timeoutMs?: number; staleMs?: number; signal?: AbortSignal; onWait?: () => void },
  ): Promise<Disposable> {
    opts?.signal?.throwIfAborted()
    const target = filepath + ".lock"
    const timeout = opts?.timeoutMs ?? 10_000
    const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS
    const deadline = Date.now() + timeout

    await fs.mkdir(path.dirname(target), { recursive: true })

    let waited = false
    while (true) {
      const lock = await attempt(target, staleMs, opts?.signal)
      if (lock) return lock
      if (!waited) {
        opts?.onWait?.()
        waited = true
      }
      if (Date.now() >= deadline) {
        throw new TimeoutError(target)
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  function acquired(target: string, owner: ProcessLockBody, guard: Disposable, signal?: AbortSignal): Disposable {
    const lock = makeDisposable(target, owner, guard)
    if (signal?.aborted) {
      lock[Symbol.dispose]()
      signal.throwIfAborted()
    }
    return lock
  }

  function makeDisposable(target: string, owner: ProcessLockBody, heldGuard: Disposable): Disposable {
    let disposed = false
    let guard: Disposable | undefined = heldGuard
    return {
      // Symbol.dispose is a synchronous protocol — using fs.unlink (async)
      // here lets the lockfile linger on disk after `using` exits, which
      // makes another acquirer see a stale body and wait one poll interval
      // before succeeding (BUG-117). unlinkSync removes the file before
      // dispose returns, matching the semantics callers expect.
      [Symbol.dispose]: () => {
        if (disposed) return
        let settled = false
        try {
          // A failed unlink remains retryable, but must reacquire exclusion
          // before a later dispose reads and removes the compatibility file.
          guard ??= tryGuard(target)
          if (!guard) return
          const body = readLockBodySync(target)
          // Compare with the body this acquisition wrote, not with the ambient
          // host name: a hostname change while the lock is held would
          // otherwise skip the unlink, and `disposed` is already set so the
          // release can never be retried — the path then stays blocked for the
          // whole stale window.
          if (body && isSameProcessLockBody(body, owner)) {
            unlinkSync(target)
          } else {
            log.warn("skipping file lock release after ownership changed", { target, ownerPid: body?.pid })
          }
          settled = true
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
            settled = true
          } else {
            // Transient failure (EPERM, EBUSY, EIO): keep the dispose
            // retryable. Latching `disposed` here would pin the lockfile for
            // the whole stale window with no later release possible.
            log.error("failed to release file lock", { target, err })
          }
        } finally {
          try {
            guard?.[Symbol.dispose]()
          } finally {
            guard = undefined
          }
        }
        if (settled) disposed = true
      },
    }
  }
}
