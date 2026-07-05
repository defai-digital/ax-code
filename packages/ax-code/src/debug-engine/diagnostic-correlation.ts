import { Log } from "../util/log"
import { Bus } from "../bus"
import { LSPClient } from "../lsp/client"
import { CodeIntelligence } from "../code-intelligence"
import { Instance } from "../project/instance"
import { ProjectID } from "../project/schema"
import { uniqueStrings } from "../util/string-list"
import { DebugEngine } from "./index"

// diagnostic-correlation — Cross-file root-cause analysis for LSP diagnostics.
//
// Subscribes to lsp.client.diagnostics events and, for each error-severity
// diagnostic, walks the code graph to check whether the root cause originates
// in a different file (a caller that passes wrong types, a module that exports
// a broken signature, etc.).
//
// Results are cached per file with a TTL to avoid redundant graph queries on
// rapid diagnostic updates (LSP servers often re-publish diagnostics for the
// same file in quick succession during incremental compilation).

const log = Log.create({ service: "debug-engine.correlation" })

// Cache entry: timestamp + list of correlated diagnostics for a file.
type CacheEntry = {
  correlations: DebugEngine.CorrelatedDiagnostic[]
  timestamp: number
}

type LspProvenance = {
  timestamp: number
  serverIDs: string[]
}

type GraphProvenance = {
  queryIds: string[]
  indexedAt: number
  completeness: DebugEngine.Completeness
}

type CorrelationState = {
  cache: Map<string, CacheEntry>
  pendingTimers: Map<string, ReturnType<typeof setTimeout>>
  unsubscribe: () => void
}

// LRU-ish cache keyed by normalized file path.
const MAX_CACHE_ENTRIES = 200
const CACHE_TTL_MS = 30_000

// Debounce map: file path -> pending timer. Prevents redundant correlation
// work when a language server fires multiple diagnostic events within a short
// window for the same file (common with tsserver during incremental builds).
const DEBOUNCE_MS = 300
const activeStates = new Set<CorrelationState>()

// Maximum callers to walk per symbol during correlation. Keeps the graph
// traversal bounded even for heavily-referenced symbols.
const MAX_CALLERS_PER_SYMBOL = 8

// Maximum depth of the caller chain to walk. Depth 1 = direct callers only,
// depth 2 = callers-of-callers. Beyond 2 the signal-to-noise ratio drops.
const MAX_CALLER_DEPTH = 2

// Maximum correlations returned per file.
const MAX_CORRELATIONS_PER_FILE = 10
type ErrorDiagnostic = LSPClient.Diagnostic & { severity: number }

export namespace DiagnosticCorrelation {
  /**
   * Initialize the instance-scoped LSP diagnostic subscriber. This is cheap
   * and idempotent for the current workspace instance.
   */
  export function init(): void {
    state()
  }

  /**
   * Back-compat wrapper for older callers/tests. Prefer init(); instance
   * disposal now owns the actual subscriber lifecycle.
   */
  export function start(): () => void {
    state()
    return () => {
      void state.invalidate()
    }
  }

  /**
   * Pull-based access to cached correlations for a file. Returns an empty
   * array if no correlations are cached or the cache has expired.
   */
  export function correlateDiagnostics(file: string): DebugEngine.CorrelatedDiagnostic[] {
    let current: CorrelationState
    try {
      current = state()
    } catch {
      return []
    }
    const entry = current.cache.get(cacheKey(file))
    if (!entry) return []
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      current.cache.delete(cacheKey(file))
      return []
    }
    return entry.correlations
  }

  /**
   * Force a fresh correlation run for a file, bypassing the debounce.
   * Useful when the agent tool layer needs correlations synchronously
   * after an edit.
   */
  export async function correlateNow(file: string): Promise<DebugEngine.CorrelatedDiagnostic[]> {
    return runCorrelation(file)
  }

  /**
   * Clear the entire cache. Test helper.
   */
  export function __clearCache(): void {
    for (const current of activeStates) {
      current.cache.clear()
      for (const timer of current.pendingTimers.values()) clearTimeout(timer)
      current.pendingTimers.clear()
    }
  }
}

// ─── Exported for testing ─────────────────────────────────────────────

export function __testFindEnclosingSymbol(
  symbols: CodeIntelligence.Symbol[],
  line: number,
): CodeIntelligence.Symbol | null {
  return findEnclosingSymbol(symbols, line)
}

export function __testFindCrossFileRootCause(
  projectID: string,
  file: string,
  line: number,
  message: string,
  severity: number,
  symbol: CodeIntelligence.Symbol,
): DebugEngine.CorrelatedDiagnostic {
  return findCrossFileRootCause(
    ProjectID.make(projectID),
    file,
    line,
    message,
    severity,
    symbol,
    defaultLspProvenance(),
  )
}

export function __testRenderCorrelationBlock(
  file: string,
  correlationMap: Map<string, DebugEngine.CorrelatedDiagnostic[]>,
): string {
  return renderCorrelationBlockInternal(file, correlationMap)
}

function normalizePath(file: string): string {
  // Use the same normalization as the tool layer — lowercase on case-
  // insensitive file systems, strip trailing slashes.
  return file.replace(/\\/g, "/")
}

function cacheKey(file: string): string {
  return `${Instance.project.id}\0${normalizePath(file)}`
}

const state = Instance.state(
  () => {
    const current: CorrelationState = {
      cache: new Map<string, CacheEntry>(),
      pendingTimers: new Map<string, ReturnType<typeof setTimeout>>(),
      unsubscribe: () => {},
    }
    current.unsubscribe = Bus.subscribe(LSPClient.Event.Diagnostics, (event) => {
      const { path } = event.properties
      scheduleCorrelation(current, path)
    })
    activeStates.add(current)
    log.info("diagnostic correlation subscriber started")
    return current
  },
  async (current) => {
    current.unsubscribe()
    for (const timer of current.pendingTimers.values()) clearTimeout(timer)
    current.pendingTimers.clear()
    current.cache.clear()
    activeStates.delete(current)
    log.info("diagnostic correlation subscriber stopped")
  },
)

function isErrorDiagnostic(diagnostic: LSPClient.Diagnostic): diagnostic is ErrorDiagnostic {
  return diagnostic.severity === 1
}

function scheduleCorrelation(current: CorrelationState, file: string): void {
  const key = normalizePath(file)
  const existing = current.pendingTimers.get(key)
  if (existing) clearTimeout(existing)
  const run = Instance.bind(async () => {
    current.pendingTimers.delete(key)
    try {
      await runCorrelation(file)
    } catch (err) {
      log.warn("correlation failed", { file, error: err })
    }
  })
  current.pendingTimers.set(key, setTimeout(run, DEBOUNCE_MS))
}

async function runCorrelation(file: string): Promise<DebugEngine.CorrelatedDiagnostic[]> {
  const current = state()
  const projectID = Instance.project.id
  const normalized = normalizePath(file)
  const key = cacheKey(file)

  // Get current LSP diagnostics for this file from the LSP namespace
  // rather than the raw client cache — this ensures we get the aggregated
  // and normalized view.
  const { diagnostics: allDiagnostics, provenance: lspProvenance } = await getDiagnosticsForFile(file)
  const errorDiagnostics = allDiagnostics.filter(isErrorDiagnostic)
  if (errorDiagnostics.length === 0) {
    current.cache.set(key, { correlations: [], timestamp: Date.now() })
    return []
  }

  // Resolve symbols in this file from the code graph.
  const symbols = CodeIntelligence.symbolsInFile(projectID, file, { scope: "worktree" })
  if (symbols.length === 0) {
    // No graph data — return uncorrelated diagnostics.
    const uncorrelated = errorDiagnostics.slice(0, MAX_CORRELATIONS_PER_FILE).map((d) => ({
      file,
      line: d.range.start.line,
      message: d.message,
      severity: d.severity,
      rootCauseFile: null,
      rootCauseSymbol: null,
      rootCauseChain: [],
      confidence: "low" as const,
      ...provenanceFields(lspProvenance, graphProvenance([])),
    }))
    current.cache.set(key, { correlations: uncorrelated, timestamp: Date.now() })
    return uncorrelated
  }

  const correlations: DebugEngine.CorrelatedDiagnostic[] = []

  for (const diag of errorDiagnostics) {
    if (correlations.length >= MAX_CORRELATIONS_PER_FILE) break

    const diagLine = diag.range.start.line

    // Find the symbol closest to the diagnostic's line.
    const enclosingSymbol = findEnclosingSymbol(symbols, diagLine)
    if (!enclosingSymbol) {
      correlations.push({
        file,
        line: diagLine,
        message: diag.message,
        severity: diag.severity,
        rootCauseFile: null,
        rootCauseSymbol: null,
        rootCauseChain: [],
        confidence: "low",
        ...provenanceFields(lspProvenance, graphProvenance(symbols)),
      })
      continue
    }

    // Walk callers to find cross-file root causes.
    const correlation = findCrossFileRootCause(
      projectID,
      file,
      diagLine,
      diag.message,
      diag.severity,
      enclosingSymbol,
      lspProvenance,
    )
    correlations.push(correlation)
  }

  // Cache and emit.
  current.cache.set(key, { correlations, timestamp: Date.now() })
  evictStaleEntries(current)

  if (correlations.some((c) => c.rootCauseFile !== null)) {
    Bus.publishDetached(DebugEngine.Event.CorrelatedDiagnostics, {
      file: normalized,
      correlations,
    })
  }

  log.info("correlation complete", {
    file,
    errorCount: errorDiagnostics.length,
    correlatedCount: correlations.filter((c) => c.rootCauseFile !== null).length,
  })

  return correlations
}

function findEnclosingSymbol(symbols: CodeIntelligence.Symbol[], line: number): CodeIntelligence.Symbol | null {
  // Find the symbol whose range contains the diagnostic line. If multiple
  // match, prefer the innermost (smallest range).
  let best: CodeIntelligence.Symbol | null = null
  let bestSpan = Infinity
  for (const sym of symbols) {
    const startLine = sym.range.start.line
    const endLine = sym.range.end.line
    if (line >= startLine && line <= endLine) {
      const span = endLine - startLine
      if (span < bestSpan) {
        best = sym
        bestSpan = span
      }
    }
  }
  return best
}

function findCrossFileRootCause(
  projectID: ProjectID,
  file: string,
  line: number,
  message: string,
  severity: number,
  symbol: CodeIntelligence.Symbol,
  lspProvenance: LspProvenance,
): DebugEngine.CorrelatedDiagnostic {
  // Walk callers at depth 1 first (direct callers in other files).
  const callers = CodeIntelligence.findCallers(projectID, symbol.id, { scope: "worktree" }).slice(
    0,
    MAX_CALLERS_PER_SYMBOL,
  )

  // Depth-2 expansion: for each depth-1 caller in a different file, find
  // its callers too. This catches "A calls B calls C, error in C but root
  // cause in A" patterns.
  const allCandidates: { sym: CodeIntelligence.Symbol; depth: number }[] = []
  for (const caller of callers) {
    allCandidates.push({ sym: caller.symbol, depth: 1 })
    if (caller.symbol.file !== file && allCandidates.length < MAX_CALLERS_PER_SYMBOL * 2) {
      const deeperCallers = CodeIntelligence.findCallers(projectID, caller.symbol.id, { scope: "worktree" }).slice(0, 3)
      for (const dc of deeperCallers) {
        allCandidates.push({ sym: dc.symbol, depth: 2 })
      }
    }
  }

  // Score candidates: prefer callers from a different file, closer to the
  // diagnostic's line, with public visibility (more likely to be the
  // "source" of a type mismatch).
  const crossFileCandidates = allCandidates.filter((c) => c.sym.file !== file)
  if (crossFileCandidates.length === 0) {
    // All callers are in the same file — no cross-file root cause.
    return {
      file,
      line,
      message,
      severity,
      rootCauseFile: null,
      rootCauseSymbol: null,
      rootCauseChain: [symbol.qualifiedName],
      confidence: "low",
      ...provenanceFields(lspProvenance, graphProvenance([symbol, ...allCandidates.map((c) => c.sym)])),
    }
  }

  // Pick the best candidate: depth 1 preferred, public visibility bonus,
  // function/method kind preferred over module/namespace.
  const scored = crossFileCandidates.map((c) => {
    let score = 0
    if (c.depth === 1) score += 10
    if (c.sym.visibility === "public" || c.sym.visibility === undefined) score += 5
    if (c.sym.kind === "function" || c.sym.kind === "method") score += 3
    if (c.sym.kind === "class" || c.sym.kind === "interface") score += 1
    return { ...c, score }
  })
  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best) {
    return {
      file,
      line,
      message,
      severity,
      rootCauseFile: null,
      rootCauseSymbol: null,
      rootCauseChain: [symbol.qualifiedName],
      confidence: "low",
      ...provenanceFields(lspProvenance, graphProvenance([symbol, ...allCandidates.map((c) => c.sym)])),
    }
  }

  // Build the chain: seed symbol -> ... -> root cause symbol.
  const chain = [symbol.qualifiedName]
  if (best.depth === 2) {
    // Insert the intermediate depth-1 caller if we can identify it.
    const intermediate = callers.find((c) => c.symbol.file === best.sym.file || c.symbol.id === best.sym.id)
    if (intermediate) chain.push(intermediate.symbol.qualifiedName)
  }
  chain.push(best.sym.qualifiedName)

  // Confidence: "high" when we have a depth-1 cross-file caller that is
  // a function/method with public visibility; "medium" for depth-2 or
  // non-function callers; "low" otherwise.
  const confidence: DebugEngine.CorrelatedDiagnostic["confidence"] =
    best.depth === 1 && (best.sym.kind === "function" || best.sym.kind === "method")
      ? "high"
      : best.depth <= MAX_CALLER_DEPTH
        ? "medium"
        : "low"

  return {
    file,
    line,
    message,
    severity,
    rootCauseFile: best.sym.file,
    rootCauseSymbol: best.sym.qualifiedName,
    rootCauseChain: chain,
    confidence,
    ...provenanceFields(lspProvenance, graphProvenance([symbol, ...allCandidates.map((c) => c.sym)])),
  }
}

function renderCorrelationBlockInternal(
  file: string,
  correlationMap: Map<string, DebugEngine.CorrelatedDiagnostic[]>,
): string {
  const correlations = correlationMap.get(file)
  if (!correlations || correlations.length === 0) return ""

  const withRootCause = correlations
    .filter((c) => c.rootCauseFile !== null && c.confidence !== "low")
    .slice(0, MAX_CORRELATIONS_PER_FILE)
  if (withRootCause.length === 0) return ""

  const lines = withRootCause.map((c) => {
    const chain = c.rootCauseChain.length > 1 ? ` via ${c.rootCauseChain.slice(1).join(" -> ")}` : ""
    return `  Line ${c.line}: Possible root cause in ${c.rootCauseFile} (${c.rootCauseSymbol}${chain}, confidence: ${c.confidence})`
  })

  return `\n<correlation file="${file}">\n${lines.join("\n")}\n</correlation>`
}

async function getDiagnosticsForFile(file: string): Promise<{
  diagnostics: LSPClient.Diagnostic[]
  provenance: LspProvenance
}> {
  // Pull from the aggregated LSP diagnostics cache. This uses the same
  // data source as tool/diagnostics.ts — the per-client diagnostic maps
  // populated by textDocument/publishDiagnostics.
  const lsp = await import("../lsp").then((m) => m.LSP)
  const [all, envelope] = await Promise.all([lsp.diagnostics(), lsp.diagnosticsAggregated(file)])
  return {
    diagnostics: all[file] ?? [],
    provenance: {
      timestamp: envelope.timestamp,
      serverIDs: envelope.serverIDs,
    },
  }
}

function defaultLspProvenance(): LspProvenance {
  return { timestamp: Date.now(), serverIDs: [] }
}

function graphProvenance(symbols: CodeIntelligence.Symbol[]): GraphProvenance {
  const explains = symbols.map((symbol) => symbol.explain)
  const queryIds = uniqueStrings(explains.map((explain) => explain.queryId))
  const indexedAt = explains.length === 0 ? 0 : Math.min(...explains.map((explain) => explain.indexedAt))
  let completeness: DebugEngine.Completeness = "full"
  for (const explain of explains) {
    if (explain.completeness === "partial") {
      completeness = "partial"
      break
    }
    if (explain.completeness === "lsp-only") completeness = "lsp-only"
  }
  return { queryIds, indexedAt, completeness }
}

function provenanceFields(lsp: LspProvenance, graph: GraphProvenance) {
  return {
    lspTimestamp: lsp.timestamp,
    lspServerIDs: lsp.serverIDs,
    graphQueryIds: graph.queryIds,
    graphIndexedAt: graph.indexedAt,
    graphCompleteness: graph.completeness,
  }
}

function evictStaleEntries(current: CorrelationState): void {
  if (current.cache.size <= MAX_CACHE_ENTRIES) return
  // Evict oldest entries first.
  const now = Date.now()
  const entries = [...current.cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)
  const toRemove = entries.slice(0, Math.max(1, entries.length - MAX_CACHE_ENTRIES))
  for (const [key] of toRemove) {
    current.cache.delete(key)
  }
  // Also evict anything older than 2x TTL as a safety net.
  for (const [key, entry] of current.cache) {
    if (now - entry.timestamp > CACHE_TTL_MS * 2) current.cache.delete(key)
  }
}
