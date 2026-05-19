/**
 * Cross-session debug pattern memory.
 *
 * When a debug case is resolved (confirmed hypothesis), a compact signature
 * is stored in the `debug_engine_pattern` table. On a new debug case open,
 * the system queries this table for similar patterns using:
 * - Keyword overlap (Jaccard similarity)
 * - File path similarity
 * - Error category match
 *
 * Patterns are capped at 1000 per project with LRU eviction.
 *
 * ADR-002: DRE-owned, no FK into v3 tables.
 */

import { eq, and, desc, sql } from "drizzle-orm"
import { Log } from "../util/log"
import { Database } from "../storage/db"
import { DebugPatternTable, type DebugPatternCategory } from "./schema.sql"
import { DebugPatternID } from "./id"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "debug-engine.pattern-memory" })

const MAX_PATTERNS = 1000
const SIMILARITY_THRESHOLD = 0.3

export interface DebugPatternRecord {
  id: string
  projectID: ProjectID
  problem: string
  category: DebugPatternCategory
  fixPattern: string
  affectedFilePatterns: string[]
  keywords: string[]
  lastMatchedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface PatternMatch {
  pattern: DebugPatternRecord
  similarity: number
  reason: string
}

// ─── Store a pattern ───────────────────────────────────────────────

export async function storePattern(input: {
  projectID: ProjectID
  problem: string
  category: DebugPatternCategory
  fixPattern: string
  affectedFiles: string[]
}): Promise<string> {
  const id = DebugPatternID.ascending()
  const now = Date.now()

  // Extract keywords from problem and fix pattern
  const keywords = extractKeywords(input.problem, input.fixPattern)

  // Convert file paths to glob-style patterns
  const affectedFilePatterns = toGlobPatterns(input.affectedFiles)

  // Check capacity and evict if needed
  await evictIfNeeded(input.projectID)

  try {
    await Database.use((db) =>
      db.insert(DebugPatternTable).values({
        id,
        project_id: input.projectID,
        problem: input.problem,
        category: input.category,
        fix_pattern: input.fixPattern,
        affected_file_patterns: affectedFilePatterns,
        keywords,
        last_matched_at: null,
      }),
    )

    log.info("stored debug pattern", {
      id,
      projectID: input.projectID,
      category: input.category,
      keywords: keywords.slice(0, 5),
    })

    return id
  } catch (err) {
    log.warn("failed to store debug pattern", { err, projectID: input.projectID })
    return ""
  }
}

// ─── Query for similar patterns ────────────────────────────────────

export async function findSimilarPatterns(input: {
  projectID: ProjectID
  problem: string
  category?: DebugPatternCategory
  affectedFiles?: string[]
}): Promise<PatternMatch[]> {
  const keywords = extractKeywords(input.problem)
  const affectedFilePatterns = input.affectedFiles ? toGlobPatterns(input.affectedFiles) : []

  try {
    const rows = await Database.use((db) =>
      db
        .select()
        .from(DebugPatternTable)
        .where(eq(DebugPatternTable.project_id, input.projectID))
        .orderBy(desc(DebugPatternTable.time_updated))
        .limit(100),
    )

    const matches: PatternMatch[] = []

    for (const row of rows) {
      const storedKeywords = row.keywords ?? []
      const storedFilePatterns = row.affected_file_patterns ?? []

      // Calculate similarity
      const keywordSim = jaccardSimilarity(new Set(keywords), new Set(storedKeywords))
      const fileSim =
        affectedFilePatterns.length > 0
          ? jaccardSimilarity(new Set(affectedFilePatterns), new Set(storedFilePatterns))
          : 0
      const categorySim = input.category && input.category === row.category ? 1 : 0

      // Weighted similarity: keywords 50%, files 30%, category 20%
      const similarity = keywordSim * 0.5 + fileSim * 0.3 + categorySim * 0.2

      if (similarity >= SIMILARITY_THRESHOLD) {
        const reasons: string[] = []
        if (keywordSim > 0.3) reasons.push(`keyword overlap (${(keywordSim * 100).toFixed(0)}%)`)
        if (fileSim > 0.3) reasons.push(`file path similarity (${(fileSim * 100).toFixed(0)}%)`)
        if (categorySim > 0) reasons.push("same error category")

        matches.push({
          pattern: {
            id: row.id,
            projectID: row.project_id as ProjectID,
            problem: row.problem,
            category: row.category,
            fixPattern: row.fix_pattern,
            affectedFilePatterns: storedFilePatterns,
            keywords: storedKeywords,
            lastMatchedAt: row.last_matched_at,
            createdAt: row.time_created,
            updatedAt: row.time_updated,
          },
          similarity,
          reason: reasons.join(", "),
        })
      }
    }

    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity)

    // Update last_matched_at for top matches
    for (const match of matches.slice(0, 3)) {
      await Database.use((db) =>
        db
          .update(DebugPatternTable)
          .set({ last_matched_at: Date.now(), time_updated: Date.now() })
          .where(eq(DebugPatternTable.id, match.pattern.id as any)),
      )
    }

    return matches
  } catch (err) {
    log.warn("failed to find similar patterns", { err, projectID: input.projectID })
    return []
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function extractKeywords(...texts: string[]): string[] {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "to",
    "of",
    "in",
    "for",
    "on",
    "with",
    "at",
    "by",
    "from",
    "as",
    "into",
    "through",
    "during",
    "before",
    "after",
    "above",
    "below",
    "between",
    "under",
    "again",
    "further",
    "then",
    "once",
    "and",
    "but",
    "or",
    "nor",
    "not",
    "so",
    "yet",
    "both",
    "either",
    "neither",
    "each",
    "every",
    "all",
    "any",
    "few",
    "more",
    "most",
    "other",
    "some",
    "such",
    "no",
    "only",
    "own",
    "same",
    "than",
    "too",
    "very",
    "just",
    "because",
    "if",
    "when",
    "where",
    "how",
    "what",
    "which",
    "who",
    "whom",
    "this",
    "that",
    "these",
    "those",
    "it",
    "its",
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "he",
    "him",
    "his",
    "she",
    "her",
    "they",
    "them",
    "their",
    "about",
    "up",
    "out",
    "over",
    "down",
    "off",
  ])

  const words: string[] = []
  for (const text of texts) {
    // Extract words, convert to lowercase, remove punctuation
    const extracted = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w))
    words.push(...extracted)
  }

  // Return unique keywords, capped at 20
  return [...new Set(words)].slice(0, 20)
}

function toGlobPatterns(files: string[]): string[] {
  // Convert file paths to directory-level glob patterns
  const dirs = new Set<string>()
  for (const file of files) {
    // Get the directory and filename pattern
    const parts = file.split(/[\/\\]/)
    if (parts.length >= 2) {
      // e.g., "src/session/processor.ts" -> "src/session/*.ts"
      const dir = parts.slice(0, -1).join("/")
      const ext = parts[parts.length - 1].match(/\.[^.]+$/)?.[0] ?? ""
      dirs.add(`${dir}/*${ext}`)
    } else {
      dirs.add(file)
    }
  }
  return [...dirs].slice(0, 10)
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  const intersection = new Set([...a].filter((x) => b.has(x)))
  const union = new Set([...a, ...b])
  return intersection.size / union.size
}

async function evictIfNeeded(projectID: ProjectID): Promise<void> {
  const count = await Database.use((db) =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(DebugPatternTable)
      .where(eq(DebugPatternTable.project_id, projectID)),
  )

  const currentCount = count[0]?.count ?? 0
  if (currentCount >= MAX_PATTERNS) {
    // Evict oldest 10% of patterns (by last_matched_at, then by time_created)
    const toDelete = Math.ceil(MAX_PATTERNS * 0.1)
    const toEvict = await Database.use((db) =>
      db
        .select({ id: DebugPatternTable.id })
        .from(DebugPatternTable)
        .where(eq(DebugPatternTable.project_id, projectID))
        .orderBy(DebugPatternTable.last_matched_at, DebugPatternTable.time_created)
        .limit(toDelete),
    )

    if (toEvict.length > 0) {
      await Database.use((db) =>
        db.delete(DebugPatternTable).where(
          and(
            eq(DebugPatternTable.project_id, projectID),
            sql`${DebugPatternTable.id} IN (${sql.join(
              toEvict.map((r) => sql`${r.id}`),
              sql`, `,
            )})`,
          ),
        ),
      )
      log.info("evicted old debug patterns", { projectID, evicted: toEvict.length })
    }
  }
}

// ─── Query helpers ─────────────────────────────────────────────────

export async function countPatterns(projectID: ProjectID): Promise<number> {
  const result = await Database.use((db) =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(DebugPatternTable)
      .where(eq(DebugPatternTable.project_id, projectID)),
  )
  return result[0]?.count ?? 0
}

export async function listPatterns(projectID: ProjectID): Promise<DebugPatternRecord[]> {
  const rows = await Database.use((db) =>
    db
      .select()
      .from(DebugPatternTable)
      .where(eq(DebugPatternTable.project_id, projectID))
      .orderBy(desc(DebugPatternTable.time_updated))
      .limit(50),
  )

  return rows.map((row) => ({
    id: row.id,
    projectID: row.project_id as ProjectID,
    problem: row.problem,
    category: row.category,
    fixPattern: row.fix_pattern,
    affectedFilePatterns: row.affected_file_patterns ?? [],
    keywords: row.keywords ?? [],
    lastMatchedAt: row.last_matched_at,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }))
}
