/**
 * Memory Warmup Module
 *
 * Pre-caches project context for faster, more accurate AI responses.
 *
 * Usage:
 *   import { Memory } from "../memory"
 *   await Memory.warmup(projectRoot)
 *   const context = await Memory.getContext(projectRoot)
 */

export { generate } from "./generator"
export { save, load, clear, exists } from "./store"
export { buildContext, getContext, getMetadata, type BuildContextOptions } from "./injector"
export { recordEntry, removeEntry, listEntries, type RecordInput } from "./recorder"
export { recall, type RecallQuery, type RecallResult } from "./recall"
export type {
  ProjectMemory,
  MemorySection,
  MemoryEntry,
  MemoryEntryKind,
  EntrySection,
  WarmupOptions,
  WarmupResult,
} from "./types"
