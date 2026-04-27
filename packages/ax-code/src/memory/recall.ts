/**
 * Memory Recall
 *
 * Search recorded entries (feedback / userPrefs / decisions) by free-text
 * query, kind, and applicable agent. Complements `listEntries` which only
 * filters by kind.
 *
 * Scoring is intentionally simple substring matching — entries are
 * user-curated and small in count, so heuristic ranking is enough; full-text
 * indexing would be over-engineering.
 */

import * as store from "./store"
import type { MemoryEntry, MemoryEntryKind } from "./types"

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
}

export interface RecallResult {
  kind: MemoryEntryKind
  entry: MemoryEntry
  score: number
}

/** Order matches the actionability ordering used by buildContext. */
const ALL_KINDS: MemoryEntryKind[] = ["feedback", "userPrefs", "decisions"]

export async function recall(projectRoot: string, query: RecallQuery = {}): Promise<RecallResult[]> {
  const memory = await store.load(projectRoot).catch(() => null)
  if (!memory) return []

  const wantedKinds = normalizeKinds(query.kind)
  const q = query.query?.toLowerCase().trim()

  const results: RecallResult[] = []
  for (const kind of wantedKinds) {
    const section = memory.sections[kind]
    if (!section) continue
    for (const entry of section.entries) {
      if (!entryMatchesAgent(entry, query.agent)) continue
      const score = q ? scoreEntry(entry, q) : 1
      if (score === 0) continue
      results.push({ kind, entry, score })
    }
  }

  results.sort((a, b) => {
    const ka = ALL_KINDS.indexOf(a.kind)
    const kb = ALL_KINDS.indexOf(b.kind)
    if (ka !== kb) return ka - kb
    if (a.score !== b.score) return b.score - a.score
    return b.entry.savedAt.localeCompare(a.entry.savedAt)
  })

  return query.limit && query.limit > 0 ? results.slice(0, query.limit) : results
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
