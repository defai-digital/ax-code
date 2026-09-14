import { totalmem } from "node:os"
import type { LSPServer } from "./server"

// Conservative semantic warmup profile:
// - limit methods to the indexer-critical semantic RPCs
// - only warm a small number of representative languages/files
// - keep bootstrap stricter than explicit index/perf flows
export const INDEXER_SEMANTIC_METHODS = ["documentSymbol", "references"] as const satisfies readonly LSPServer.Method[]

export const INDEX_PREWARM_MAX_FILES = 8
export const INDEX_PREWARM_MAX_LANGUAGES = 8

export const BOOTSTRAP_PREWARM_MAX_FILES = 4
export const BOOTSTRAP_PREWARM_MAX_LANGUAGES = 4
export const BOOTSTRAP_PREWARM_TIMEOUT_MS = 15_000

// Physical RAM chooses a default, not a process or machine-wide memory ceiling.
export function memoryProfile(input: { override?: string; totalBytes?: number } = {}): "low" | "normal" {
  const override = input.override ?? process.env.AX_CODE_MEMORY_PROFILE
  if (override === "low" || override === "normal") return override
  const bytes = input.totalBytes ?? totalmem()
  return Number.isFinite(bytes) && bytes > 0 && bytes <= 8 * 1024 ** 3 ? "low" : "normal"
}

// Speculation can start heavyweight child processes even for a plain file
// read. Explicit semantic/indexer requests remain available in every profile.
export function speculativeLspPrewarmEnabled() {
  return process.env.AX_CODE_LSP_PREWARM === "1" && memoryProfile() === "normal"
}

export const LOW_MEMORY_IDLE_MS = 5 * 60_000
export const NORMAL_MEMORY_IDLE_MS = 30 * 60_000

// A process lifetime policy, not a heap or machine-wide RAM ceiling.
export function lspIdleMs() {
  const override = process.env.AX_CODE_LSP_IDLE_MS
  if (override !== undefined && /^\d+$/.test(override)) {
    const value = Number(override)
    if (Number.isSafeInteger(value)) return value
  }
  return memoryProfile() === "low" ? LOW_MEMORY_IDLE_MS : NORMAL_MEMORY_IDLE_MS
}

export function sourceCacheBytes() {
  return (memoryProfile() === "low" ? 4 : 16) * 1024 ** 2
}
