/**
 * Memory Warmup Types
 */

export interface MemorySection {
  content: string
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
