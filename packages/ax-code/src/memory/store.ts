/**
 * Memory Store
 * Reads/writes .ax-code/memory.json
 */

import fs from "fs/promises"
import path from "path"
import type { ProjectMemory } from "./types"

function getMemoryPath(projectRoot: string): string {
  return path.join(projectRoot, ".ax-code", "memory.json")
}

/**
 * Save memory to disk
 */
export async function save(projectRoot: string, memory: ProjectMemory): Promise<string> {
  const memoryPath = getMemoryPath(projectRoot)
  await fs.mkdir(path.dirname(memoryPath), { recursive: true })
  await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2))
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
  let text: string
  try {
    text = await fs.readFile(memoryPath, "utf-8")
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null
    throw err
  }
  return JSON.parse(text) as ProjectMemory
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
    .then(() => true)
    .catch((err: NodeJS.ErrnoException) => {
      if (err?.code === "ENOENT") return false
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
