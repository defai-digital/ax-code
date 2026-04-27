/**
 * Memory Injector
 * Injects cached project memory into system prompt
 */

import type { EntrySection, MemoryEntry, ProjectMemory } from "./types"
import * as store from "./store"
import { Log } from "../util/log"

const log = Log.create({ service: "memory.injector" })

function renderEntry(entry: MemoryEntry): string {
  const parts = [`- ${entry.name}: ${entry.body}`]
  if (entry.why) parts.push(`  - Why: ${entry.why}`)
  if (entry.howToApply) parts.push(`  - Apply: ${entry.howToApply}`)
  return parts.join("\n")
}

function entryApplies(entry: MemoryEntry, agent?: string): boolean {
  if (!entry.agents || entry.agents.length === 0) return true
  if (!agent) return true
  return entry.agents.includes(agent)
}

function pushEntries(parts: string[], title: string, section: EntrySection | undefined, agent?: string) {
  if (!section || section.entries.length === 0) return
  const applicable = section.entries.filter((e) => entryApplies(e, agent))
  if (applicable.length === 0) return
  parts.push(`## ${title}`)
  for (const entry of applicable) parts.push(renderEntry(entry))
  parts.push("")
}

export interface BuildContextOptions {
  /** When set, entries with an `agents` allow-list are filtered to those that include this name. */
  agent?: string
}

/**
 * Build context string from memory sections.
 *
 * Order is by actionability: feedback rules and user preferences come first
 * (they shape behavior), then project decisions, then scanned context.
 *
 * When `opts.agent` is supplied, recorded entries with an `agents` allow-list
 * are filtered. Scanned sections (structure/readme/config/patterns) are
 * shared across all agents and are not filtered.
 */
export function buildContext(memory: ProjectMemory, opts: BuildContextOptions = {}): string {
  const parts: string[] = []
  const agent = opts.agent

  parts.push("<project-memory>")

  pushEntries(parts, "Feedback Rules", memory.sections.feedback, agent)
  pushEntries(parts, "User Preferences", memory.sections.userPrefs, agent)
  pushEntries(parts, "Project Decisions", memory.sections.decisions, agent)

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
export async function getContext(projectRoot: string, opts: BuildContextOptions = {}): Promise<string> {
  // store.load only throws on corrupt JSON (ENOENT returns null). Log and
  // fall back to empty context so a corrupt memory file does not break
  // prompt construction — but the corrupt file is preserved on disk for
  // manual recovery rather than being silently overwritten.
  const memory = await store.load(projectRoot).catch((err) => {
    log.error("failed to load memory", { projectRoot, err })
    return null
  })
  if (!memory) return ""
  return buildContext(memory, opts)
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
