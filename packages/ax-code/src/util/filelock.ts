import fs from "fs/promises"
import { readFileSync, unlinkSync } from "fs"
import path from "path"
import { Log } from "./log"
import { sleep } from "./timeout"
import {
  createProcessLockBody,
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

export namespace FileLock {
  async function writeLockFile(target: string): Promise<void> {
    const body: ProcessLockBody = createProcessLockBody()
    const handle = await fs.open(target, "wx")
    try {
      await handle.writeFile(JSON.stringify(body))
    } finally {
      await handle.close()
    }
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

  /**
   * Acquire a cross-process file lock. Blocks until the lock is free
   * or the timeout expires. Returns a Disposable that releases the lock.
   */
  export async function acquire(
    filepath: string,
    opts?: { timeoutMs?: number; staleMs?: number },
  ): Promise<Disposable> {
    const target = filepath + ".lock"
    const timeout = opts?.timeoutMs ?? 10_000
    const staleMs = opts?.staleMs ?? DEFAULT_STALE_MS
    const deadline = Date.now() + timeout

    await fs.mkdir(path.dirname(target), { recursive: true })

    while (true) {
      const created = await writeLockFile(target)
        .then(() => true)
        .catch((err: NodeJS.ErrnoException) => {
          if (err?.code === "EEXIST") return false
          throw err
        })
      if (created) return makeDisposable(target)

      const stolen = await maybeSteal(target, staleMs)
      if (stolen) {
        const retry = await writeLockFile(target)
          .then(() => true)
          .catch((err: NodeJS.ErrnoException) => {
            if (err?.code === "EEXIST") return false
            throw err
          })
        if (retry) return makeDisposable(target)
      }

      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for file lock: ${target}`)
      }
      await sleep(POLL_INTERVAL_MS)
    }
  }

  function makeDisposable(target: string): Disposable {
    let disposed = false
    return {
      // Symbol.dispose is a synchronous protocol — using fs.unlink (async)
      // here lets the lockfile linger on disk after `using` exits, which
      // makes another acquirer see a stale body and wait one poll interval
      // before succeeding (BUG-117). unlinkSync removes the file before
      // dispose returns, matching the semantics callers expect.
      [Symbol.dispose]: () => {
        if (disposed) return
        disposed = true
        try {
          const body = readLockBodySync(target)
          if (body?.pid === process.pid && isSameProcessLockHost(body)) {
            unlinkSync(target)
          } else {
            log.warn("skipping file lock release after ownership changed", { target, ownerPid: body?.pid })
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return
          log.error("failed to release file lock", { target, err })
        }
      },
    }
  }
}
