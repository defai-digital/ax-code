// Advisory inter-process build lock for AX Wiki (gate C7).
//
// Node/filesystem implementation of the injected `WikiBuildLock` port. Two
// concurrent `buildAxWiki` runs on the same root otherwise race on rename/rm in
// the write phase. This lock follows the same host/PID/staleness contract used by
// the code-intelligence index lock: a lockfile carries {pid, startedAt, host}, is
// created exclusively, is stolen when stale, and is removed on release.
//
// This module is node-side (it imports node:fs/node:os) and is exported from the
// `./node` subpath, never from `./core`.

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { WikiBuildLock, WikiBuildLockHandle } from "./types.js"

const STALE_LOCK_MS = 8 * 60 * 60 * 1000
const ACQUIRE_TIMEOUT_MS = 30_000
const RETRY_INTERVAL_MS = 100

type LockBody = { pid: number; startedAt: number; host: string }

export type WikiBuildLockOptions = {
  acquireTimeoutMs?: number
  retryIntervalMs?: number
  staleMs?: number
  now?: () => number
}

export function createWikiBuildLock(root: string, wikiDir: string, options: WikiBuildLockOptions = {}): WikiBuildLock {
  const lockPath = path.join(root, wikiDir, ".build-lock")
  const acquireTimeoutMs = options.acquireTimeoutMs ?? ACQUIRE_TIMEOUT_MS
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS
  const staleMs = options.staleMs ?? STALE_LOCK_MS
  const now = options.now ?? Date.now
  const host = os.hostname()

  const renderBody = (): string => JSON.stringify({ pid: process.pid, startedAt: now(), host } satisfies LockBody)

  const pidAlive = (pid: number): boolean => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      // EPERM: the process exists but belongs to another user — still alive.
      return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM"
    }
  }

  const isStale = (text: string): boolean => {
    try {
      const parsed = JSON.parse(text) as Partial<LockBody>
      if (typeof parsed.startedAt !== "number") return true
      // A lock written by this host whose owner process is gone is stale
      // immediately: a crashed build must not wedge successors for staleMs.
      // Cross-host locks and reused PIDs fall back to the wall-clock check.
      if (parsed.host === host && typeof parsed.pid === "number" && !pidAlive(parsed.pid)) return true
      return now() - parsed.startedAt > staleMs
    } catch {
      // An unparseable lockfile is treated as stale so it cannot wedge builds.
      return true
    }
  }

  const tryCreate = async (): Promise<boolean> => {
    try {
      await mkdir(path.dirname(lockPath), { recursive: true })
      await writeFile(lockPath, renderBody(), { flag: "wx" })
      return true
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error
      return false
    }
  }

  // Atomically claim a stale lock by renaming it away. A bare `rm` here races:
  // two waiters can both read the stale lock, and the slower one's `rm` can
  // delete the faster one's freshly-created lock, letting two builds run at
  // once. `rename` makes the steal exclusive — only one waiter wins.
  const stealStaleLock = async (): Promise<boolean> => {
    const stalePath = `${lockPath}.stale-${randomUUID()}`
    try {
      await rename(lockPath, stalePath)
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "EEXIST")
      ) {
        return false
      }
      throw error
    }
    await rm(stalePath, { force: true }).catch(() => {})
    return true
  }

  return {
    async acquire(): Promise<WikiBuildLockHandle> {
      const deadline = now() + acquireTimeoutMs
      for (;;) {
        if (await tryCreate()) {
          return {
            async release() {
              await rm(lockPath, { force: true })
            },
          }
        }
        const existing = await readFile(lockPath, "utf8").catch(() => undefined)
        if (existing !== undefined && isStale(existing)) {
          if (await stealStaleLock()) continue
          // Another waiter stole it first; fall through and retry on the next loop.
        }
        if (now() >= deadline) {
          throw new Error(`AX Wiki build lock is held by another process (lockfile: ${lockPath})`)
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
      }
    },
  }
}
