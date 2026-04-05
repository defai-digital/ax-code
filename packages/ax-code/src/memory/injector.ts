/**
 * Memory Injector
 * Injects cached project memory into system prompt
 */

import type { ProjectMemory } from "./types"
import * as store from "./store"
import { Log } from "../util/log"

const log = Log.create({ service: "memory.injector" })

/**
 * Build context string from memory sections
 */
export function buildContext(memory: ProjectMemory): string {
  const parts: string[] = []

  parts.push("<project-memory>")

  if (memory.sections.patterns?.content) {
    parts.push("## Tech Stack")
    parts.push(memory.sections.patterns.content)
    parts.push("")
  }

  if (memory.sections.config?.content) {
    parts.push("## Project Config")
    parts.push(memory.sections.config.content)
    parts.push("")
  }

  if (memory.sections.structure?.content) {
    parts.push("## Directory Structure")
    parts.push(memory.sections.structure.content)
    parts.push("")
  }

  if (memory.sections.readme?.content) {
    parts.push("## README Summary")
    parts.push(memory.sections.readme.content)
    parts.push("")
  }

  parts.push("</project-memory>")

  return parts.join("\n")
}

/**
 * Get memory context for injection into system prompt
 * Returns empty string if no memory cached
 */
export async function getContext(projectRoot: string): Promise<string> {
  // store.load only throws on corrupt JSON (ENOENT returns null). Log and
  // fall back to empty context so a corrupt memory file does not break
  // prompt construction — but the corrupt file is preserved on disk for
  // manual recovery rather than being silently overwritten.
  const memory = await store.load(projectRoot).catch((err) => {
    log.error("failed to load memory", { projectRoot, err })
    return null
  })
  if (!memory) return ""
  return buildContext(memory)
}

/**
 * Get memory metadata (for display, not injection)
 */
export async function getMetadata(projectRoot: string): Promise<{
  exists: boolean
  totalTokens: number
  lastUpdated: string
  contentHash: string
  sections: string[]
} | null> {
  const memory = await store.load(projectRoot).catch((err) => {
    log.error("failed to load memory metadata", { projectRoot, err })
    return null
  })
  if (!memory) return null

  return {
    exists: true,
    totalTokens: memory.totalTokens,
    lastUpdated: memory.updated,
    contentHash: memory.contentHash,
    sections: Object.keys(memory.sections).filter((k) => {
      const section = memory.sections[k as keyof typeof memory.sections]
      return section && section.tokens > 0
    }),
  }
}
