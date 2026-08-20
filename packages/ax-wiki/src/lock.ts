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

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
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

  const isStale = (text: string): boolean => {
    try {
      const parsed = JSON.parse(text) as Partial<LockBody>
      if (typeof parsed.startedAt !== "number") return true
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
          await rm(lockPath, { force: true })
          continue
        }
        if (now() >= deadline) {
          throw new Error(`AX Wiki build lock is held by another process (lockfile: ${lockPath})`)
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs))
      }
    },
  }
}
