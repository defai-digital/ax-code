/**
 * Memory Recall
 *
 * Search recorded entries (feedback / userPrefs / decisions / reference) by
 * free-text query, kind, applicable agent, and scope (project / global / all).
 *
 * Scoring is term-aware: exact/phrase/name matches rank highest, individual
 * query terms can match across fields, scoped tags/paths can filter entries,
 * and recency/confidence nudge otherwise similar results.
 */

import * as store from "./store"
import { entryApplies, normalizeTags } from "./applicability"
import type { MemoryEntry, MemoryEntryKind, ProjectMemory } from "./types"

export interface RecallQuery {
  /** Free-text search across name/body/why/howToApply/tags/pathGlobs. */
  query?: string
  /** Restrict to one or more kinds. Defaults to all kinds. */
  kind?: MemoryEntryKind | MemoryEntryKind[]
  /**
   * Filter to entries applicable to this agent. Entries with no `agents`
   * allow-list match every agent.
   */
  agent?: string
  /** Filter to entries tagged with all requested tags. */
  tags?: string | string[]
  /** Filter entries with pathGlobs to entries applicable to this path. */
  path?: string
  /** Include entries whose expiresAt is in the past. Defaults to false. */
  includeExpired?: boolean
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
  /** Human-readable score/filter evidence for diagnostics and CLI --explain. */
  reasons: string[]
  /** Which store this result came from. */
  source: "project" | "global"
}

/** Order matches the actionability ordering used by buildContext. */
const ALL_KINDS: MemoryEntryKind[] = ["feedback", "userPrefs", "decisions", "reference"]

const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const RECENCY_BONUS = 2
const PROJECT_SCOPE_BONUS = 0.25

export async function recall(projectRoot: string, query: RecallQuery = {}): Promise<RecallResult[]> {
  const scope = query.scope ?? "project"
  const results: RecallResult[] = []

  if (scope === "project" || scope === "all") {
    const memory = await store.load(projectRoot).catch(() => null)
    if (memory) results.push(...collectResults(projectRoot, memory.sections, query, "project"))
  }

  if (scope === "global" || scope === "all") {
    const global = await store.loadGlobal().catch(() => null)
    if (global) results.push(...collectResults(projectRoot, global.sections, query, "global"))
  }

  const hasQuery = !!query.query?.trim()
  results.sort((a, b) => {
    if (hasQuery && a.score !== b.score) return b.score - a.score
    const ka = ALL_KINDS.indexOf(a.kind)
    const kb = ALL_KINDS.indexOf(b.kind)
    if (ka !== kb) return ka - kb
    if (!hasQuery && a.score !== b.score) return b.score - a.score
    // Project entries rank above global when score is tied
    if (a.source !== b.source) return a.source === "project" ? -1 : 1
    return b.entry.savedAt.localeCompare(a.entry.savedAt)
  })

  return query.limit && query.limit > 0 ? results.slice(0, query.limit) : results
}

function collectResults(
  projectRoot: string,
  sections: ProjectMemory["sections"],
  query: RecallQuery,
  source: "project" | "global",
): RecallResult[] {
  const wantedKinds = normalizeKinds(query.kind)
  const q = normalizeText(query.query)
  const wantedTags = normalizeTags(query.tags)
  const now = Date.now()
  const results: RecallResult[] = []

  for (const kind of wantedKinds) {
    const section = sections[kind]
    if (!section) continue
    for (const entry of section.entries) {
      if (
        !entryApplies(entry, {
          projectRoot,
          agent: query.agent,
          tags: wantedTags,
          paths: query.path ? [query.path] : undefined,
          includeExpired: query.includeExpired,
          nowMs: now,
        })
      )
        continue
      const scored = q ? scoreEntry(entry, q) : { score: 1, reasons: ["default match"] }
      if (scored.score === 0) continue
      // Recency bonus only applies to search queries — without a query all
      // entries are equally relevant and ordering is by kind then savedAt.
      const ageSaved = now - new Date(entry.savedAt).getTime()
      const reasons = [...scored.reasons]
      let score = scored.score
      if (entry.confidence !== undefined) {
        score *= entry.confidence
        reasons.push(`confidence ${entry.confidence}`)
      }
      if (q && ageSaved <= RECENCY_WINDOW_MS) {
        score += RECENCY_BONUS
        reasons.push("recent")
      }
      if (q && source === "project") {
        score += PROJECT_SCOPE_BONUS
        reasons.push("project scope")
      }
      if (wantedTags.length > 0) reasons.push("tag filter")
      if (query.path && entry.pathGlobs?.length) reasons.push("path filter")
      results.push({ kind, entry, score, reasons, source })
    }
  }

  return results
}

function normalizeKinds(kind?: MemoryEntryKind | MemoryEntryKind[]): MemoryEntryKind[] {
  if (!kind) return ALL_KINDS
  return Array.isArray(kind) ? kind : [kind]
}

function normalizeText(text: string | undefined): string | undefined {
  const normalized = text?.toLowerCase().trim().replace(/\s+/g, " ")
  return normalized || undefined
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[^a-z0-9_./:-]+/i)
        .map((term) => term.toLowerCase())
        .filter(Boolean),
    ),
  )
}

function scoreEntry(entry: MemoryEntry, q: string): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const terms = tokenize(q)
  const fields = [
    { label: "name", text: entry.name.toLowerCase(), phrase: 4, term: 2 },
    { label: "body", text: entry.body.toLowerCase(), phrase: 3, term: 1.5 },
    { label: "why", text: entry.why?.toLowerCase() ?? "", phrase: 2, term: 1 },
    { label: "apply", text: entry.howToApply?.toLowerCase() ?? "", phrase: 2, term: 1 },
    { label: "tags", text: entry.tags?.join(" ").toLowerCase() ?? "", phrase: 2.5, term: 1.5 },
    { label: "paths", text: entry.pathGlobs?.join(" ").toLowerCase() ?? "", phrase: 1.5, term: 0.75 },
  ]

  const name = fields[0].text
  if (name === q) {
    score += 10
    reasons.push("exact name")
  } else if (name.startsWith(q)) {
    score += 6
    reasons.push("name prefix")
  }

  for (const field of fields) {
    if (!field.text) continue
    if (field.text.includes(q)) {
      score += field.phrase
      reasons.push(`${field.label} phrase`)
    }
  }

  const matchedTerms = new Set<string>()
  for (const term of terms) {
    for (const field of fields) {
      if (!field.text.includes(term)) continue
      matchedTerms.add(term)
      score += field.term
      reasons.push(`${field.label}:${term}`)
      break
    }
  }

  if (terms.length > 1 && matchedTerms.size > 0 && matchedTerms.size < terms.length) {
    score *= matchedTerms.size / terms.length
    reasons.push("partial query")
  }

  return { score, reasons }
}
