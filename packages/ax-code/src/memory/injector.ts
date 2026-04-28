/**
 * Memory Injector
 * Injects project and global memory into system prompt
 */

import type { EntrySection, MemoryEntry, MemorySection, ProjectMemory } from "./types"
import * as store from "./store"
import { entryApplies } from "./applicability"
import { Log } from "../util/log"

const log = Log.create({ service: "memory.injector" })

// Escape <project-memory> tags in user-controlled text to prevent prompt injection.
const PROJECT_MEMORY_TAG = /<\/?project-memory>/gi

function escapeMemoryTags(text: string): string {
  return text.replace(PROJECT_MEMORY_TAG, (match) =>
    match.startsWith("</") ? "[/project-memory]" : "[project-memory]",
  )
}

function renderEntry(entry: MemoryEntry): string {
  const parts = [`- ${escapeMemoryTags(entry.name)}: ${escapeMemoryTags(entry.body)}`]
  if (entry.why) parts.push(`  - Why: ${escapeMemoryTags(entry.why)}`)
  if (entry.howToApply) parts.push(`  - Apply: ${escapeMemoryTags(entry.howToApply)}`)
  if (entry.tags?.length) parts.push(`  - Tags: ${entry.tags.map(escapeMemoryTags).join(", ")}`)
  if (entry.pathGlobs?.length) parts.push(`  - Paths: ${entry.pathGlobs.map(escapeMemoryTags).join(", ")}`)
  if (entry.confidence !== undefined) parts.push(`  - Confidence: ${entry.confidence}`)
  return parts.join("\n")
}

function confidence(entry: MemoryEntry): number {
  return entry.confidence ?? 1
}

function orderEntriesForPrompt(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    const confidenceDelta = confidence(b) - confidence(a)
    if (confidenceDelta !== 0) return confidenceDelta
    return b.savedAt.localeCompare(a.savedAt)
  })
}

function pushEntries(
  parts: string[],
  title: string,
  section: EntrySection | undefined,
  opts: { agent?: string; paths?: string[]; projectRoot: string },
) {
  if (!section || section.entries.length === 0) return
  const applicable = orderEntriesForPrompt(section.entries.filter((e) => entryApplies(e, opts)))
  if (applicable.length === 0) return
  parts.push(`## ${title}`)
  for (const entry of applicable) parts.push(renderEntry(entry))
  parts.push("")
}

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function stalenessNotice(sections: ProjectMemory["sections"]): string | undefined {
  const scanned: MemorySection[] = [sections.patterns, sections.config, sections.structure, sections.readme].filter(
    (s): s is MemorySection => !!s?.scannedAt,
  )

  if (scanned.length === 0) return undefined
  const oldest = scanned.reduce((a, b) => (a.scannedAt! < b.scannedAt! ? a : b))
  const age = Date.now() - new Date(oldest.scannedAt!).getTime()
  if (age < STALE_THRESHOLD_MS) return undefined
  return `> Note: project scan is over 30 days old. Run \`ax-code memory warmup\` to refresh.`
}

export interface BuildContextOptions {
  /** When set, entries with an `agents` allow-list are filtered to those that include this name. */
  agent?: string
  /** When provided, entries with pathGlobs only apply if at least one path matches. */
  paths?: string[]
  /** Pre-loaded global memory to merge into context. When absent, no global section is emitted. */
  global?: ProjectMemory | null
}

/**
 * Build context string from project + optional global memory.
 *
 * Injection order (highest actionability first):
 *   1. Global Settings (cross-project feedback + user prefs)
 *   2. Feedback Rules (project)
 *   3. User Preferences (project)
 *   4. Project Decisions
 *   5. References
 *   6. Scanned: Tech Stack → Config → Directory Structure → README
 *   7. Staleness notice (if scanned sections are >30 days old)
 */
export function buildContext(memory: ProjectMemory, opts: BuildContextOptions = {}): string {
  const parts: string[] = []
  const agent = opts.agent
  const paths = opts.paths

  // Global entries appear first — they apply everywhere and set the baseline.
  // Rendered flat under a single "## Global Settings" heading to avoid
  // duplicate ## headings colliding with project-level section headers.
  const global = opts.global
  if (global) {
    const globalEntries: string[] = []
    for (const kind of ["feedback", "userPrefs", "reference"] as const) {
      const section = global.sections[kind]
      if (!section) continue
      for (const entry of orderEntriesForPrompt(section.entries)) {
        if (entryApplies(entry, { agent, paths, projectRoot: memory.projectRoot }))
          globalEntries.push(renderEntry(entry))
      }
    }
    if (globalEntries.length > 0) {
      parts.push("## Global Settings")
      parts.push(...globalEntries)
      parts.push("")
    }
  }

  // Project-scoped curated entries.
  const entryOpts = { agent, paths, projectRoot: memory.projectRoot }
  pushEntries(parts, "Feedback Rules", memory.sections.feedback, entryOpts)
  pushEntries(parts, "User Preferences", memory.sections.userPrefs, entryOpts)
  pushEntries(parts, "Project Decisions", memory.sections.decisions, entryOpts)
  pushEntries(parts, "References", memory.sections.reference, entryOpts)

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

  const notice = stalenessNotice(memory.sections)
  if (notice) {
    parts.push(notice)
    parts.push("")
  }

  // Only emit the wrapper if there is real content between the tags.
  if (parts.length === 0) return ""

  return ["<project-memory>", ...parts, "</project-memory>"].join("\n")
}

/**
 * Get memory context for injection into system prompt.
 * Loads project memory and (if present) global memory, then merges them.
 * Returns empty string if no memory is cached anywhere.
 */
export async function getContext(projectRoot: string, opts: Omit<BuildContextOptions, "global"> = {}): Promise<string> {
  const [memory, global] = await Promise.all([
    store.load(projectRoot).catch((err) => {
      log.error("failed to load project memory", { projectRoot, err })
      return null
    }),
    store.loadGlobal().catch((err) => {
      log.error("failed to load global memory", { err })
      return null
    }),
  ])

  if (!memory && !global) return ""
  if (!memory && global) {
    // Only global memory — synthesize a minimal project memory wrapper.
    const shell: ProjectMemory = {
      version: global.version,
      created: global.created,
      updated: global.updated,
      projectRoot,
      contentHash: "",
      maxTokens: 0,
      sections: {},
      totalTokens: 0,
    }
    return buildContext(shell, { ...opts, global })
  }
  return buildContext(memory!, { ...opts, global })
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
  stale: boolean
} | null> {
  const memory = await store.load(projectRoot).catch((err) => {
    log.error("failed to load memory metadata", { projectRoot, err })
    return null
  })
  if (!memory) return null

  const notice = stalenessNotice(memory.sections)
  return {
    exists: true,
    totalTokens: memory.totalTokens,
    lastUpdated: memory.updated,
    contentHash: memory.contentHash,
    sections: Object.keys(memory.sections).filter((k) => {
      const section = memory.sections[k as keyof typeof memory.sections]
      return section && section.tokens > 0
    }),
    stale: !!notice,
  }
}
