/**
 * Memory Recall
 *
 * Search recorded entries (feedback / userPrefs / decisions / reference) by
 * free-text query, kind, applicable agent, and scope (project / global / all).
 *
 * Scoring uses weighted substring matching plus a recency bonus so recently
 * saved entries surface higher when relevance is otherwise equal.
 */

import * as store from "./store"
import type { MemoryEntry, MemoryEntryKind, ProjectMemory } from "./types"

export interface RecallQuery {
  /** Free-text search across name/body/why/howToApply (case-insensitive substring). */
  query?: string
  /** Restrict to one or more kinds. Defaults to all kinds. */
  kind?: MemoryEntryKind | MemoryEntryKind[]
  /**
   * Filter to entries applicable to this agent. Entries with no `agents`
   * allow-list match every agent.
   */
  agent?: string
  /** Cap on result count after sorting. */
  limit?: number
  /**
   * Which memory store(s) to search.
   * - "project" (default): only .ax-code/memory.json in projectRoot
   * - "global": only ~/.ax-code/memory.json
   * - "all": search both and merge results (project entries ranked first on ties)
   */
  scope?: "project" | "global" | "all"
}

export interface RecallResult {
  kind: MemoryEntryKind
  entry: MemoryEntry
  score: number
  /** Which store this result came from. */
  source: "project" | "global"
}

/** Order matches the actionability ordering used by buildContext. */
const ALL_KINDS: MemoryEntryKind[] = ["feedback", "userPrefs", "decisions", "reference"]

const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const RECENCY_BONUS = 2

export async function recall(projectRoot: string, query: RecallQuery = {}): Promise<RecallResult[]> {
  const scope = query.scope ?? "project"
  const results: RecallResult[] = []

  if (scope === "project" || scope === "all") {
    const memory = await store.load(projectRoot).catch(() => null)
    if (memory) results.push(...collectResults(memory.sections, query, "project"))
  }

  if (scope === "global" || scope === "all") {
    const global = await store.loadGlobal().catch(() => null)
    if (global) results.push(...collectResults(global.sections, query, "global"))
  }

  results.sort((a, b) => {
    const ka = ALL_KINDS.indexOf(a.kind)
    const kb = ALL_KINDS.indexOf(b.kind)
    if (ka !== kb) return ka - kb
    if (a.score !== b.score) return b.score - a.score
    // Project entries rank above global when score is tied
    if (a.source !== b.source) return a.source === "project" ? -1 : 1
    return b.entry.savedAt.localeCompare(a.entry.savedAt)
  })

  return query.limit && query.limit > 0 ? results.slice(0, query.limit) : results
}

function collectResults(
  sections: ProjectMemory["sections"],
  query: RecallQuery,
  source: "project" | "global",
): RecallResult[] {
  const wantedKinds = normalizeKinds(query.kind)
  const q = query.query?.toLowerCase().trim()
  const now = Date.now()
  const results: RecallResult[] = []

  for (const kind of wantedKinds) {
    const section = sections[kind]
    if (!section) continue
    for (const entry of section.entries) {
      if (!entryMatchesAgent(entry, query.agent)) continue
      const base = q ? scoreEntry(entry, q) : 1
      if (base === 0) continue
      // Recency bonus only applies to search queries — without a query all
      // entries are equally relevant and ordering is by kind then savedAt.
      const ageSaved = now - new Date(entry.savedAt).getTime()
      const bonus = q && ageSaved <= RECENCY_WINDOW_MS ? RECENCY_BONUS : 0
      results.push({ kind, entry, score: base + bonus, source })
    }
  }

  return results
}

function normalizeKinds(kind?: MemoryEntryKind | MemoryEntryKind[]): MemoryEntryKind[] {
  if (!kind) return ALL_KINDS
  return Array.isArray(kind) ? kind : [kind]
}

function entryMatchesAgent(entry: MemoryEntry, agent?: string): boolean {
  if (!agent) return true
  if (!entry.agents || entry.agents.length === 0) return true
  return entry.agents.includes(agent)
}

function scoreEntry(entry: MemoryEntry, q: string): number {
  let score = 0
  const name = entry.name.toLowerCase()
  const body = entry.body.toLowerCase()
  if (name === q) score += 10
  else if (name.startsWith(q)) score += 5
  else if (name.includes(q)) score += 3
  if (body.includes(q)) score += 2
  if (entry.why?.toLowerCase().includes(q)) score += 1
  if (entry.howToApply?.toLowerCase().includes(q)) score += 1
  return score
}
