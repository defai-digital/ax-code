import fs from "fs/promises"
import path from "path"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { retainedSnapshotHashes } from "./retention"
import { ProjectID } from "../project/schema"
import { git } from "../util/git"

/**
 * Offline inspection and pruning of the per-project snapshot stores under
 * `<data>/snapshot/<projectID>`. Nothing here touches a live Git process: it
 * reads the store layout directly so it also works for projects that are not
 * open, which the in-process hourly cleanup never reaches.
 */
export namespace SnapshotStores {
  /** Matches the retention window used by Snapshot cleanup. */
  export const retentionMs = 7 * 24 * 60 * 60 * 1000
  /** A store with a missing worktree is only orphaned once it has been quiet this long (renames, remounts). */
  export const orphanGraceMs = 24 * 60 * 60 * 1000

  export type State =
    /** Sessions still point at a snapshot in this store; never removed. */
    | "referenced"
    /** The registry could not be read; treated as referenced. */
    | "unknown"
    /** The worktree no longer exists and nothing references the store. */
    | "orphaned"
    /** The worktree exists but nothing references the store and it has been idle. */
    | "idle"
    | "active"

  export type Store = {
    id: string
    dir: string
    worktree?: string
    worktreeExists: boolean
    bytes: number
    garbageBytes: number
    refs: number
    lastActivity: number
    state: State
  }

  export function root() {
    return path.join(Filesystem.resolve(Global.Path.data), "snapshot")
  }

  // Git root commit, `dir-<sha1>` for non-Git directories, and the global project.
  const idPattern = /^(?:[0-9a-f]{40}|dir-[0-9a-f]{40}|global)$/

  async function size(dir: string, onFile?: (file: string, bytes: number) => void): Promise<number> {
    let total = 0
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        total += await size(file, onFile)
        continue
      }
      const stat = await fs.lstat(file).catch(() => undefined)
      if (!stat) continue
      total += stat.size
      onFile?.(file, stat.size)
    }
    return total
  }

  async function mtime(file: string) {
    return (await fs.stat(file).catch(() => undefined))?.mtimeMs ?? 0
  }

  async function worktreeOf(dir: string) {
    // Let Git decode quoting and select the correct section without following includes.
    const config = await git(
      ["config", "--no-includes", "--file", path.join(dir, "config"), "--get", "core.worktree"],
      {
        cwd: dir,
        timeout: 5000,
      },
    )
    if (config.exitCode !== 0) return undefined
    const value = config.text().replace(/\r?\n$/, "")
    return value ? path.resolve(dir, value) : undefined
  }

  async function refCount(dir: string) {
    const loose = await fs.readdir(path.join(dir, "refs", "snapshots")).catch(() => [])
    const packed = await fs.readFile(path.join(dir, "packed-refs"), "utf8").catch(() => "")
    const packedRefs = packed.split("\n").filter((line) => line.includes("refs/snapshots/")).length
    return loose.length + packedRefs
  }

  export function classify(
    store: Pick<Store, "worktreeExists" | "lastActivity">,
    retained: boolean | undefined,
    input: { now: number; idleMs: number },
  ): State {
    if (retained === undefined) return "unknown"
    if (retained) return "referenced"
    if (!Number.isFinite(store.lastActivity) || store.lastActivity <= 0) return "unknown"
    if (!store.worktreeExists) return input.now - store.lastActivity >= orphanGraceMs ? "orphaned" : "active"
    if (input.now - store.lastActivity >= input.idleMs) return "idle"
    return "active"
  }

  function readRetained(projectID: string): Set<string> | undefined {
    try {
      return retainedSnapshotHashes(ProjectID.make(projectID))
    } catch {
      return undefined
    }
  }

  async function activity(dir: string) {
    return Math.max(
      ...(await Promise.all([
        mtime(path.join(dir, "index")),
        mtime(path.join(dir, "packed-refs")),
        mtime(path.join(dir, "refs", "snapshots")),
        mtime(path.join(dir, "ax-code", "snapshots")),
      ])),
    )
  }

  export async function inspect(input?: {
    root?: string
    now?: number
    idleMs?: number
    /** Snapshot hashes still referenced by sessions; `undefined` when unreadable. */
    retained?: (projectID: string) => Set<string> | undefined
  }): Promise<Store[]> {
    const base = input?.root ?? root()
    const now = input?.now ?? Date.now()
    const idleMs = input?.idleMs ?? retentionMs
    const retained = input?.retained ?? readRetained
    const names = (await fs.readdir(base, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory() && idPattern.test(entry.name))
      .map((entry) => entry.name)
    const stores: Store[] = []
    // Bounded concurrency: a data directory can hold ten thousand stores.
    for (let offset = 0; offset < names.length; offset += 16) {
      const batch = await Promise.all(
        names.slice(offset, offset + 16).map(async (id): Promise<Store | undefined> => {
          const dir = path.join(base, id)
          // Anything without HEAD is not a Git store; leave it alone.
          if (!(await Filesystem.exists(path.join(dir, "HEAD")))) return
          let garbageBytes = 0
          const bytes = await size(dir, (file, n) => {
            if (path.basename(file).startsWith("tmp_") && path.basename(path.dirname(file)) === "pack") {
              garbageBytes += n
            }
          })
          const worktree = await worktreeOf(dir)
          const worktreeExists = worktree ? await Filesystem.isDir(worktree) : false
          const lastActivity = await activity(dir)
          const hashes = retained(id)
          return {
            id,
            dir,
            worktree,
            worktreeExists,
            bytes,
            garbageBytes,
            refs: await refCount(dir),
            lastActivity,
            state: classify(
              { worktreeExists, lastActivity },
              hashes === undefined || !worktree ? undefined : hashes.size > 0,
              {
                now,
                idleMs,
              },
            ),
          }
        }),
      )
      for (const store of batch) if (store) stores.push(store)
    }
    return stores.sort((a, b) => b.bytes - a.bytes)
  }

  export type PruneInput = {
    stores: Store[]
    /** Remove whole stores whose worktree is gone and that nothing references. */
    orphaned: boolean
    /** Also remove unreferenced stores idle for the retention window. */
    idle: boolean
    dryRun: boolean
    now?: number
    /** Re-read retained hashes at deletion time; unreadable retention prevents removal. */
    retained?: (projectID: string) => Set<string> | undefined
  }

  export type PruneResult = {
    /** Stale `objects/pack/tmp_*` files removed from stores that were kept. */
    garbageFiles: number
    garbageBytes: number
    removed: Store[]
    freedBytes: number
  }

  /** Whole-store removal is limited to direct children that look like snapshot stores. */
  async function removable(base: string, store: Store) {
    if (path.dirname(store.dir) !== base || store.id !== path.basename(store.dir) || !idPattern.test(store.id))
      return false
    const stat = await fs.lstat(store.dir).catch(() => undefined)
    return Boolean(stat?.isDirectory() && !stat.isSymbolicLink())
  }

  export async function prune(input: PruneInput & { root?: string }): Promise<PruneResult> {
    const base = input.root ?? root()
    const now = input.now ?? Date.now()
    const result: PruneResult = { garbageFiles: 0, garbageBytes: 0, removed: [], freedBytes: 0 }
    for (const store of input.stores) {
      // Apply the store boundary to both whole-store and temporary-file removal.
      if (!(await removable(base, store))) continue
      const doomed = (store.state === "orphaned" && input.orphaned) || (store.state === "idle" && input.idle)
      if (doomed) {
        // Inspection may predate new sessions, snapshot writes or a remount.
        const hashes = (input.retained ?? readRetained)(store.id)
        const worktree = await worktreeOf(store.dir)
        const current = classify(
          {
            worktreeExists: worktree ? await Filesystem.isDir(worktree) : false,
            lastActivity: await activity(store.dir),
          },
          hashes === undefined || !worktree ? undefined : hashes.size > 0,
          { now, idleMs: retentionMs },
        )
        if (!((current === "orphaned" && input.orphaned) || (current === "idle" && input.idle))) continue
        if (!input.dryRun) await fs.rm(store.dir, { recursive: true, force: true })
        result.removed.push(store)
        result.freedBytes += store.bytes
        continue
      }
      if (!store.garbageBytes) continue
      // Same rule as `git prune --expire=7.days`: a recent temporary may belong
      // to a Git process that is still writing it.
      const objects = path.join(store.dir, "objects")
      const pack = path.join(objects, "pack")
      // A symlinked ancestor would make file removal escape the snapshot store.
      const parents = await Promise.all([objects, pack].map((dir) => fs.lstat(dir).catch(() => undefined)))
      if (parents.some((stat) => !stat?.isDirectory() || stat.isSymbolicLink())) continue
      for (const name of await fs.readdir(pack).catch(() => [])) {
        if (!name.startsWith("tmp_")) continue
        const file = path.join(pack, name)
        const stat = await fs.lstat(file).catch(() => undefined)
        if (!stat?.isFile() || now - stat.mtimeMs < retentionMs) continue
        if (!input.dryRun) await fs.rm(file, { force: true })
        result.garbageFiles++
        result.garbageBytes += stat.size
        result.freedBytes += stat.size
      }
    }
    return result
  }
}
