/**
 * Memory Store
 * Reads/writes .ax-code/memory.json
 */

import fs from "fs/promises"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"
import type { ProjectMemory } from "./types"

function getMemoryPath(projectRoot: string): string {
  return path.join(projectRoot, ".ax-code", "memory.json")
}

function getGlobalMemoryPath(): string {
  return path.join(os.homedir(), ".ax-code", "memory.json")
}

// In-process mtime/size-keyed read cache. The injector calls `load` on every
// prompt-loop step (intentionally — to keep mid-session `ax-code memory remember`
// visible). With the cache, we skip the file read when the file hasn't changed
// since the last load. JSON.parse runs fresh on every retrieval so callers that
// mutate the returned object (e.g. recordEntry) never observe each other's writes.
type CacheEntry = { mtimeMs: number; size: number; text: string }
const readCache = new Map<string, CacheEntry>()
// Cap matches the typical project-switch working set on a multi-project
// server / desktop — well above what a single user touches in one session,
// low enough that stale entries from week-old projects don't accumulate.
// Insertion-order LRU: every `set` re-inserts to MRU, the oldest key is
// dropped when over cap.
const READ_CACHE_MAX_ENTRIES = 32
// Coalesces concurrent cache-miss reads for the same path so two callers that
// both pass the cache-miss check don't issue duplicate fs.readFile calls and
// race to populate the cache (BUG-108). Entries live only for the duration of
// the in-flight read; the cache itself remains the long-lived store.
const inFlightReads = new Map<string, Promise<string | null>>()

function cacheSet(filePath: string, entry: CacheEntry) {
  // Promote to MRU on every set. Map iteration order is insertion order,
  // so deleting first guarantees the just-set entry sits at the tail.
  readCache.delete(filePath)
  readCache.set(filePath, entry)
  while (readCache.size > READ_CACHE_MAX_ENTRIES) {
    const oldest = readCache.keys().next().value
    if (oldest === undefined) break
    readCache.delete(oldest)
  }
}

/** Test-only: drop cached entries. */
export function _resetReadCache(): void {
  readCache.clear()
  inFlightReads.clear()
}

async function readFresh(filePath: string): Promise<string | null> {
  // Stat → read → verify-stat: cache only when the mtime/size before and
  // after the read agree, otherwise the file changed under us between the
  // two syscalls and the cached `text` would not match the cached
  // `mtimeMs/size`, leaving subsequent `readWithCache` callers serving stale
  // text indefinitely (until the file is mutated again to invalidate the
  // mismatched key). This is the TOCTOU window that BUG-memstore-toctou
  // documented. We still return `text` to the current caller — they got a
  // legitimate snapshot — but we skip caching it.
  const initialStat = await fs.stat(filePath).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") return null
    throw err
  })
  if (!initialStat) {
    readCache.delete(filePath)
    return null
  }
  let text: string
  try {
    text = await fs.readFile(filePath, "utf-8")
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      readCache.delete(filePath)
      return null
    }
    throw err
  }
  const finalStat = await fs.stat(filePath).catch((err: NodeJS.ErrnoException) => {
    if (err?.code === "ENOENT") return null
    throw err
  })
  if (finalStat && finalStat.mtimeMs === initialStat.mtimeMs && finalStat.size === initialStat.size) {
    cacheSet(filePath, { mtimeMs: finalStat.mtimeMs, size: finalStat.size, text })
  } else {
    readCache.delete(filePath)
  }
  return text
}

async function readWithCache(filePath: string): Promise<string | null> {
  let stat: Awaited<ReturnType<typeof fs.stat>>
  try {
    stat = await fs.stat(filePath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      readCache.delete(filePath)
      return null
    }
    throw err
  }
  const cached = readCache.get(filePath)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.text
  }
  const pending = inFlightReads.get(filePath)
  if (pending) return pending
  const promise = readFresh(filePath).finally(() => {
    inFlightReads.delete(filePath)
  })
  inFlightReads.set(filePath, promise)
  return promise
}

/**
 * Save memory to disk.
 *
 * Uses `Filesystem.write` (atomic tmp + rename) so a process crash mid-write
 * never leaves `memory.json` in a half-written state. Direct `fs.writeFile`
 * truncates the target before writing the new bytes, which can corrupt the
 * file on SIGKILL/OOM/power-loss and cause the next `load()` to throw on
 * malformed JSON, silently discarding accumulated memory entries (BUG-101).
 */
export async function save(projectRoot: string, memory: ProjectMemory): Promise<string> {
  const memoryPath = getMemoryPath(projectRoot)
  await Filesystem.write(memoryPath, JSON.stringify(memory, null, 2))
  // Drop the cached entry; the next load() will re-stat and pick up the new mtime.
  readCache.delete(memoryPath)
  return memoryPath
}

/**
 * Load memory from disk.
 *
 * Returns `null` only when the file does not exist. Corrupt JSON (partial
 * write, disk error, truncation) throws so callers cannot accidentally
 * overwrite recoverable state with empty data. The previous implementation
 * collapsed both cases to `null`, which meant any corruption silently
 * discarded the user's project memory on the next save.
 */
export async function load(projectRoot: string): Promise<ProjectMemory | null> {
  const memoryPath = getMemoryPath(projectRoot)
  const text = await readWithCache(memoryPath)
  if (text === null) return null
  try {
    return JSON.parse(text) as ProjectMemory
  } catch (err) {
    throw new Error(`memory store: corrupt JSON in ${memoryPath}`, { cause: err })
  }
}

/**
 * Delete memory from disk. Returns true if the file was deleted,
 * false if it never existed. Other errors (EACCES, EBUSY, EIO, etc.)
 * propagate — a caller that proceeds as if clear() succeeded when it
 * didn't would leak stale memory into a fresh session. See BUG-73.
 */
export async function clear(projectRoot: string): Promise<boolean> {
  const memoryPath = getMemoryPath(projectRoot)
  return fs
    .unlink(memoryPath)
    .then(() => {
      readCache.delete(memoryPath)
      return true
    })
    .catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") {
        readCache.delete(memoryPath)
        return false
      }
      throw err
    })
}

/**
 * Check if memory exists
 */
export async function exists(projectRoot: string): Promise<boolean> {
  const memoryPath = getMemoryPath(projectRoot)
  try {
    await fs.access(memoryPath)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Global memory (~/.ax-code/memory.json)
// Cross-project user preferences and feedback that apply to every session.
// ---------------------------------------------------------------------------

export async function saveGlobal(memory: ProjectMemory): Promise<string> {
  const memoryPath = getGlobalMemoryPath()
  // Atomic write — see save() above for rationale (BUG-101).
  await Filesystem.write(memoryPath, JSON.stringify(memory, null, 2))
  readCache.delete(memoryPath)
  return memoryPath
}

export async function loadGlobal(): Promise<ProjectMemory | null> {
  const memoryPath = getGlobalMemoryPath()
  const text = await readWithCache(memoryPath)
  if (text === null) return null
  try {
    return JSON.parse(text) as ProjectMemory
  } catch (err) {
    throw new Error(`memory store: corrupt JSON in ${memoryPath}`, { cause: err })
  }
}

export async function clearGlobal(): Promise<boolean> {
  const memoryPath = getGlobalMemoryPath()
  return fs
    .unlink(memoryPath)
    .then(() => {
      readCache.delete(memoryPath)
      return true
    })
    .catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") {
        readCache.delete(memoryPath)
        return false
      }
      throw err
    })
}

export async function existsGlobal(): Promise<boolean> {
  const memoryPath = getGlobalMemoryPath()
  try {
    await fs.access(memoryPath)
    return true
  } catch {
    return false
  }
}
