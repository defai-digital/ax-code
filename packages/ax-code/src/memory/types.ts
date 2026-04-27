/**
 * Memory Warmup Types
 */

export interface MemorySection {
  content: string
  tokens: number
}

export interface MemoryEntry {
  name: string
  body: string
  savedAt: string
  why?: string
  howToApply?: string
  /**
   * Optional allow-list of agent names. When set, the entry is only injected
   * into prompts for those agents. Absent or empty means "applies to all".
   */
  agents?: string[]
}

export type MemoryEntryKind = "userPrefs" | "feedback" | "decisions"

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

export interface WarmupResult {
  memory: ProjectMemory
  isNew: boolean
  changed: boolean
}
