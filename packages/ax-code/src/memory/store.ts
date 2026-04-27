/**
 * Memory Store
 * Reads/writes .ax-code/memory.json
 */

import fs from "fs/promises"
import path from "path"
import os from "os"
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

/** Test-only: drop cached entries. */
export function _resetReadCache(): void {
  readCache.clear()
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
  readCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, text })
  return text
}

/**
 * Save memory to disk
 */
export async function save(projectRoot: string, memory: ProjectMemory): Promise<string> {
  const memoryPath = getMemoryPath(projectRoot)
  await fs.mkdir(path.dirname(memoryPath), { recursive: true })
  await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2))
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
  await fs.mkdir(path.dirname(memoryPath), { recursive: true })
  await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2))
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
