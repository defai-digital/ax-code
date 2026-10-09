import fs from "fs/promises"
import path from "path"
import { Global } from "../global"
import { Flag } from "../flag/flag"
import { FileLock } from "../util/filelock"
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
// - The create/inspect/steal/release mechanics live in util/filelock.ts
//   (the BUG-12 extraction); this module supplies the project-scoped path,
//   the 8h staleness window, and the native flock fast path.
// - Contents are JSON: `{ pid: number, startedAt: number, host: string }`.
//   The host field catches NFS-mounted data dirs where PIDs from a
//   different machine would be meaningless; we refuse to steal across
//   hostnames.

// Stale-lock threshold. A lock older than this is assumed to belong to
// a crashed process. 8h is generous — the largest projects we've seen
// take ~15 minutes to index, so 8 hours is 32× safety margin.
const STALE_LOCK_MS = 8 * 60 * 60 * 1000

export namespace IndexLock {
  // FileLock appends ".lock" to the path it is given, so keep the base path
  // and the on-disk lock path as separate helpers to preserve the
  // `code-index-<id>.lock` filename contract.
  function lockBase(projectID: ProjectID): string {
    return path.join(Global.Path.data, "locks", `code-index-${projectID}`)
  }

  function lockPath(projectID: ProjectID): string {
    return lockBase(projectID) + ".lock"
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
    return FileLock.tryAcquire(lockBase(projectID), { staleMs: STALE_LOCK_MS })
  }

  // Blocking acquire with a deadline. Waits until the lock becomes free
  // or the timeout expires. onWait is invoked once the first time the
  // caller has to actually wait — lets the CLI print a message without
  // spamming on every poll.
  export async function acquire(
    projectID: ProjectID,
    opts: { timeoutMs: number; onWait?: () => void },
  ): Promise<Disposable> {
    return FileLock.acquire(lockBase(projectID), {
      timeoutMs: opts.timeoutMs,
      staleMs: STALE_LOCK_MS,
      onWait: opts.onWait,
    })
  }

  // Test helper: wipe any lockfile for the given project, regardless of
  // holder. Production code should never need this — tests use it to
  // reset between cases.
  export async function __reset(projectID: ProjectID): Promise<void> {
    await fs.unlink(lockPath(projectID)).catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") return
      throw err
    })
  }
}
