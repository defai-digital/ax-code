import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { NativeStore } from "./native-store"
import type { ProjectID } from "../project/schema"

// Cross-process advisory lock for code-graph indexing runs.
//
// The v2.3.11 post-mortem flagged BUG-12: two ax-code processes (TUI
// auto-index in one terminal, `ax-code index` in another) writing to
// the same SQLite file could race on `code_file` / `code_node` upserts.
// SQLite's WAL mode keeps the DB from corrupting, but the busy_timeout
// of 5s is not enough when a full project index takes minutes, so one
// of the two writers would silently fail mid-batch and leave the graph
// half-populated.
//
// This is a project-scoped advisory lock, not an SQLite page lock. It
// guards the *caller* (the index batch) from running concurrently with
// a sibling in another process, which is the real conflict surface.
// SQLite still handles intra-process concurrency via its own locking.
//
// Design notes:
//
// - Lockfile lives under `<data>/locks/code-index-<project-id>.lock`.
//   Same directory that other ax-code locks end up in, created lazily.
// - Acquired via `fs.open(path, "wx")` — atomic create-or-fail. If the
//   file already exists, we inspect its contents (PID + timestamp) and
//   steal it if the holder is dead or the lock is older than
//   STALE_LOCK_MS (8 hours — longer than any realistic index batch).
// - Contents are JSON: `{ pid: number, startedAt: number, host: string }`.
//   The host field catches NFS-mounted data dirs where PIDs from a
//   different machine would be meaningless; we refuse to steal across
//   hostnames.
// - Released via the returned Disposable's [Symbol.dispose], which
//   unlinks the file. Crash-on-held is handled by the staleness check
//   on the next acquire attempt.

const log = Log.create({ service: "code-intelligence.lockfile" })

// Stale-lock threshold. A lock older than this is assumed to belong to
// a crashed process. 8h is generous — the largest projects we've seen
// take ~15 minutes to index, so 8 hours is 32× safety margin.
const STALE_LOCK_MS = 8 * 60 * 60 * 1000

// Poll interval when waiting on a held lock. 500ms balances responsive
// takeover against wasted syscalls on a long-running batch.
const POLL_INTERVAL_MS = 500

type LockBody = {
  pid: number
  startedAt: number
  host: string
}

export namespace IndexLock {
  function lockPath(projectID: ProjectID): string {
    return path.join(Global.Path.data, "locks", `code-index-${projectID}.lock`)
  }

  async function writeLockFile(target: string): Promise<void> {
    const body: LockBody = {
      pid: process.pid,
      startedAt: Date.now(),
      host: process.env.HOSTNAME ?? "",
    }
    // wx = create+exclusive. Throws EEXIST if the file exists.
    const handle = await fs.open(target, "wx")
    try {
      await handle.writeFile(JSON.stringify(body))
    } finally {
      await handle.close()
    }
  }

  async function readLockBody(target: string): Promise<LockBody | undefined> {
    const text = await fs.readFile(target, "utf-8").catch(() => undefined)
    if (text === undefined) return undefined
    try {
      return JSON.parse(text) as LockBody
    } catch {
      return undefined
    }
  }

  // Returns true if the lockfile was stolen (i.e. the previous holder
  // is dead or the lock is stale). Returns false if the previous holder
  // is still alive and the lock is fresh.
  async function maybeSteal(target: string): Promise<boolean> {
    const body = await readLockBody(target).catch(() => undefined)
    if (!body) {
      // Corrupt or missing file — safe to steal.
      await fs.unlink(target).catch(() => undefined)
      return true
    }
    const sameHost = (process.env.HOSTNAME ?? "") === body.host
    const age = Date.now() - body.startedAt
    if (age > STALE_LOCK_MS) {
      log.warn("stealing stale index lock", { target, age, body })
      await fs.unlink(target).catch(() => undefined)
      return true
    }
    if (sameHost && body.pid !== process.pid) {
      // Signal 0 is the "is it alive?" probe. Three outcomes:
      //   - success → process exists and we can signal it
      //   - throws EPERM → process exists but we lack permission
      //     (this is the common case on macOS for pid 1 / root-owned
      //     processes; we must NOT treat it as dead)
      //   - throws ESRCH → process does not exist, safe to steal
      // Any other errno (very rare) → conservatively assume alive.
      const alive = await new Promise<boolean>((resolve) => {
        try {
          process.kill(body.pid, 0)
          resolve(true)
        } catch (err) {
          const code = (err as NodeJS.ErrnoException)?.code
          if (code === "ESRCH") resolve(false)
          else resolve(true)
        }
      })
      if (!alive) {
        log.warn("stealing abandoned index lock", { target, body })
        await fs.unlink(target).catch(() => undefined)
        return true
      }
    }
    return false
  }

  // Non-blocking attempt. Returns a Disposable on success, undefined if
  // another process currently holds the lock. Callers (auto-index) use
  // this when they'd rather skip than wait.
  export async function tryAcquire(projectID: ProjectID): Promise<Disposable | undefined> {
    // Native fast-path: kernel-level flock() with auto-release on crash
    if (Flag.AX_CODE_NATIVE_INDEX && NativeStore.available) {
      const target = lockPath(projectID)
      const nativeLock = NativeStore.createAdvisoryLock(target)
      if (nativeLock?.tryAcquire()) {
        return { [Symbol.dispose]: () => nativeLock.release() }
      }
      return undefined
    }
    const target = lockPath(projectID)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const result = await writeLockFile(target)
      .then(() => true)
      .catch((err: NodeJS.ErrnoException) => {
        if (err?.code !== "EEXIST") throw err
        return false
      })
    if (result) return makeDisposable(target)
    // Held. Try once to steal if it's stale or abandoned.
    const stolen = await maybeSteal(target)
    if (!stolen) return undefined
    // Stealing succeeded — retry the create. Only `EEXIST` (a third
    // process won the post-steal race) counts as "couldn't acquire";
    // every other errno (EACCES, ENOSPC, EIO) is a real failure and
    // must propagate, otherwise the caller proceeds without the lock
    // it thinks it just stole. The initial write path above already
    // has this contract — the retry path was missing it in v2.3.13.
    // See BUG-74.
    const retry = await writeLockFile(target)
      .then(() => true)
      .catch((err: NodeJS.ErrnoException) => {
        if (err?.code === "EEXIST") return false
        throw err
      })
    return retry ? makeDisposable(target) : undefined
  }

  // Blocking acquire with a deadline. Waits until the lock becomes free
  // or the timeout expires. onWait is invoked once the first time the
  // caller has to actually wait — lets the CLI print a message without
  // spamming on every poll.
  export async function acquire(
    projectID: ProjectID,
    opts: { timeoutMs: number; onWait?: () => void },
  ): Promise<Disposable> {
    const deadline = Date.now() + opts.timeoutMs
    let warned = false
    while (true) {
      const handle = await tryAcquire(projectID)
      if (handle) return handle
      if (!warned) {
        opts.onWait?.()
        warned = true
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for code-index lock on project ${projectID}`)
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    }
  }

  function makeDisposable(target: string): Disposable {
    let disposed = false
    return {
      [Symbol.dispose]: () => {
        if (disposed) return
        disposed = true
        // Best-effort unlink. If the file is already gone (stolen by
        // another process after we acquired — should not happen unless
        // clocks are badly wrong) we swallow the ENOENT.
        fs.unlink(target).catch((err: NodeJS.ErrnoException) => {
          if (err?.code === "ENOENT") return
          log.error("failed to release index lock", { target, err })
        })
      },
    }
  }

  // Test helper: wipe any lockfile for the given project, regardless of
  // holder. Production code should never need this — tests use it to
  // reset between cases.
  export async function __reset(projectID: ProjectID): Promise<void> {
    await fs.unlink(lockPath(projectID)).catch(() => undefined)
  }
}
