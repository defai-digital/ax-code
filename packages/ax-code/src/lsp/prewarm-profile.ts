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
