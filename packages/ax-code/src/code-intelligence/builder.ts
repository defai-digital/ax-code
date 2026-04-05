import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { LSP } from "../lsp"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { LANGUAGE_EXTENSIONS } from "../lsp/language"
import { Database } from "../storage/db"
import { CodeGraphQuery } from "./query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "./id"
import { IndexLock } from "./lockfile"
import type { CodeNodeKind, CodeEdgeKind } from "./schema.sql"
import type { ProjectID } from "../project/schema"

const log = Log.create({ service: "code-intelligence.builder" })

// LSP's textDocument/documentSymbol returns DocumentSymbol objects with
// a numeric `kind` field matching the LSP spec SymbolKind enum.
// https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
//
// We mirror the subset that's relevant for code reasoning and map each
// to our lowest-common-denominator CodeNodeKind. Kinds we don't care
// about (File, Namespace, Property, String, Number, Boolean, Array, ...)
// are filtered out entirely — they add storage cost without improving
// agent accuracy.
const LSP_SYMBOL_KIND_MAP: Record<number, CodeNodeKind | undefined> = {
  2: "module", // Module
  4: "module", // Package
  5: "class",
  6: "method",
  7: "variable", // Property — treated as a field-like variable
  8: "variable", // Field
  9: "method", // Constructor
  10: "enum",
  11: "interface",
  12: "function",
  13: "variable",
  14: "constant",
  22: "constant", // EnumMember
  23: "class", // Struct
}

// Language detection: first look up the extension in the LSP language
// map (the same table client.ts uses for language IDs). Fall back to
// "plaintext" for files LSP doesn't know about — these won't be
// indexed.
function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath)
  return LANGUAGE_EXTENSIONS[ext] ?? "plaintext"
}

// LSP response shapes are loosely typed in our codebase (`as any` in a
// few places). We define minimal structural types here to narrow what
// the builder actually reads, so schema drift in LSP responses fails
// loudly at the boundary rather than silently at query time.
type LspPosition = { line: number; character: number }
type LspRange = { start: LspPosition; end: LspPosition }
type LspDocumentSymbol = {
  name: string
  detail?: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}
type LspSymbolInformation = {
  name: string
  kind: number
  location: { uri: string; range: LspRange }
  containerName?: string
}
type LspLocation = {
  uri: string
  range: LspRange
}

function isDocumentSymbol(s: LspDocumentSymbol | LspSymbolInformation): s is LspDocumentSymbol {
  return typeof (s as LspDocumentSymbol).range?.start?.line === "number" && !("location" in s)
}

// Given a position in a file, return the innermost node whose range covers
// it. "Innermost" = smallest range that still contains the position, which
// is the most specific enclosing scope. Used to attribute LSP reference
// results to their containing function/method/class.
//
// Two variants: one for in-flight inserts (same-file references when the
// current file's nodes aren't yet in the DB), one for the DB (cross-file
// references to already-indexed files).

function resolveContainingNodeInMemory(
  nodeInserts: Array<{
    id: CodeNodeID
    name: string
    file: string
    range_start_line: number
    range_start_char: number
    range_end_line: number
    range_end_char: number
    kind: CodeNodeKind
  }>,
  bookmarks: Array<{ nodeId: CodeNodeID; kind: CodeNodeKind }>,
  line: number,
  char: number,
): CodeNodeID | undefined {
  const bookmarkKind = new Map(bookmarks.map((b) => [b.nodeId, b.kind]))
  let best: { id: CodeNodeID; size: number } | undefined
  for (const node of nodeInserts) {
    const kind = bookmarkKind.get(node.id)
    if (!kind || !isNamedContainer(node.name, kind)) continue
    if (!rangeContains(node, line, char)) continue
    const size = (node.range_end_line - node.range_start_line) * 1000 + (node.range_end_char - node.range_start_char)
    if (!best || size < best.size) {
      best = { id: node.id, size }
    }
  }
  return best?.id
}

// Exported for testing. Not part of the public surface. See builder.test.ts.
export { resolveContainingNodeFromDb as __resolveContainingNodeFromDbForTests }
function resolveContainingNodeFromDb(
  projectID: ProjectID,
  file: string,
  line: number,
  char: number,
): CodeNodeID | undefined {
  const rows = CodeGraphQuery.nodesInFile(projectID, file)
  let best: { id: CodeNodeID; size: number } | undefined
  for (const row of rows) {
    if (!isNamedContainer(row.name, row.kind)) continue
    if (!rangeContains(row, line, char)) continue
    const size = (row.range_end_line - row.range_start_line) * 1000 + (row.range_end_char - row.range_start_char)
    if (!best || size < best.size) {
      best = { id: row.id, size }
    }
  }
  return best?.id
}

// Look up a caller's kind for the isCallable decision. Same-file callers
// live in the in-memory refBookmarks built earlier in this indexing pass;
// cross-file callers have to be read back from the DB. Returning undefined
// for a valid node id would be a silent bug — every call site across file
// boundaries would lose its calls edge — so this helper is extracted and
// unit-tested independently of the full builder pipeline (which requires
// a running LSP server).
//
// Exported for testing. Not part of the public surface.
export function __lookupCallerKind(
  projectID: ProjectID,
  callerNodeId: CodeNodeID,
  sameFile: boolean,
  bookmarks: Array<{ nodeId: CodeNodeID; kind: CodeNodeKind }>,
): CodeNodeKind | undefined {
  if (sameFile) {
    return bookmarks.find((b) => b.nodeId === callerNodeId)?.kind
  }
  return CodeGraphQuery.getNode(projectID, callerNodeId)?.kind
}

function rangeContains(
  r: { range_start_line: number; range_start_char: number; range_end_line: number; range_end_char: number },
  line: number,
  char: number,
): boolean {
  if (line < r.range_start_line || line > r.range_end_line) return false
  if (line === r.range_start_line && char < r.range_start_char) return false
  if (line === r.range_end_line && char > r.range_end_char) return false
  return true
}

// Walk a documentSymbol tree depth-first, emitting (symbol, parentQualifiedName)
// pairs. Parent tracking lets us build qualified names like
// "SessionCompaction::isOverflow" for disambiguation.
//
// Bounded by MAX_SYMBOL_DEPTH to protect against malformed or adversarial
// LSP responses that contain cycles in the children array. LSP's spec does
// not forbid cycles; a buggy server could return a symbol whose children
// reference itself and produce infinite recursion. Real code is never this
// deep — 64 levels of nested scopes is already absurd.
const MAX_SYMBOL_DEPTH = 64

// Cap on how many symbols per file get reference queries. LSP reference
// queries can be expensive (O(project size) for common symbols), and doing
// them for every symbol in a 1000-symbol file is O(file_size × project_size).
// Phase 2 caps this at a number of the largest-range symbols first (which
// are typically top-level definitions). Small inner helpers get skipped.
const MAX_REFERENCE_QUERIES_PER_FILE = 100

// Kinds that are "containers" — edges can terminate inside them. A reference
// at line N is attributed to the innermost container whose range covers N.
// Fields, properties, constants, parameters are excluded because they're
// not meaningful "callers" in a call graph.
const CONTAINER_KINDS = new Set(["function", "method", "class", "interface", "module"])

// Names tsserver emits for anonymous symbols — "<function>" for anonymous
// function literals (arrow functions assigned to properties, IIFEs, etc.),
// "<unknown>" for variables with unparseable names. These are useless as
// navigation targets: saying "called by <function>" tells the user nothing.
// When picking a container for a reference, we skip these in favor of an
// enclosing named symbol, even if the anonymous one is the tighter match.
const ANONYMOUS_NAMES = new Set(["<function>", "<unknown>", ""])

function isNamedContainer(name: string, kind: string): boolean {
  if (!CONTAINER_KINDS.has(kind)) return false
  return !ANONYMOUS_NAMES.has(name)
}

// Kinds that are "callable" — a call edge is only emitted when both endpoints
// are callable. Otherwise the edge is a plain reference.
const CALLABLE_KINDS = new Set(["function", "method"])

function* walkDocumentSymbols(
  symbols: LspDocumentSymbol[],
  parentQualified: string,
  depth = 0,
): Generator<{ symbol: LspDocumentSymbol; parentQualified: string }> {
  if (depth > MAX_SYMBOL_DEPTH) return
  for (const symbol of symbols) {
    yield { symbol, parentQualified }
    if (symbol.children && symbol.children.length > 0) {
      const nextParent = parentQualified ? `${parentQualified}::${symbol.name}` : symbol.name
      yield* walkDocumentSymbols(symbol.children, nextParent, depth + 1)
    }
  }
}

export namespace CodeGraphBuilder {
  // Project-level mutex. Concurrent `indexFile` calls for the same
  // project would otherwise race: one transaction can read stale
  // cross-file caller nodes that a sibling transaction has already
  // deleted, silently dropping edges from the graph. SQLite's WAL
  // mode prevents deadlocks but not this read-your-own-transaction
  // skew, so we serialize at the project level. Different projects
  // still run in parallel.
  const projectMutexes = new Map<string, Promise<unknown>>()
  async function withProjectLock<T>(projectID: ProjectID, fn: () => Promise<T>): Promise<T> {
    const prev = projectMutexes.get(projectID) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    projectMutexes.set(
      projectID,
      next.catch(() => {}),
    )
    return next
  }

  // Index a single file: extract its symbols via LSP and upsert them as
  // graph nodes. Replaces any existing nodes/edges for the file in an
  // atomic delete-then-insert pattern. Safe to call repeatedly — later
  // calls supersede earlier ones for the same (project, file).
  //
  // Returns the number of nodes inserted, or 0 if the file was skipped
  // (language not supported, LSP unavailable, empty symbol list). Never
  // throws on per-file errors; errors are logged and the builder
  // continues.
  // Per-phase wall-clock breakdown returned alongside the index result.
  // Consumers (the CLI index command, benchmarks, future profiling tools)
  // can sum these across a batch to see where time actually goes. Kept
  // always-on because performance.now() costs ~100ns and the visibility
  // is worth it.
  export type IndexTimings = {
    readFile: number
    lspTouch: number
    lspDocumentSymbol: number
    symbolWalk: number
    lspReferences: number
    edgeResolve: number
    dbTransaction: number
    total: number
  }

  export function indexFile(
    projectID: ProjectID,
    absPath: string,
  ): Promise<{ nodes: number; edges: number; completeness: "full" | "partial" | "lsp-only"; timings: IndexTimings }> {
    // Serialize per-project to prevent cross-file caller resolution
    // from reading stale nodes that a sibling transaction has already
    // deleted. See the projectMutexes comment at the top of the
    // namespace.
    return withProjectLock(projectID, () => indexFileLocked(projectID, absPath))
  }

  async function indexFileLocked(
    projectID: ProjectID,
    absPath: string,
  ): Promise<{ nodes: number; edges: number; completeness: "full" | "partial" | "lsp-only"; timings: IndexTimings }> {
    const timings: IndexTimings = {
      readFile: 0,
      lspTouch: 0,
      lspDocumentSymbol: 0,
      symbolWalk: 0,
      lspReferences: 0,
      edgeResolve: 0,
      dbTransaction: 0,
      total: 0,
    }
    const tStart = performance.now()

    const lang = detectLanguage(absPath)
    if (lang === "plaintext") {
      log.info("skipping file, language not recognized", { file: absPath })
      timings.total = performance.now() - tStart
      return { nodes: 0, edges: 0, completeness: "partial", timings }
    }

    // Read once for hash + size. If the file doesn't exist, caller
    // probably wants us to purge it — but that's the purge API, not
    // the index API, so we just return zero.
    const tRead = performance.now()
    const exists = await Filesystem.exists(absPath)
    if (!exists) {
      log.info("skipping file, does not exist", { file: absPath })
      timings.total = performance.now() - tStart
      return { nodes: 0, edges: 0, completeness: "partial", timings }
    }
    const text = await Filesystem.readText(absPath).catch((err) => {
      log.error("failed to read file for indexing", { file: absPath, err })
      return undefined
    })
    if (text === undefined) {
      timings.total = performance.now() - tStart
      return { nodes: 0, edges: 0, completeness: "partial", timings }
    }
    timings.readFile = performance.now() - tRead

    const sha = Bun.hash(text).toString()
    const size = text.length

    // Touch the file through LSP so the server has it open before we
    // query documentSymbol. This also ensures diagnostics arrive, but
    // we don't wait for them — we only need the symbol info.
    const tTouch = performance.now()
    await LSP.touchFile(absPath, false)
    timings.lspTouch = performance.now() - tTouch

    // Pull document symbols. LSP.documentSymbol returns a flat array
    // of results (one per matching client) that we flatten and walk.
    const uri = pathToFileURL(absPath).href
    const tDocSym = performance.now()
    const raw = (await LSP.documentSymbol(uri).catch((err) => {
      log.error("LSP.documentSymbol failed", { file: absPath, err })
      return []
    })) as Array<LspDocumentSymbol | LspSymbolInformation>
    timings.lspDocumentSymbol = performance.now() - tDocSym

    // Build the new node list outside the transaction so we don't hold
    // the DB lock while walking LSP output. The delete + insert + upsert
    // then happens inside one transaction below.
    const nodeInserts: Parameters<typeof CodeGraphQuery.insertNodes>[0] = []
    // Bookmarks: per-node info needed for the Phase 2 reference pass.
    // We keep the LSP selectionRange (= the name identifier position, not
    // the full declaration range) because that's what textDocument/references
    // expects as its position argument.
    type ReferenceBookmark = {
      nodeId: CodeNodeID
      kind: CodeNodeKind
      selectionLine: number
      selectionChar: number
      // Range of the node itself — used to exclude self-references from
      // the edge list.
      rangeStartLine: number
      rangeEndLine: number
    }
    const refBookmarks: ReferenceBookmark[] = []
    let nodeCount = 0
    const now = Date.now()
    const tWalk = performance.now()

    if (raw.length > 0) {
      // LSP may return DocumentSymbol[] (hierarchical) or
      // SymbolInformation[] (flat). Handle both.
      const first = raw[0]
      if (first && isDocumentSymbol(first)) {
        for (const { symbol, parentQualified } of walkDocumentSymbols(raw as LspDocumentSymbol[], "")) {
          const kind = LSP_SYMBOL_KIND_MAP[symbol.kind]
          if (!kind) continue
          const qualified = parentQualified ? `${parentQualified}::${symbol.name}` : symbol.name
          const nodeId = CodeNodeID.ascending()
          nodeInserts.push({
            id: nodeId,
            project_id: projectID,
            kind,
            name: symbol.name,
            qualified_name: qualified,
            file: absPath,
            range_start_line: symbol.range.start.line,
            range_start_char: symbol.range.start.character,
            range_end_line: symbol.range.end.line,
            range_end_char: symbol.range.end.character,
            signature: symbol.detail ?? null,
            visibility: null,
            metadata: null,
            time_created: now,
            time_updated: now,
          })
          refBookmarks.push({
            nodeId,
            kind,
            selectionLine: symbol.selectionRange.start.line,
            selectionChar: symbol.selectionRange.start.character,
            rangeStartLine: symbol.range.start.line,
            rangeEndLine: symbol.range.end.line,
          })
          nodeCount++
        }
      } else {
        // SymbolInformation[] path. No parent hierarchy, containerName
        // gives us a qualifier. No selectionRange either, so we fall back
        // to the location range start — less precise but LSP typically
        // accepts it for symbols with unambiguous names.
        for (const s of raw as LspSymbolInformation[]) {
          const kind = LSP_SYMBOL_KIND_MAP[s.kind]
          if (!kind) continue
          const qualified = s.containerName ? `${s.containerName}::${s.name}` : s.name
          const nodeId = CodeNodeID.ascending()
          nodeInserts.push({
            id: nodeId,
            project_id: projectID,
            kind,
            name: s.name,
            qualified_name: qualified,
            file: absPath,
            range_start_line: s.location.range.start.line,
            range_start_char: s.location.range.start.character,
            range_end_line: s.location.range.end.line,
            range_end_char: s.location.range.end.character,
            signature: null,
            visibility: null,
            metadata: null,
            time_created: now,
            time_updated: now,
          })
          refBookmarks.push({
            nodeId,
            kind,
            selectionLine: s.location.range.start.line,
            selectionChar: s.location.range.start.character,
            rangeStartLine: s.location.range.start.line,
            rangeEndLine: s.location.range.end.line,
          })
          nodeCount++
        }
      }
    }

    // ─── Phase 2 reference pass ─────────────────────────────────────
    //
    // For each "container" symbol (function, method, class, interface,
    // module), query LSP for references to its selection position. Each
    // reference becomes a "references" edge, and if both endpoints are
    // callable (function/method), also a "calls" edge.
    //
    // Two safeguards:
    //   - Cap the number of reference queries per file via
    //     MAX_REFERENCE_QUERIES_PER_FILE. We sort by range size descending
    //     so the biggest top-level symbols get queried first; small inner
    //     helpers are dropped.
    //   - The references return uri+range of each call site. We attribute
    //     each call site to the innermost node in our graph whose range
    //     covers the position. If no node matches (e.g. the call site is
    //     in an unindexed file), the edge is skipped.
    //
    // LSP RPCs happen outside the transaction below so we don't hold the
    // DB lock on network I/O.

    timings.symbolWalk = performance.now() - tWalk

    const edgeInserts: Parameters<typeof CodeGraphQuery.insertEdges>[0] = []

    // Sort bookmarks by range size descending — biggest (top-level)
    // symbols first. We query only the top
    // MAX_REFERENCE_QUERIES_PER_FILE to keep reference traffic bounded.
    const eligibleBookmarks = refBookmarks
      .filter((b) => CONTAINER_KINDS.has(b.kind))
      .sort((a, b) => (b.rangeEndLine - b.rangeStartLine) - (a.rangeEndLine - a.rangeStartLine))
      .slice(0, MAX_REFERENCE_QUERIES_PER_FILE)

    // Determine completeness: "full" if every eligible symbol had its
    // references queried, "lsp-only" if the file was indexed but with
    // nodes only, "partial" if LSP returned nothing.
    let completeness: "full" | "partial" | "lsp-only" = raw.length === 0 ? "partial" : "lsp-only"

    if (eligibleBookmarks.length > 0) {
      // Resolve each bookmark's references. Parallelism is bounded by
      // LSP.references itself (each call hits the underlying LSP server
      // which has its own concurrency limits). For very large files we
      // could limit further here, but 100 queries in parallel is
      // reasonable for typical projects.
      const tRefs = performance.now()
      const refResults = await Promise.all(
        eligibleBookmarks.map(async (bookmark) => {
          const locations = (await LSP.references({
            file: absPath,
            line: bookmark.selectionLine,
            character: bookmark.selectionChar,
          }).catch(() => [])) as LspLocation[]
          return { bookmark, locations }
        }),
      )
      timings.lspReferences = performance.now() - tRefs

      const tResolve = performance.now()
      for (const { bookmark, locations } of refResults) {
        for (const loc of locations) {
          let refFile: string
          try {
            refFile = fileURLToPath(loc.uri)
          } catch {
            continue
          }
          // Skip self-references (the symbol's own declaration).
          if (
            refFile === absPath &&
            loc.range.start.line >= bookmark.rangeStartLine &&
            loc.range.start.line <= bookmark.rangeEndLine
          ) {
            continue
          }
          // Resolve which node in the graph (the "caller") contains this
          // reference location. Uses the pre-insert nodeInserts for
          // same-file lookups (since nodes aren't in the DB yet) and
          // falls back to CodeGraphQuery for other files.
          const sameFile = refFile === absPath
          const callerNodeId = sameFile
            ? resolveContainingNodeInMemory(nodeInserts, refBookmarks, loc.range.start.line, loc.range.start.character)
            : resolveContainingNodeFromDb(projectID, refFile, loc.range.start.line, loc.range.start.character)
          if (!callerNodeId) continue

          // Determine the caller's kind. Same-file callers come from the
          // in-memory bookmarks built earlier in this pass. Cross-file
          // callers have to be read back from the DB — we can't skip
          // them here, otherwise findCallers silently loses every edge
          // whose endpoints span two files (which is the common case
          // for any non-trivial codebase). See __lookupCallerKind.
          const callerKind = __lookupCallerKind(projectID, callerNodeId, sameFile, refBookmarks)
          const isCallable =
            bookmark.kind && CALLABLE_KINDS.has(bookmark.kind) && callerKind && CALLABLE_KINDS.has(callerKind)

          edgeInserts.push({
            id: CodeEdgeID.ascending(),
            project_id: projectID,
            kind: "references",
            from_node: callerNodeId,
            to_node: bookmark.nodeId,
            file: refFile,
            range_start_line: loc.range.start.line,
            range_start_char: loc.range.start.character,
            range_end_line: loc.range.end.line,
            range_end_char: loc.range.end.character,
            time_created: now,
            time_updated: now,
          })
          if (isCallable) {
            edgeInserts.push({
              id: CodeEdgeID.ascending(),
              project_id: projectID,
              kind: "calls",
              from_node: callerNodeId,
              to_node: bookmark.nodeId,
              file: refFile,
              range_start_line: loc.range.start.line,
              range_start_char: loc.range.start.character,
              range_end_line: loc.range.end.line,
              range_end_char: loc.range.end.character,
              time_created: now,
              time_updated: now,
            })
          }
        }
      }

      // If we ran reference queries and LSP gave us results, mark the
      // file as fully indexed. If all reference queries returned empty,
      // it's still "lsp-only" — the server supports symbols but not
      // references (or there genuinely are none).
      if (edgeInserts.length > 0) completeness = "full"
      timings.edgeResolve = performance.now() - tResolve
    }

    // All DB mutations for this file happen atomically. Without the
    // transaction, a concurrent reader could see nodes without their
    // edges, or a partially-deleted file, or a new code_file row with
    // stale node rows underneath it. Transactions are cheap on SQLite
    // and the whole block is CPU-bound (no await inside), so wrapping
    // it has no latency cost.
    const tTxn = performance.now()
    Database.transaction((_tx) => {
      CodeGraphQuery.deleteEdgesTouchingFile(projectID, absPath)
      CodeGraphQuery.deleteNodesInFile(projectID, absPath)

      // Bulk insert. SQLite's multi-row insert is fast but has a 999-
      // parameter default limit; our row has ~14 columns so we chunk
      // at 50 rows per statement as a safe margin.
      for (let i = 0; i < nodeInserts.length; i += 50) {
        CodeGraphQuery.insertNodes(nodeInserts.slice(i, i + 50))
      }

      // Insert edges. Edge rows have ~12 columns; 60/chunk stays well
      // under the 999 SQLite parameter limit.
      for (let i = 0; i < edgeInserts.length; i += 60) {
        CodeGraphQuery.insertEdges(edgeInserts.slice(i, i + 60))
      }

      // Record file state regardless of whether we found symbols — we
      // still want to know we tried, so incremental updates can skip
      // unchanged files without re-running LSP.
      CodeGraphQuery.upsertFile({
        id: CodeFileID.ascending(),
        project_id: projectID,
        path: absPath,
        sha,
        size,
        lang,
        indexed_at: now,
        completeness,
        time_created: now,
        time_updated: now,
      })
    })
    timings.dbTransaction = performance.now() - tTxn
    timings.total = performance.now() - tStart

    log.info("indexed file", { file: absPath, nodes: nodeCount, edges: edgeInserts.length, completeness })
    return { nodes: nodeCount, edges: edgeInserts.length, completeness, timings }
  }

  // Options passed to indexFiles. `onProgress` fires after each
  // completed batch with the running count. `lock` controls the
  // cross-process lockfile behavior (see IndexLock) — callers that
  // need to cooperate with other ax-code processes set this to
  // "acquire" (wait) or "try" (skip if held). "none" skips the lock
  // entirely and is reserved for tests that run in isolated temp
  // directories.
  export type IndexFilesOptions = {
    concurrency?: number
    onProgress?: (completed: number, total: number) => void
    lock?: "acquire" | "try" | "none"
    lockTimeoutMs?: number
    onLockWait?: () => void
  }

  // Raised when `lock: "try"` is requested and another process holds
  // the lock. Callers (auto-index) swallow this silently; the CLI
  // never passes "try".
  export class LockHeldError extends Error {
    constructor(public readonly projectID: ProjectID) {
      super(`code-index lock held by another process for project ${projectID}`)
      this.name = "LockHeldError"
    }
  }

  // Index a batch of files with a concurrency cap. Returns cumulative
  // counts. The cap exists because each indexFile call can trigger LSP
  // RPCs and we don't want to saturate slow servers; 4 concurrent files
  // is a conservative default.
  //
  // The batch runs inside a cross-process advisory lock (see
  // code-intelligence/lockfile.ts). Without it, `ax-code index` in one
  // terminal and auto-index in another terminal's TUI could race on
  // SQLite upserts, blow past the 5s busy_timeout, and leave one
  // writer with a half-populated graph. The per-file `indexFile` call
  // is NOT wrapped because the watcher fires it on every save and
  // blocking on a cross-process lock would kill editor responsiveness.
  export async function indexFiles(
    projectID: ProjectID,
    files: string[],
    concurrencyOrOpts: number | IndexFilesOptions = 4,
  ): Promise<{
    nodes: number
    edges: number
    files: number
    skipped: number
    failed: number
    timings: IndexTimings
  }> {
    const opts: IndexFilesOptions =
      typeof concurrencyOrOpts === "number" ? { concurrency: concurrencyOrOpts } : concurrencyOrOpts
    const concurrency = opts.concurrency ?? 4
    const lockMode = opts.lock ?? "acquire"

    let lockHandle: Disposable | undefined
    if (lockMode === "acquire") {
      lockHandle = await IndexLock.acquire(projectID, {
        timeoutMs: opts.lockTimeoutMs ?? 10 * 60 * 1000,
        onWait: opts.onLockWait,
      })
    }
    if (lockMode === "try") {
      lockHandle = await IndexLock.tryAcquire(projectID)
      if (!lockHandle) throw new LockHeldError(projectID)
    }

    try {
      return await indexFilesLocked(projectID, files, concurrency, opts.onProgress)
    } finally {
      lockHandle?.[Symbol.dispose]()
    }
  }

  async function indexFilesLocked(
    projectID: ProjectID,
    files: string[],
    concurrency: number,
    onProgress: ((completed: number, total: number) => void) | undefined,
  ): Promise<{
    nodes: number
    edges: number
    files: number
    skipped: number
    failed: number
    timings: IndexTimings
  }> {
    let nodes = 0
    let edges = 0
    let indexed = 0
    let skipped = 0
    let failed = 0
    const aggregate: IndexTimings = {
      readFile: 0,
      lspTouch: 0,
      lspDocumentSymbol: 0,
      symbolWalk: 0,
      lspReferences: 0,
      edgeResolve: 0,
      dbTransaction: 0,
      total: 0,
    }
    const emptyTimings: IndexTimings = { ...aggregate }

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      const results = await Promise.all(
        batch.map((file) =>
          // Use a distinct `failed` marker so the stats loop below can
          // tell a real crash (exception bubbled up through indexFile)
          // apart from an intentional partial/skip. The previous code
          // returned `partial` for both and counted the failure as
          // "skipped", hiding genuine indexing errors behind benign
          // ones in the reported totals.
          indexFile(projectID, file).catch((err) => {
            log.error("indexFile failed", { file, err })
            return { nodes: 0, edges: 0, completeness: "failed" as const, timings: emptyTimings }
          }),
        ),
      )
      for (const r of results) {
        nodes += r.nodes
        edges += r.edges
        if (r.completeness === ("failed" as string)) failed++
        else if (r.nodes > 0 || r.completeness !== "partial") indexed++
        else skipped++
        // Aggregate per-phase timings. These are wall-clock per file,
        // so summing across a batch of size N that ran in parallel
        // over-counts by up to N×. That's fine for identifying which
        // phase dominates — the ratios are what matter.
        aggregate.readFile += r.timings.readFile
        aggregate.lspTouch += r.timings.lspTouch
        aggregate.lspDocumentSymbol += r.timings.lspDocumentSymbol
        aggregate.symbolWalk += r.timings.symbolWalk
        aggregate.lspReferences += r.timings.lspReferences
        aggregate.edgeResolve += r.timings.edgeResolve
        aggregate.dbTransaction += r.timings.dbTransaction
        aggregate.total += r.timings.total
      }
      onProgress?.(Math.min(i + concurrency, files.length), files.length)
    }

    const totalNodes = CodeGraphQuery.countNodes(projectID)
    const totalEdges = CodeGraphQuery.countEdges(projectID)
    CodeGraphQuery.upsertCursor(projectID, null, totalNodes, totalEdges)

    // Refresh SQLite planner statistics after a full indexing batch.
    // Without this, the planner has no row counts and picks poor plans:
    // e.g. edgesTo was using code_edge_project_kind_idx (7 distinct
    // values) instead of code_edge_to_idx (unique per node) because it
    // had no data to tell them apart. ANALYZE is cheap (~100ms on a
    // 450k-edge graph) and its output persists in sqlite_stat1 across
    // DB opens, so this one call per index pass is enough.
    CodeGraphQuery.analyze()

    return { nodes, edges, files: indexed, skipped, failed, timings: aggregate }
  }

  // Remove all graph state for a single file. Used when a file is
  // deleted from disk or moved out of scope.
  //
  // Wrap the three deletes in a single transaction so a crash (or SQL
  // error) between them cannot leave orphaned edges/nodes referring to
  // a file record that's already gone, or vice-versa. Matches the
  // pattern used by `Session.remove` and `Session.revert`.
  export function purgeFile(projectID: ProjectID, absPath: string): void {
    Database.transaction(() => {
      CodeGraphQuery.deleteEdgesTouchingFile(projectID, absPath)
      CodeGraphQuery.deleteNodesInFile(projectID, absPath)
      CodeGraphQuery.deleteFile(projectID, absPath)
    })
    log.info("purged file from graph", { file: absPath })
  }

  // Test helper: wipe a project's entire graph state. Exposed so tests
  // can assert on a clean slate without touching the query layer
  // directly.
  export function clearProject(projectID: ProjectID): void {
    CodeGraphQuery.clearProject(projectID)
    log.info("cleared project graph", { projectID })
  }
}
