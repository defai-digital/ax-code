/**
 * Memory Injector
 * Injects project and global memory into system prompt
 */

import type { EntrySection, MemoryEntry, MemorySection, ProjectMemory } from "./types"
import * as store from "./store"
import { entryApplies } from "./applicability"
import { Log } from "../util/log"
import path from "node:path"
import { realpath } from "node:fs/promises"

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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Share of the model context window that injected memory may occupy. */
const CONTEXT_BUDGET_SHARE = 0.1
/** Memory is never squeezed below this, however small the window reports. */
const MIN_BUDGET_TOKENS = 2000
/** Largest share of the budget that global entries may use before project entries. */
const GLOBAL_BUDGET_SHARE = 0.5
/** A truncated scanned section smaller than this is dropped instead of shown. */
const MIN_TRUNCATED_SECTION_TOKENS = 200

/**
 * Token budget for injected memory on a model with the given context window.
 * Returns undefined (unbounded) when the window is unknown so callers keep the
 * historical behavior rather than guessing.
 */
export function budgetForContext(contextWindow: number | undefined): number | undefined {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined
  return Math.max(MIN_BUDGET_TOKENS, Math.floor(contextWindow * CONTEXT_BUDGET_SHARE))
}

/** Tracks the remaining token budget and how many entries were left out. */
class Budget {
  omitted = 0
  private remaining: number
  constructor(limit: number | undefined) {
    this.remaining = limit ?? Number.POSITIVE_INFINITY
  }
  /**
   * Run `fill` against at most `share` of what is left, so one scope cannot
   * starve the next. Whatever it does not spend stays in this budget.
   */
  capped<T>(share: number, fill: (child: Budget) => T): T {
    // An unbounded parent cannot be split. Computing Infinity - Infinity here
    // leaves `remaining` NaN, and then every later takeLines() takes the
    // truncation path (NaN comparisons are always false), keeping all lines but
    // reporting a false "items were omitted" note. Keep the child unbounded and
    // skip the debit instead.
    const bounded = Number.isFinite(this.remaining)
    const child = new Budget(bounded ? Math.floor(this.remaining * share) : undefined)
    const before = child.remaining
    const result = fill(child)
    if (bounded) this.remaining -= before - child.remaining
    this.omitted += child.omitted
    return result
  }
  /** Reserve room for `text`; false (and a recorded omission) when it does not fit. */
  take(text: string): boolean {
    const cost = estimateTokens(text)
    if (cost > this.remaining) {
      this.omitted++
      return false
    }
    this.remaining -= cost
    return true
  }
  /** Take as many whole lines of a scanned section as fit. */
  takeLines(text: string): string | undefined {
    if (estimateTokens(text) <= this.remaining) {
      this.remaining -= estimateTokens(text)
      return text
    }
    if (this.remaining < MIN_TRUNCATED_SECTION_TOKENS) {
      this.omitted++
      return undefined
    }
    const kept: string[] = []
    let used = 0
    for (const line of text.split("\n")) {
      const cost = estimateTokens(line) + 1
      if (used + cost > this.remaining) break
      kept.push(line)
      used += cost
    }
    if (kept.length === 0) {
      this.omitted++
      return undefined
    }
    this.remaining -= used
    this.omitted++
    return kept.join("\n")
  }
}

function pushEntries(
  parts: string[],
  title: string,
  section: EntrySection | undefined,
  opts: { agent?: string; paths?: string[]; projectRoot: string },
  budget: Budget,
) {
  if (!section || section.entries.length === 0) return
  const applicable = orderEntriesForPrompt(section.entries.filter((e) => entryApplies(e, opts)))
  const rendered = applicable.map(renderEntry).filter((text) => budget.take(text))
  if (rendered.length === 0) return
  parts.push(`## ${title}`)
  parts.push(...rendered)
  parts.push("")
}

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function stalenessNotice(sections: ProjectMemory["sections"]): string | undefined {
  const scanned: MemorySection[] = [sections.patterns, sections.config, sections.structure, sections.readme].filter(
    (s): s is MemorySection => !!s?.scannedAt,
  )

  if (scanned.length === 0) return undefined
  const times = scanned.map((section) => new Date(section.scannedAt!).getTime())
  if (times.some((time) => !Number.isFinite(time))) {
    return `> Note: project scan timestamp is invalid. Run \`ax-code memory warmup\` to refresh.`
  }
  const oldest = Math.min(...times)
  const age = Date.now() - oldest
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
  /**
   * Approximate token budget for the rendered context. Sections are filled in
   * injection order and whole entries are dropped (never cut mid-entry) once
   * the budget is spent, so the most actionable memory survives. Absent means
   * unbounded.
   */
  maxTokens?: number
}

/**
 * Build context string from project + optional global memory.
 *
 * With `maxTokens`, global entries use at most half the budget and unspent
 * budget carries on to project entries and scanned sections, in this order.
 *
 * Injection order (highest actionability first):
 *   1. Global Settings (cross-project feedback, prefs, decisions, references)
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
  const budget = new Budget(opts.maxTokens)

  // Global entries appear first — they apply everywhere and set the baseline.
  // Rendered flat under a single "## Global Settings" heading to avoid
  // duplicate ## headings colliding with project-level section headers.
  const global = opts.global
  if (global) {
    // Global memory takes at most half the budget so project rules still fit.
    const globalEntries = budget.capped(GLOBAL_BUDGET_SHARE, (scoped) => {
      const rendered: string[] = []
      for (const kind of ["feedback", "userPrefs", "decisions", "reference"] as const) {
        const section = global.sections[kind]
        if (!section) continue
        for (const entry of orderEntriesForPrompt(section.entries)) {
          if (entryApplies(entry, { agent, paths, projectRoot: memory.projectRoot })) {
            const text = renderEntry(entry)
            if (scoped.take(text)) rendered.push(text)
          }
        }
      }
      return rendered
    })
    if (globalEntries.length > 0) {
      parts.push("## Global Settings")
      parts.push(...globalEntries)
      parts.push("")
    }
  }

  // Project-scoped curated entries.
  const entryOpts = { agent, paths, projectRoot: memory.projectRoot }
  // getContext shares the object only when both scopes refer to one file.
  // Keep its global precedence, without repeating the same curated entries.
  // Equal content from distinct stores must retain its separate scope.
  if (global !== memory) {
    pushEntries(parts, "Feedback Rules", memory.sections.feedback, entryOpts, budget)
    pushEntries(parts, "User Preferences", memory.sections.userPrefs, entryOpts, budget)
    pushEntries(parts, "Project Decisions", memory.sections.decisions, entryOpts, budget)
    pushEntries(parts, "References", memory.sections.reference, entryOpts, budget)
  }

  const patternsContent = memory.sections.patterns?.content && budget.takeLines(memory.sections.patterns.content)
  if (patternsContent) {
    parts.push("## Tech Stack")
    parts.push(patternsContent)
    parts.push("")
  }

  const configContent = memory.sections.config?.content && budget.takeLines(memory.sections.config.content)
  if (configContent) {
    parts.push("## Project Config")
    parts.push(configContent)
    parts.push("")
  }

  const structureContent = memory.sections.structure?.content && budget.takeLines(memory.sections.structure.content)
  if (structureContent) {
    parts.push("## Directory Structure")
    parts.push(structureContent)
    parts.push("")
  }

  const readmeContent = memory.sections.readme?.content && budget.takeLines(memory.sections.readme.content)
  if (readmeContent) {
    parts.push("## README Summary")
    parts.push(readmeContent)
    parts.push("")
  }

  const notice = stalenessNotice(memory.sections)
  if (notice) {
    parts.push(notice)
    parts.push("")
  }

  if (budget.omitted > 0 && parts.length > 0) {
    parts.push(`> Note: ${budget.omitted} memory item(s) were omitted to fit this model's context budget.`)
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
  // Preserve the loader's fail-soft behavior for malformed runtime callers.
  const projectPath = typeof projectRoot === "string" ? store.getMemoryPath(projectRoot) : undefined
  const globalPath = store.getGlobalMemoryPath()
  const sharedSource =
    projectPath !== undefined &&
    // @scan-suppress security_scan - Compare store-derived memory paths for deduplication; loading and authorization remain in the store.
    (path.resolve(projectPath) === path.resolve(globalPath) ||
      (await Promise.all([
        realpath(projectPath).catch(() => undefined),
        realpath(globalPath).catch(() => undefined),
      ]).then(([project, global]) => project !== undefined && project === global)))
  const [memory, global] = await Promise.all([
    store.load(projectRoot).catch((err) => {
      log.error("failed to load project memory", { projectRoot, err })
      return null
    }),
    (sharedSource ? Promise.resolve(null) : store.loadGlobal()).catch((err) => {
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
  return buildContext(memory!, { ...opts, global: sharedSource ? memory : global })
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
