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
 * Load memory from disk
 */
export async function load(projectRoot: string): Promise<ProjectMemory | null> {
  const memoryPath = getMemoryPath(projectRoot)
  try {
    const text = await fs.readFile(memoryPath, "utf-8")
    return JSON.parse(text) as ProjectMemory
  } catch {
    return null
  }
}

/**
 * Delete memory from disk
 */
export async function clear(projectRoot: string): Promise<boolean> {
  const memoryPath = getMemoryPath(projectRoot)
  try {
    await fs.unlink(memoryPath)
    return true
  } catch {
    return false
  }
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
