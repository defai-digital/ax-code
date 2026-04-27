import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { CodeGraphQuery } from "./query"
import { CodeGraphBuilder } from "./builder"
import { CodeGraphWatcher } from "./watcher"
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

  // Query scope for result filtering. "worktree" drops any row whose
  // file lies outside Instance.worktree — the same boundary the other
  // tools enforce via external_directory permission. "none" is the
  // raw unfiltered data, reserved for infrastructure callers (replay
  // snapshots, migration tooling) that need the full index view.
  //
  // The API layer defaults to "none" to stay policy-neutral. The
  // agent-facing tool layer defaults to "worktree". This mirrors how
  // permissions live at the tool surface, not inside query helpers.
  export type Scope = "worktree" | "none"

  function inScope(file: string, scope: Scope): boolean {
    if (scope === "none") return true
    return Instance.containsPath(file)
  }

  function nextQueryId(): string {
    return `q_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
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
    opts?: { kind?: CodeNodeKind; file?: string; limit?: number; scope?: Scope },
  ): Symbol[] {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    const rows = CodeGraphQuery.findNodesByName(projectID, name, opts)
    const filtered = rows.filter((row) => inScope(row.file, scope))
    log.info("findSymbol", {
      projectID,
      name,
      count: filtered.length,
      dropped: rows.length - filtered.length,
      scope,
      queryId,
    })
    return filtered.map((row) => nodeRowToSymbol(row, projectID, queryId))
  }

  export function findSymbolByPrefix(
    projectID: ProjectID,
    prefix: string,
    opts?: { kind?: CodeNodeKind; limit?: number; scope?: Scope },
  ): Symbol[] {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    const rows = CodeGraphQuery.findNodesByNamePrefix(projectID, prefix, opts)
    const filtered = rows.filter((row) => inScope(row.file, scope))
    log.info("findSymbolByPrefix", {
      projectID,
      prefix,
      count: filtered.length,
      dropped: rows.length - filtered.length,
      scope,
      queryId,
    })
    return filtered.map((row) => nodeRowToSymbol(row, projectID, queryId))
  }

  export function getSymbol(projectID: ProjectID, id: CodeNodeID, opts?: { scope?: Scope }): Symbol | null {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    // getNode filters by project_id at the SQL layer — no separate
    // runtime check needed.
    const row = CodeGraphQuery.getNode(projectID, id)
    if (!row) return null
    if (!inScope(row.file, scope)) return null
    return nodeRowToSymbol(row, projectID, queryId)
  }

  // ─── File-level queries ─────────────────────────────────────────────

  export function symbolsInFile(projectID: ProjectID, file: string, opts?: { scope?: Scope }): Symbol[] {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    // If the file itself is out of scope, short-circuit with no rows.
    if (!inScope(file, scope)) return []
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

  export function findReferences(projectID: ProjectID, symbolId: CodeNodeID, opts?: { scope?: Scope }): Reference[] {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    const edges = CodeGraphQuery.edgesTo(projectID, symbolId, "references")
    return edges
      .filter((e) => inScope(e.file, scope))
      .map((e) => ({
        sourceFile: e.file,
        range: {
          start: { line: e.range_start_line, character: e.range_start_char },
          end: { line: e.range_end_line, character: e.range_end_char },
        },
        edgeKind: e.kind,
        explain: buildExplain(e.file, projectID, queryId),
      }))
  }

  export function findCallers(projectID: ProjectID, symbolId: CodeNodeID, opts?: { scope?: Scope }): CallChainNode[] {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    const edges = CodeGraphQuery.edgesTo(projectID, symbolId, "calls")
    const callers: CallChainNode[] = []
    for (const edge of edges) {
      const callerRow = CodeGraphQuery.getNode(projectID, edge.from_node)
      if (!callerRow) continue
      if (!inScope(callerRow.file, scope)) continue
      callers.push({
        symbol: nodeRowToSymbol(callerRow, projectID, queryId),
        depth: 1,
      })
    }
    return callers
  }

  export function findCallees(projectID: ProjectID, symbolId: CodeNodeID, opts?: { scope?: Scope }): CallChainNode[] {
    const queryId = nextQueryId()
    const scope = opts?.scope ?? "none"
    const edges = CodeGraphQuery.edgesFrom(projectID, symbolId, "calls")
    const callees: CallChainNode[] = []
    for (const edge of edges) {
      const calleeRow = CodeGraphQuery.getNode(projectID, edge.to_node)
      if (!calleeRow) continue
      if (!inScope(calleeRow.file, scope)) continue
      callees.push({
        symbol: nodeRowToSymbol(calleeRow, projectID, queryId),
        depth: 1,
      })
    }
    return callees
  }

  // ─── File-level dependencies ────────────────────────────────────────

  export function findImports(projectID: ProjectID, file: string, opts?: { scope?: Scope }): string[] {
    // Return list of imported module paths. Phase 1 does not have
    // import edges yet (requires Phase 2's edge ingestion), so this
    // returns an empty list. The signature is stable so Phase 2 can
    // populate it without breaking callers.
    const scope = opts?.scope ?? "none"
    if (!inScope(file, scope)) return []
    const edges = CodeGraphQuery.edgesInFile(projectID, file).filter((e) => e.kind === "imports")
    const targets = new Set<string>()
    for (const edge of edges) {
      const toNode = CodeGraphQuery.getNode(projectID, edge.to_node)
      if (!toNode) continue
      if (!inScope(toNode.file, scope)) continue
      targets.add(toNode.file)
    }
    return [...targets]
  }

  export function findDependents(projectID: ProjectID, file: string, opts?: { scope?: Scope }): string[] {
    // Reverse of findImports: which files import from this one.
    // Phase 1 returns empty. Phase 2 populates via import edges.
    const scope = opts?.scope ?? "none"
    if (!inScope(file, scope)) return []
    const nodesHere = CodeGraphQuery.nodesInFile(projectID, file).map((n) => n.id)
    const importers = new Set<string>()
    for (const nodeId of nodesHere) {
      const edges = CodeGraphQuery.edgesTo(projectID, nodeId, "imports")
      for (const edge of edges) {
        if (!inScope(edge.file, scope)) continue
        importers.add(edge.file)
      }
    }
    return [...importers]
  }

  // ─── Indexing triggers ──────────────────────────────────────────────

  export async function indexFile(projectID: ProjectID, absPath: string, opts?: CodeGraphBuilder.IndexFileOptions) {
    return CodeGraphBuilder.indexFile(projectID, absPath, opts)
  }

  export async function indexFiles(
    projectID: ProjectID,
    files: string[],
    concurrencyOrOpts?: number | CodeGraphBuilder.IndexFilesOptions,
  ) {
    return CodeGraphBuilder.indexFiles(projectID, files, concurrencyOrOpts ?? 4)
  }

  // Re-export so callers outside the `code-intelligence` module (auto-
  // index, CLI command) can narrow on it without importing the builder
  // directly.
  export const LockHeldError = CodeGraphBuilder.LockHeldError
  export type LockHeldError = CodeGraphBuilder.LockHeldError

  export function purgeFile(projectID: ProjectID, absPath: string): void {
    CodeGraphBuilder.purgeFile(projectID, absPath)
  }

  // ─── Incremental updates via file watcher ────────────────────────────
  //
  // Start the watcher after an initial indexing pass to keep the graph
  // live across file edits. Subscribes to FileWatcher.Event.Updated, so
  // it depends on the FileWatcher subsystem already running (it does by
  // default in an active instance).
  //
  // Idempotent: calling startWatcher twice for the same project is a
  // no-op. stopWatcher clears pending debounce timers and unsubscribes.

  export function startWatcher(projectID: ProjectID): void {
    CodeGraphWatcher.start(projectID)
  }

  export function stopWatcher(projectID: ProjectID): void {
    CodeGraphWatcher.stop(projectID)
  }

  // ─── Health / introspection ─────────────────────────────────────────

  export function status(projectID: ProjectID) {
    // `code_index_cursor` is a summary row written only at the END of a
    // full `indexFiles()` batch — see `builder.ts:upsertCursor`. The
    // incremental watcher (`indexFile` on save) never touches it, an
    // interrupted `ax-code index` run never reaches it, and
    // `clearProject` never resets it. Reading counts from the cursor
    // is therefore unreliable: a user who Ctrl-C's out of `ax-code
    // index` ends up with thousands of rows in `code_node` but a
    // missing / zero cursor row, and the TUI sidebar shows "graph
    // not indexed · run `ax-code index`" forever because the endpoint
    // below read the stale cursor.
    //
    // `countNodes` / `countEdges` run `SELECT count(*) WHERE
    // project_id = ?` against an indexed column (see
    // `code_node_project_idx`, `code_edge_project_idx` in
    // `schema.sql.ts`) — a few ms even on 200K-row graphs. Cheap
    // enough for the ~5s TUI poll. The cursor's `commit_sha` and
    // `time_updated` still carry meaning (they mark the last
    // successful full-index run and are used by plan-staleness
    // detection in `apply-safe-refactor.ts`), so we keep reading
    // them — only the counts switch to live.
    //
    // The same fix landed in `cli/cmd/index-graph.ts`'s heartbeat
    // in v2.3.9 for the same reason. Every reader of `nodeCount` /
    // `edgeCount` should use live queries, not the cached summary.
    const cursor = CodeGraphQuery.getCursor(projectID)
    return {
      projectID,
      nodeCount: CodeGraphQuery.countNodes(projectID),
      edgeCount: CodeGraphQuery.countEdges(projectID),
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

  // ─── Envelope builder (Semantic Trust v2 §S4) ──────────────────────
  //
  // AI-facing semantic surfaces are expected to return SemanticEnvelope
  // so AI consumers can inspect provenance (source, timestamp, freshness
  // via LSP.envelopeFreshness). The code-graph path is one such source.
  //
  // `graphEnvelope` wraps any payload in an envelope stamped with the
  // graph's cursor timestamp — consumer can then evaluate how old the
  // graph index is and decide whether to trust it or cross-check via
  // the live LSP tool. This is deliberately *not* a fallback router:
  // the tool is graph-only by design; freshness information is the
  // contract we make with consumers so they can route themselves.
  export type GraphEnvelope<T> = {
    data: T
    source: "graph"
    completeness: "full" | "partial" | "empty"
    timestamp: number
    serverIDs: string[]
    degraded?: boolean
  }

  // Wrap a code-graph query result in an envelope stamped with
  // provenance. `timestamp` is the graph's last-indexed time (from
  // code_index_cursor). `degraded` is true when the cursor is missing
  // — i.e. the graph may have rows but was never completed cleanly
  // (partial index from an interrupted run, clearProject without
  // reindex, etc.). `completeness` is "empty" when the payload is an
  // empty array/object, "full" otherwise. `partial` is not produced
  // here — the graph doesn't have a mid-flight partial concept; a
  // query either has results or doesn't.
  export function graphEnvelope<T>(projectID: ProjectID, data: T, opts?: { isEmpty?: boolean }): GraphEnvelope<T> {
    const cursor = CodeGraphQuery.getCursor(projectID)
    // Without a cursor we still return what we have, but mark as
    // degraded so consumers know to treat the payload with caution.
    const timestamp = cursor?.time_updated ?? Date.now()
    const degraded = cursor === undefined
    const isEmpty = opts?.isEmpty ?? isPayloadEmpty(data)
    return {
      data,
      source: "graph",
      completeness: isEmpty ? "empty" : "full",
      timestamp,
      serverIDs: [],
      degraded,
    }
  }

  function isPayloadEmpty(data: unknown): boolean {
    if (data == null) return true
    if (Array.isArray(data)) return data.length === 0
    return false
  }
}
