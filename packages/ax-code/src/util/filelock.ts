import fs from "fs/promises"
import { readFileSync, unlinkSync } from "fs"
import path from "path"
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
// Uses atomic O_EXCL file creation as a mutex: `fs.open(path, "wx")`
// fails with EEXIST if the file already exists. The lockfile contains
// JSON with `{ pid, startedAt, host }` so we can detect stale locks
// left behind by crashed processes.
//
// Extracted from code-intelligence/lockfile.ts (BUG-12) to provide a
// general-purpose cross-process lock for Storage.update and any other
// read-modify-write file operations.

const log = Log.create({ service: "filelock" })

// Locks older than this are treated as abandoned even if a PID still responds
// to kill(0) (PID reuse after a crash). Keep short enough that a crashed
// holder cannot block writers for minutes, but long enough that a legitimate
// multi-second write is never stolen mid-flight.
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

  async function removeLockFile(target: string): Promise<void> {
    await fs.unlink(target).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") return
      throw err
    })
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
      await removeLockFile(target)
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
      await removeLockFile(target)
      return true
    }
    const sameHost = isSameProcessLockHost(body)
    if (sameHost && body.pid !== process.pid) {
      try {
        process.kill(body.pid, 0)
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ESRCH") {
          log.warn("stealing abandoned file lock", { target, pid: body.pid })
          await removeLockFile(target)
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
    const created = await writeLockFile(target).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "EEXIST") return undefined
      throw err
    })
    if (created) return acquired(target, created, signal)

    signal?.throwIfAborted()
    const stolen = await maybeSteal(target, staleMs)
    if (!stolen) return undefined
    const retry = await writeLockFile(target).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "EEXIST") return undefined
      throw err
    })
    return retry ? acquired(target, retry, signal) : undefined
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

  function acquired(target: string, owner: ProcessLockBody, signal?: AbortSignal): Disposable {
    const lock = makeDisposable(target, owner)
    if (signal?.aborted) {
      lock[Symbol.dispose]()
      signal.throwIfAborted()
    }
    return lock
  }

  function makeDisposable(target: string, owner: ProcessLockBody): Disposable {
    let disposed = false
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
        }
        if (settled) disposed = true
      },
    }
  }
}
