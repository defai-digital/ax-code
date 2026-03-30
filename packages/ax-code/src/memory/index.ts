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
export { buildContext, getContext, getMetadata } from "./injector"
export type { ProjectMemory, MemorySection, WarmupOptions, WarmupResult } from "./types"
