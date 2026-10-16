/**
 * Memory Warmup Types
 */

export interface MemorySection {
  content: string
  tokens: number
  /** ISO8601 timestamp of when this section was last scanned. Used for staleness detection. */
  scannedAt?: string
}

export interface MemoryEntry {
  name: string
  body: string
  savedAt: string
  why?: string
  howToApply?: string
  /** Optional labels used by recall filters and ranking. */
  tags?: string[]
  /** Optional file globs where this entry applies. Absent/empty means all paths. */
  pathGlobs?: string[]
  /** ISO8601 timestamp after which this entry is ignored by default. */
  expiresAt?: string
  /** User or system confidence in the entry, from 0 to 1. Defaults to 1. */
  confidence?: number
  /** Optional source session that produced or justified the memory. */
  sourceSessionId?: string
  /**
   * Optional allow-list of agent names. When set, the entry is only injected
   * into prompts for those agents. Absent or empty means "applies to all".
   */
  agents?: string[]
  /**
   * ADR-206 threat-scan verdict. A flagged entry stays stored but is excluded
   * from injection; `memory doctor` lists it with the reasons. Optional so
   * existing memory files keep loading.
   */
  flagged?: {
    /** Stable pattern ids that matched (e.g. "instruction_override"). */
    patterns: string[]
    /** Static human-readable reasons, never entry content. */
    reasons: string[]
    /** ISO8601 timestamp of the scan that flagged the entry. */
    flaggedAt: string
  }
}

export type MemoryEntryKind = "userPrefs" | "feedback" | "decisions" | "reference"

export interface EntrySection {
  entries: MemoryEntry[]
  tokens: number
}

export interface ProjectMemory {
  version: number
  created: string
  updated: string
  projectRoot: string
  contentHash: string
  maxTokens: number
  sections: {
    structure?: MemorySection
    readme?: MemorySection
    config?: MemorySection
    patterns?: MemorySection
    userPrefs?: EntrySection
    feedback?: EntrySection
    decisions?: EntrySection
    reference?: EntrySection
  }
  totalTokens: number
}

export interface WarmupOptions {
  /** Maximum total tokens for memory (default: 4000) */
  maxTokens?: number
  /** Directory depth for structure scan (default: 3) */
  depth?: number
  /** Show what would be cached without writing */
  dryRun?: boolean
}
