// Advisory inter-process build lock for AX Wiki (gate C7).
//
// Node/filesystem implementation of the injected `WikiBuildLock` port. Two
// concurrent `buildAxWiki` runs on the same root otherwise race on rename/rm in
// the write phase. This lock follows the same host/PID/staleness contract used by
// the code-intelligence index lock, plus three hardening rules:
//
// - Ownership: the lockfile carries a per-acquisition `token`; `release()`
//   renames the lockfile aside and only deletes the moved body while it still
//   carries that token, so a holder whose lock was stolen after going stale
//   cannot delete the new holder's lock — not even when the steal lands in the
//   middle of the release. A foreign body is restored with `link`, which fails
//   closed when the path has already been re-created.
// - Heartbeat: a live holder refreshes the lockfile mtime on an interval via
//   one open descriptor (read body, then `handle.utimes` on that fd) — a touch
//   cannot corrupt another holder's content, unlike a rewrite, and the pinned
//   inode keeps a mid-tick steal from tricking us into refreshing a
//   successor's mtime. Long builds keep their lock; a wedged process (touches
//   stopped) still goes stale on the `staleMs` budget. The mtime check only
//   applies to the real clock; an injected `now` (tests) falls back to
//   `startedAt`.
// - Verified steal: a stale lock is claimed by renaming it away and then
//   verifying the moved bytes are the same stale body that was observed —
//   otherwise the rename could have stolen a fresh lock created in between.
//   A failed verification restores the file with `link`, which fails closed
//   when another holder has already re-created the path.
//
// This module is node-side (it imports node:fs/node:os) and is exported from the
// `./node` subpath, never from `./core`.

import { randomUUID } from "node:crypto"
import { link, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
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
// A lockfile is created with open(O_EXCL) and then written, so for a moment it
// is empty. A reader that sees that body must not call the lock corrupt.
const UNPARSEABLE_GRACE_MS = 5_000

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
    // An unparseable lockfile is treated as stale so it cannot wedge builds,
    // but only once it is older than the publish window: a fresh empty or
    // partial body is a holder still writing it, and stealing it would give two
    // processes the lock.
    if (!parsed) return !(realClock && mtimeMs !== undefined && now() - mtimeMs < UNPARSEABLE_GRACE_MS)
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
    // One descriptor keeps the body and mtime on the same inode. A path stat
    // and a path read can observe two different files if the lock is replaced
    // between them.
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(lockPath, "r")
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined
      throw new Error(`AX Wiki build lock is unreadable: ${lockPath}`, { cause: error })
    }
    try {
      const info = await handle.stat()
      const text = await handle.readFile("utf8")
      return { text, mtimeMs: info.mtimeMs }
    } catch (error) {
      if (errorCode(error) === "ENOENT") return undefined
      // Permission or I/O errors must surface: reporting them as a held lock
      // would mislead every waiter into a spurious timeout.
      throw new Error(`AX Wiki build lock is unreadable: ${lockPath}`, { cause: error })
    } finally {
      // A failed close on this read-only descriptor must not replace the
      // observation (or the wrapped error) with a bare close failure: an
      // exception in a finally block discards the try block's result.
      await handle.close().catch(() => {})
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
        await rm(stalePath, { force: true }).catch(() => {})
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          // The path is held again — our copy is a redundant duplicate.
          await rm(stalePath, { force: true }).catch(() => {})
        }
        // Any other failure (EMFILE, ENOSPC, EACCES, ...) must not destroy the
        // copy: the moved body may be a LIVE holder's lock. The orphan
        // `<lock>.stale-<uuid>` file is never read, so keeping it on disk is
        // recoverable, while deleting it would silently remove their lock.
      }
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
          // Only touch the lockfile while it still carries our token. If the
          // lock was stolen after we went stale, a bare touch would keep
          // refreshing the NEW holder's mtime and make a wedged successor's
          // lock immortal, so the interval clears itself once the token is
          // gone. ENOENT is tolerated for a few ticks: a steal or a successor
          // release momentarily displaces the path before restoring it, and
          // stopping on the first gap would silence a live holder's heartbeat
          // for good. A read failure other than ENOENT just skips this tick.
          let missingTicks = 0
          const heartbeat = setInterval(() => {
            void (async () => {
              // One descriptor pins the inode for the whole check-and-touch:
              // a steal that renames the lock away between the read and the
              // utimes cannot make us refresh a successor's mtime — the fd
              // still points at the moved (or deleted) body, never the new file.
              let handle: Awaited<ReturnType<typeof open>> | undefined
              try {
                handle = await open(lockPath, "r")
                missingTicks = 0
                const text = await handle.readFile("utf8")
                if (parseBody(text)?.token !== token) {
                  clearInterval(heartbeat)
                  return
                }
                const stamp = new Date()
                await handle.utimes(stamp, stamp).catch(() => {})
              } catch (error) {
                if (errorCode(error) === "ENOENT" && ++missingTicks >= 3) clearInterval(heartbeat)
              } finally {
                await handle?.close().catch(() => {})
              }
            })()
          }, heartbeatMs)
          heartbeat.unref?.()
          return {
            async release() {
              if (released) return
              released = true
              clearInterval(heartbeat)
              // Ownership is verified on the moved body, not on the path. A
              // read-then-rm races with a waiter stealing the lock in between:
              // the rm could land on a successor's freshly created lockfile.
              // Renaming first means we only ever delete the exact inode whose
              // token we verified; a foreign body is linked back into place.
              const releasePath = `${lockPath}.release-${randomUUID()}`
              try {
                await rename(lockPath, releasePath)
              } catch (error) {
                // Only ENOENT means "already gone". Any other failure (EMFILE,
                // EACCES, ...) must surface: treating it as "not ours" would
                // leave a live-pid lock behind until the staleness budget expires.
                if (errorCode(error) === "ENOENT") return
                throw new Error(`AX Wiki build lock release failed: ${lockPath}`, { cause: error })
              }
              let text: string | undefined
              let readError: unknown
              try {
                text = await readFile(releasePath, "utf8")
              } catch (error) {
                readError = error
              }
              if (text !== undefined && parseBody(text)?.token === token) {
                await rm(releasePath, { force: true })
                return
              }
              // Not ours (a successor's fresh lock) or unverifiable: put the
              // moved body back. `link` fails closed when another holder has
              // already re-created the path; any other failure strands the
              // displaced body at releasePath while the lock path sits empty —
              // surface that instead of returning a successful release.
              try {
                await link(releasePath, lockPath)
                await rm(releasePath, { force: true }).catch(() => {})
              } catch (error) {
                if (errorCode(error) === "EEXIST") {
                  await rm(releasePath, { force: true }).catch(() => {})
                } else {
                  throw new Error(`AX Wiki build lock release failed: ${lockPath}`, { cause: error })
                }
              }
              // A body we could not read (EISDIR, EACCES, ...) surfaces the same
              // way a direct read failure did before.
              if (readError !== undefined) {
                throw new Error(`AX Wiki build lock release failed: ${lockPath}`, { cause: readError })
              }
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
