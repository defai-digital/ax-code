import { Log } from "../util/log"
import { CodeGraphQuery } from "./query"
import { CodeGraphBuilder } from "./builder"
import type { CodeNodeID } from "./id"
import type { CodeNodeKind, CodeEdgeKind } from "./schema.sql"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "code-intelligence" })

// Public-facing namespace for the v3 Code Intelligence Runtime.
//
// This is the only surface the agent and other subsystems should use.
// The query layer (CodeGraphQuery) and builder (CodeGraphBuilder) are
// implementation details — direct consumers risk coupling to the
// schema, which will evolve.
//
// Every returned record carries an `explain` field so callers can
// audit where the answer came from (source, indexed_at, completeness
// of the file's last indexing pass). This is part of the PRD's O3
// explainability objective.
export namespace CodeIntelligence {
  // ─── Types returned to callers ──────────────────────────────────────

  export type Explain = {
    source: "code-graph"
    indexedAt: number
    completeness: "full" | "partial" | "lsp-only"
    queryId: string
  }

  export type Symbol = {
    id: CodeNodeID
    kind: CodeNodeKind
    name: string
    qualifiedName: string
    file: string
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    signature?: string
    visibility?: string
    explain: Explain
  }

  export type Reference = {
    sourceFile: string
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    edgeKind: CodeEdgeKind
    explain: Explain
  }

  export type CallChainNode = {
    symbol: Symbol
    depth: number
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  function nextQueryId(): string {
    return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }

  // Guard for the completeness enum read back from SQLite. The column is
  // stored as plain TEXT (no CHECK constraint — adding one now would
  // require a migration), so we validate at read time. Any unknown value
  // collapses to "partial", which is the safest default: callers should
  // treat it as "we don't fully trust this index".
  function normalizeCompleteness(value: string | undefined): "full" | "partial" | "lsp-only" {
    if (value === "full" || value === "lsp-only") return value
    return "partial"
  }

  function buildExplain(file: string, projectID: ProjectID, queryId: string): Explain {
    const fileRow = CodeGraphQuery.getFile(projectID, file)
    return {
      source: "code-graph",
      indexedAt: fileRow?.indexed_at ?? 0,
      completeness: normalizeCompleteness(fileRow?.completeness),
      queryId,
    }
  }

  function nodeRowToSymbol(
    row: ReturnType<typeof CodeGraphQuery.getNode> & {},
    projectID: ProjectID,
    queryId: string,
  ): Symbol {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      qualifiedName: row.qualified_name,
      file: row.file,
      range: {
        start: { line: row.range_start_line, character: row.range_start_char },
        end: { line: row.range_end_line, character: row.range_end_char },
      },
      signature: row.signature ?? undefined,
      visibility: row.visibility ?? undefined,
      explain: buildExplain(row.file, projectID, queryId),
    }
  }

  // ─── Symbol lookup ──────────────────────────────────────────────────

  export function findSymbol(
    projectID: ProjectID,
    name: string,
    opts?: { kind?: CodeNodeKind; file?: string; limit?: number },
  ): Symbol[] {
    const queryId = nextQueryId()
    const rows = CodeGraphQuery.findNodesByName(projectID, name, opts)
    log.info("findSymbol", { projectID, name, count: rows.length, queryId })
    return rows.map((row) => nodeRowToSymbol(row, projectID, queryId))
  }

  export function findSymbolByPrefix(
    projectID: ProjectID,
    prefix: string,
    opts?: { kind?: CodeNodeKind; limit?: number },
  ): Symbol[] {
    const queryId = nextQueryId()
    const rows = CodeGraphQuery.findNodesByNamePrefix(projectID, prefix, opts)
    log.info("findSymbolByPrefix", { projectID, prefix, count: rows.length, queryId })
    return rows.map((row) => nodeRowToSymbol(row, projectID, queryId))
  }

  export function getSymbol(projectID: ProjectID, id: CodeNodeID): Symbol | null {
    const queryId = nextQueryId()
    // getNode filters by project_id at the SQL layer — no separate
    // runtime check needed.
    const row = CodeGraphQuery.getNode(projectID, id)
    if (!row) return null
    return nodeRowToSymbol(row, projectID, queryId)
  }

  // ─── File-level queries ─────────────────────────────────────────────

  export function symbolsInFile(projectID: ProjectID, file: string): Symbol[] {
    const queryId = nextQueryId()
    const rows = CodeGraphQuery.nodesInFile(projectID, file)
    return rows.map((row) => nodeRowToSymbol(row, projectID, queryId))
  }

  // ─── Reference and call analysis ────────────────────────────────────
  //
  // Phase 2: these functions return real data. Edge ingestion happens
  // inside CodeGraphBuilder.indexFile — for each container symbol
  // (function, method, class, interface, module) it queries
  // LSP.references and emits a "references" edge for each call site,
  // plus a "calls" edge if both endpoints are callable (function/method).
  //
  // findCallers / findCallees / findReferences all go through the indexed
  // storage — no LSP fallback happens at query time.

  export function findReferences(projectID: ProjectID, symbolId: CodeNodeID): Reference[] {
    const queryId = nextQueryId()
    const edges = CodeGraphQuery.edgesTo(projectID, symbolId, "references")
    return edges.map((e) => ({
      sourceFile: e.file,
      range: {
        start: { line: e.range_start_line, character: e.range_start_char },
        end: { line: e.range_end_line, character: e.range_end_char },
      },
      edgeKind: e.kind,
      explain: buildExplain(e.file, projectID, queryId),
    }))
  }

  export function findCallers(projectID: ProjectID, symbolId: CodeNodeID): CallChainNode[] {
    const queryId = nextQueryId()
    const edges = CodeGraphQuery.edgesTo(projectID, symbolId, "calls")
    const callers: CallChainNode[] = []
    for (const edge of edges) {
      const callerRow = CodeGraphQuery.getNode(projectID, edge.from_node)
      if (callerRow) {
        callers.push({
          symbol: nodeRowToSymbol(callerRow, projectID, queryId),
          depth: 1,
        })
      }
    }
    return callers
  }

  export function findCallees(projectID: ProjectID, symbolId: CodeNodeID): CallChainNode[] {
    const queryId = nextQueryId()
    const edges = CodeGraphQuery.edgesFrom(projectID, symbolId, "calls")
    const callees: CallChainNode[] = []
    for (const edge of edges) {
      const calleeRow = CodeGraphQuery.getNode(projectID, edge.to_node)
      if (calleeRow) {
        callees.push({
          symbol: nodeRowToSymbol(calleeRow, projectID, queryId),
          depth: 1,
        })
      }
    }
    return callees
  }

  // ─── File-level dependencies ────────────────────────────────────────

  export function findImports(projectID: ProjectID, file: string): string[] {
    // Return list of imported module paths. Phase 1 does not have
    // import edges yet (requires Phase 2's edge ingestion), so this
    // returns an empty list. The signature is stable so Phase 2 can
    // populate it without breaking callers.
    const edges = CodeGraphQuery.edgesInFile(projectID, file).filter((e) => e.kind === "imports")
    const targets = new Set<string>()
    for (const edge of edges) {
      const toNode = CodeGraphQuery.getNode(projectID, edge.to_node)
      if (toNode) targets.add(toNode.file)
    }
    return [...targets]
  }

  export function findDependents(projectID: ProjectID, file: string): string[] {
    // Reverse of findImports: which files import from this one.
    // Phase 1 returns empty. Phase 2 populates via import edges.
    const nodesHere = CodeGraphQuery.nodesInFile(projectID, file).map((n) => n.id)
    const importers = new Set<string>()
    for (const nodeId of nodesHere) {
      const edges = CodeGraphQuery.edgesTo(projectID, nodeId, "imports")
      for (const edge of edges) {
        importers.add(edge.file)
      }
    }
    return [...importers]
  }

  // ─── Indexing triggers ──────────────────────────────────────────────

  export async function indexFile(projectID: ProjectID, absPath: string) {
    return CodeGraphBuilder.indexFile(projectID, absPath)
  }

  export async function indexFiles(projectID: ProjectID, files: string[], concurrency?: number) {
    return CodeGraphBuilder.indexFiles(projectID, files, concurrency)
  }

  export function purgeFile(projectID: ProjectID, absPath: string): void {
    CodeGraphBuilder.purgeFile(projectID, absPath)
  }

  // ─── Health / introspection ─────────────────────────────────────────

  export function status(projectID: ProjectID) {
    const cursor = CodeGraphQuery.getCursor(projectID)
    return {
      projectID,
      nodeCount: cursor?.node_count ?? 0,
      edgeCount: cursor?.edge_count ?? 0,
      lastCommitSha: cursor?.commit_sha ?? null,
      lastUpdated: cursor?.time_updated ?? null,
    }
  }

  // Test helper. Production code should not need this — the graph is
  // managed by the indexer. Exposed so tests can assert on a clean
  // slate without going through the private query layer.
  export function __clearProject(projectID: ProjectID): void {
    CodeGraphBuilder.clearProject(projectID)
  }
}
