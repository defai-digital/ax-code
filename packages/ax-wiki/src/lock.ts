// Advisory inter-process build lock for AX Wiki (gate C7).
//
// Node/filesystem implementation of the injected `WikiBuildLock` port. Two
// concurrent `buildAxWiki` runs on the same root otherwise race on rename/rm in
// the write phase. This lock follows the same host/PID/staleness contract used by
// the code-intelligence index lock, plus three hardening rules:
//
// - Ownership: the lockfile carries a per-acquisition `token`; `release()` only
//   removes the file while it still carries that token, so a holder whose lock
//   was stolen after going stale cannot delete the new holder's lock.
// - Heartbeat: a live holder refreshes the lockfile mtime with `utimes` on an
//   interval — a touch cannot corrupt another holder's content, unlike a
//   rewrite. Long builds keep their lock; a wedged process (touches stopped)
//   still goes stale on the `staleMs` budget. The mtime check only applies to
//   the real clock; an injected `now` (tests) falls back to `startedAt`.
// - Verified steal: a stale lock is claimed by renaming it away and then
//   verifying the moved bytes are the same stale body that was observed —
//   otherwise the rename could have stolen a fresh lock created in between.
//   A failed verification restores the file with `link`, which fails closed
//   when another holder has already re-created the path.
//
// This module is node-side (it imports node:fs/node:os) and is exported from the
// `./node` subpath, never from `./core`.

import { randomUUID } from "node:crypto"
import { link, mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { WikiBuildLock, WikiBuildLockHandle } from "./types.js"

// Automatic maintenance jobs carry a 10-minute deadline, so a lock untouched for
// 30 minutes belongs to a wedged holder, not a healthy build.
const STALE_LOCK_MS = 30 * 60 * 1000
const ACQUIRE_TIMEOUT_MS = 30_000
const RETRY_INTERVAL_MS = 100
const HEARTBEAT_INTERVAL_MS = 60_000
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000

type LockBody = { pid: number; startedAt: number; host: string; token: string }

export type WikiBuildLockOptions = {
  acquireTimeoutMs?: number
  retryIntervalMs?: number
  staleMs?: number
  heartbeatMs?: number
  /** Clock for staleness decisions only; the acquire deadline is monotonic. */
  now?: () => number
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String(error.code) : undefined
}

export function createWikiBuildLock(root: string, wikiDir: string, options: WikiBuildLockOptions = {}): WikiBuildLock {
  const lockPath = path.join(root, wikiDir, ".build-lock")
  const acquireTimeoutMs = positive(options.acquireTimeoutMs, ACQUIRE_TIMEOUT_MS)
  const retryIntervalMs = positive(options.retryIntervalMs, RETRY_INTERVAL_MS)
  const staleMs = positive(options.staleMs, STALE_LOCK_MS)
  // Heartbeats must land well inside the staleness budget, or a healthy holder
  // could be stolen between refreshes.
  const heartbeatMs = Math.max(
    25,
    Math.min(positive(options.heartbeatMs, HEARTBEAT_INTERVAL_MS), Math.max(25, Math.floor(staleMs / 3))),
  )
  const now = options.now ?? Date.now
  // The heartbeat lives in the real-clock mtime domain; an injected staleness
  // clock (tests) cannot be compared against real mtimes.
  const realClock = options.now === undefined
  const host = os.hostname()

  const pidAlive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // Only ESRCH proves the process is gone. EPERM means alive-but-other-user;
      // any other error (sandbox quirks, transient failures) must not condemn a
      // live holder.
      return errorCode(error) !== "ESRCH"
    }
  }

  const parseBody = (text: string): Partial<LockBody> | undefined => {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
      return parsed as Partial<LockBody>
    } catch {
      return undefined
    }
  }

  const isStale = (text: string, mtimeMs?: number): boolean => {
    const parsed = parseBody(text)
    // An unparseable lockfile is treated as stale so it cannot wedge builds.
    if (!parsed) return true
    const startedAt = parsed.startedAt
    if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return true
    // A lock stamped beyond small clock-skew tolerance is corrupt, not fresh:
    // a fast clock would otherwise wedge the lock for staleMs plus the skew.
    if (startedAt > now() + CLOCK_SKEW_TOLERANCE_MS) return true
    // A lock written by this host whose owner process is gone is stale
    // immediately: a crashed build must not wedge successors for staleMs.
    if (parsed.host === host && typeof parsed.pid === "number" && !pidAlive(parsed.pid)) return true
    // Trust the heartbeat mtime over startedAt, same-host or cross-host: a
    // long build keeps its lock while a wedged holder (touches stopped) still
    // times out. startedAt is stamped by the holder's clock just like the
    // mtime, so the fresher value is never the worse one.
    const touched = realClock && mtimeMs !== undefined ? mtimeMs : startedAt
    return now() - touched > staleMs
  }

  const readLock = async (): Promise<{ text: string; mtimeMs: number } | undefined> => {
    try {
      const [info, text] = await Promise.all([stat(lockPath), readFile(lockPath, "utf8")])
      return { text, mtimeMs: info.mtimeMs }
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined
      // Permission or I/O errors must surface: reporting them as a held lock
      // would mislead every waiter into a spurious timeout.
      throw new Error(`AX Wiki build lock is unreadable: ${lockPath}`, { cause: error })
    }
  }

  // Atomically claim a stale lock by renaming it away, then verify the moved
  // file is the same stale body we observed. A bare `rm` races (two waiters can
  // both read the stale lock and the slower one's `rm` can delete the faster
  // one's fresh lock), and an unverified `rename` races too: between our read
  // and the rename the old holder may have released and a new holder may have
  // created a fresh lock, which the rename would then steal.
  const stealStaleLock = async (observed: { text: string; mtimeMs: number }): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const stalePath = `${lockPath}.stale-${randomUUID()}`
      try {
        await rename(lockPath, stalePath)
      } catch (error) {
        const code = errorCode(error)
        // A stale-path collision (practically impossible with UUIDs): retry once.
        if (code === "EEXIST") continue
        // ENOENT: the lock vanished first. EPERM/EBUSY/EACCES (Windows file
        // locking): another process is moving it — lost the race, not fatal.
        if (code === "ENOENT" || code === "EPERM" || code === "EBUSY" || code === "EACCES") return false
        throw error
      }
      const moved = await readFile(stalePath, "utf8").catch(() => undefined)
      // Re-stat the moved file instead of trusting the observed mtime: rename
      // preserves it, so a heartbeat that landed between our read and the
      // rename is visible here and keeps the live holder's lock unstealable.
      const movedMtime = (await stat(stalePath).catch(() => undefined))?.mtimeMs ?? observed.mtimeMs
      if (moved !== undefined && moved === observed.text && isStale(moved, movedMtime)) {
        await rm(stalePath, { force: true }).catch(() => {})
        return true
      }
      // Not the lock we observed: put it back so its owner is untouched. `link`
      // fails closed when another holder has already re-created the path (a
      // POSIX `rename` would silently overwrite their fresh lock); the copy is
      // then discarded and the token check in release() keeps the displaced
      // owner from deleting the current holder's lock.
      try {
        await link(stalePath, lockPath)
      } catch {
        // The path is held again — leave it alone.
      }
      await rm(stalePath, { force: true }).catch(() => {})
      return false
    }
    return false
  }

  return {
    async acquire(): Promise<WikiBuildLockHandle> {
      await mkdir(path.dirname(lockPath), { recursive: true })
      const token = randomUUID()
      const renderBody = (): string =>
        JSON.stringify({ pid: process.pid, startedAt: now(), host, token } satisfies LockBody)

      const writeExclusive = async (): Promise<boolean> => {
        try {
          await writeFile(lockPath, renderBody(), { flag: "wx" })
          return true
        } catch (error) {
          if (errorCode(error) === "EEXIST") return false
          throw error
        }
      }

      const tryCreate = async (): Promise<boolean> => {
        try {
          return await writeExclusive()
        } catch (error) {
          // The wiki directory was removed mid-flight; recreate and retry once.
          if (errorCode(error) !== "ENOENT") throw error
          await mkdir(path.dirname(lockPath), { recursive: true })
          return writeExclusive()
        }
      }

      // Monotonic deadline: immune to system-clock jumps and to the injected
      // staleness clock used by tests.
      const deadline = performance.now() + acquireTimeoutMs
      for (;;) {
        if (await tryCreate()) {
          let released = false
          // `utimes` only touches the file: if the lock was stolen, the touch
          // lands on the new holder's fresh file, where a fresh mtime is the
          // truth anyway. No ownership check is needed for a touch.
          const heartbeat = setInterval(() => {
            const stamp = new Date()
            utimes(lockPath, stamp, stamp).catch(() => {})
          }, heartbeatMs)
          heartbeat.unref?.()
          return {
            async release() {
              if (released) return
              released = true
              clearInterval(heartbeat)
              // Ownership check: if our lock was stolen after going stale, the
              // file now belongs to another holder's token and must survive.
              const current = parseBody((await readFile(lockPath, "utf8").catch(() => "")) ?? "")
              if (current?.token !== token) return
              await rm(lockPath, { force: true })
            },
          }
        }
        const existing = await readLock()
        if (existing !== undefined && isStale(existing.text, existing.mtimeMs)) {
          if (await stealStaleLock(existing)) continue
          // Another waiter stole it first, or the observed lock was replaced;
          // fall through and retry on the next loop.
        }
        if (performance.now() >= deadline) {
          throw new Error(`AX Wiki build lock is held by another process (lockfile: ${lockPath})`)
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
      }
    },
  }
}
