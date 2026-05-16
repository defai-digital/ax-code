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
import { Flag } from "../flag/flag"
import { NativeStore } from "./native-store"
import type { CodeNodeKind, CodeEdgeKind } from "./schema.sql"
import type { ProjectID } from "../project/schema"
import { INDEXER_SEMANTIC_METHODS } from "../lsp/prewarm-profile"

const log = Log.create({ service: "code-intelligence.builder" })
const SYMBOL_RANGE_SCALE = 1000
const MAX_BOOKMARKS_PER_REFERENCE_QUERY = 50

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

type ReferenceBookmark = {
  nodeId: CodeNodeID
  kind: CodeNodeKind
  selectionLine: number
  selectionChar: number
  rangeStartLine: number
  rangeEndLine: number
}

type ReferenceQuery = {
  selectionLine: number
  selectionChar: number
  bookmarks: ReferenceBookmark[]
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
  nativeTree?: any,
): CodeNodeID | undefined {
  // Native fast-path: use Rust IntervalTree for O(log n) lookup
  if (nativeTree) {
    const result = nativeTree.findInnermostContainer(line, char)
    return result ? (result as CodeNodeID) : undefined
  }

  const bookmarkKind = new Map(bookmarks.map((b) => [b.nodeId, b.kind]))
  let best: { id: CodeNodeID; size: number } | undefined
  for (const node of nodeInserts) {
    const kind = bookmarkKind.get(node.id)
    if (!kind || !isNamedContainer(node.name, kind)) continue
    if (!rangeContains(node, line, char)) continue
    const size =
      (node.range_end_line - node.range_start_line) * SYMBOL_RANGE_SCALE + (node.range_end_char - node.range_start_char)
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
  return resolveContainingNodeFromRows(rows, line, char)
}

function resolveContainingNodeFromRows(
  rows: Array<{
    id: CodeNodeID
    name: string
    kind: CodeNodeKind
    range_start_line: number
    range_start_char: number
    range_end_line: number
    range_end_char: number
  }>,
  line: number,
  char: number,
): CodeNodeID | undefined {
  let best: { id: CodeNodeID; size: number } | undefined
  for (const row of rows) {
    if (!isNamedContainer(row.name, row.kind)) continue
    if (!rangeContains(row, line, char)) continue
    const size =
      (row.range_end_line - row.range_start_line) * SYMBOL_RANGE_SCALE + (row.range_end_char - row.range_start_char)
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
const REFERENCE_QUERY_CONCURRENCY = 8

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

function referenceRangeSize(bookmark: Pick<ReferenceBookmark, "rangeStartLine" | "rangeEndLine">): number {
  return bookmark.rangeEndLine - bookmark.rangeStartLine
}

function referenceKindPriority(kind: CodeNodeKind): number {
  if (CALLABLE_KINDS.has(kind)) return 2
  if (CONTAINER_KINDS.has(kind)) return 1
  return 0
}

function planReferenceQueries(bookmarks: ReferenceBookmark[], limit: number): ReferenceQuery[] {
  const planned: ReferenceQuery[] = []
  const byKey = new Map<string, ReferenceQuery>()
  const eligible = bookmarks
    .filter((bookmark) => CONTAINER_KINDS.has(bookmark.kind))
    .sort((a, b) => {
      const priority = referenceKindPriority(b.kind) - referenceKindPriority(a.kind)
      if (priority !== 0) return priority
      return referenceRangeSize(b) - referenceRangeSize(a)
    })

  for (const bookmark of eligible) {
    const key = `${bookmark.selectionLine}:${bookmark.selectionChar}`
    const existing = byKey.get(key)
    if (existing) {
      if (existing.bookmarks.length < MAX_BOOKMARKS_PER_REFERENCE_QUERY) existing.bookmarks.push(bookmark)
      continue
    }
    if (planned.length >= limit) continue

    const query = {
      selectionLine: bookmark.selectionLine,
      selectionChar: bookmark.selectionChar,
      bookmarks: [bookmark],
    }
    byKey.set(key, query)
    planned.push(query)
  }

  return planned
}

export function __planReferenceQueriesForTest(
  bookmarks: Array<{
    nodeId: CodeNodeID
    kind: CodeNodeKind
    selectionLine: number
    selectionChar: number
    rangeStartLine: number
    rangeEndLine: number
  }>,
  limit: number = MAX_REFERENCE_QUERIES_PER_FILE,
) {
  return planReferenceQueries(bookmarks as ReferenceBookmark[], limit).map((query) => ({
    selectionLine: query.selectionLine,
    selectionChar: query.selectionChar,
    nodeIds: query.bookmarks.map((bookmark) => bookmark.nodeId),
  }))
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
    const next = prev.then(fn, (err) => {
      log.warn("previous project lock operation failed before next index run", {
        projectID,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
      return fn()
    })
    const sentinel = next.catch(() => {})
    projectMutexes.set(projectID, sentinel)
    // Clean up the entry when the chain settles and no newer
    // operation has replaced it, preventing unbounded Map growth.
    sentinel.then(() => {
      if (projectMutexes.get(projectID) === sentinel) projectMutexes.delete(projectID)
    })
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

  // Per-file indexing outcome. The variants mean:
  //   "full"      — LSP returned both documentSymbol and references; graph rows written.
  //   "lsp-only"  — documentSymbol succeeded, references partially failed; rows written.
  //   "partial"   — the file was skipped (missing, unreadable, unknown language) or LSP returned nothing.
  //   "unchanged" — the stored sha/size/completeness matched; NO LSP work ran and NO rows were rewritten.
  //   "failed"    — indexFile threw; no rows written, error logged by the caller.
  //
  // "unchanged" and "failed" are transient return values only — they
  // are never persisted to `code_file.completeness`, which keeps its
  // pre-existing three-valued domain ("full" | "lsp-only" | "partial").
  // Do not upsert these values.
  export type IndexResult = {
    nodes: number
    edges: number
    completeness: "full" | "partial" | "lsp-only" | "unchanged" | "failed"
    timings: IndexTimings
  }

  export type IndexFileOptions = {
    force?: boolean
  }

  type PreparedReferenceResult = {
    bookmarks: ReferenceBookmark[]
    locations: LspLocation[]
  }

  type PreparedIndex =
    | { kind: "final"; result: IndexResult }
    | {
        kind: "commit"
        absPath: string
        lang: string
        sha: string
        size: number
        now: number
        tStart: number
        nodeCount: number
        nodeInserts: Parameters<typeof CodeGraphQuery.insertNodes>[0]
        refBookmarks: ReferenceBookmark[]
        refResults: PreparedReferenceResult[]
        referenceFailures: number
        completeness: "partial" | "lsp-only"
        timings: IndexTimings
        nativeTree?: any
      }

  export function indexFile(projectID: ProjectID, absPath: string, opts: IndexFileOptions = {}): Promise<IndexResult> {
    // Serialize per-project to prevent cross-file caller resolution
    // from reading stale nodes that a sibling transaction has already
    // deleted. See the projectMutexes comment at the top of the
    // namespace.
    return withProjectLock(projectID, () => indexFileLocked(projectID, absPath, opts))
  }

  async function indexFileLocked(projectID: ProjectID, absPath: string, opts: IndexFileOptions): Promise<IndexResult> {
    const prepared = await prepareIndexFile(projectID, absPath, opts)
    if (prepared.kind === "final") return prepared.result
    return commitPreparedIndex(projectID, prepared)
  }

  async function prepareIndexFile(
    projectID: ProjectID,
    absPath: string,
    opts: IndexFileOptions,
  ): Promise<PreparedIndex> {
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
      return { kind: "final", result: { nodes: 0, edges: 0, completeness: "partial", timings } }
    }

    // Read once for hash + size. If the file doesn't exist, caller
    // probably wants us to purge it — but that's the purge API, not
    // the index API, so we just return zero.
    const tRead = performance.now()
    const exists = await Filesystem.exists(absPath)
    if (!exists) {
      log.info("skipping file, does not exist", { file: absPath })
      timings.total = performance.now() - tStart
      return { kind: "final", result: { nodes: 0, edges: 0, completeness: "partial", timings } }
    }
    const text = await Filesystem.readText(absPath).catch((err) => {
      log.error("failed to read file for indexing", { file: absPath, err })
      return undefined
    })
    if (text === undefined) {
      timings.total = performance.now() - tStart
      return { kind: "final", result: { nodes: 0, edges: 0, completeness: "partial", timings } }
    }
    timings.readFile = performance.now() - tRead

    const sha = Bun.hash(text).toString()
    const size = text.length

    // Fast path: if the stored row for this path has the same content
    // (sha + size) AND we previously indexed it successfully ("full"),
    // skip all LSP work and return early. Safety notes:
    //
    //   - We only short-circuit on "full". "partial" and "lsp-only"
    //     rows mean a previous run saw LSP errors — we want to retry.
    //   - We do NOT touch the DB here (no delete, no re-upsert). The
    //     existing nodes/edges for this file stay exactly as they
    //     were, which is what we want: their content is a pure
    //     function of the file's text, and the text is unchanged.
    //   - Cross-file edges from OTHER files that target this file's
    //     nodes also remain valid, since we haven't recycled any
    //     CodeNodeIDs. (See the pre-existing edge-regeneration
    //     behavior in the delete+insert path below — skipping is
    //     strictly safer than running that path as a no-op.)
    //   - "unchanged" is a transient return value; it is never
    //     written to `code_file.completeness`.
    const existing = CodeGraphQuery.getFile(projectID, absPath)
    if (!opts.force && existing && existing.sha === sha && existing.size === size && existing.completeness === "full") {
      timings.total = performance.now() - tStart
      log.info("file unchanged, skipping reindex", { file: absPath, sha, size })
      return { kind: "final", result: { nodes: 0, edges: 0, completeness: "unchanged", timings } }
    }

    // Touch the file through LSP so the server has it open before we
    // query documentSymbol. This also ensures diagnostics arrive, but
    // we don't wait for them — we only need the symbol info.
    const tTouch = performance.now()
    await LSP.touchFile(absPath, false, { mode: "semantic", methods: [...INDEXER_SEMANTIC_METHODS] })
    timings.lspTouch = performance.now() - tTouch

    // Pull document symbols. LSP.documentSymbol returns a flat array
    // of results (one per matching client) that we flatten and walk.
    const uri = pathToFileURL(absPath).href
    const tDocSym = performance.now()
    const documentSymbols = await LSP.documentSymbolEnvelope(uri, { cache: true }).catch((err) => {
      log.error("LSP.documentSymbol failed", { file: absPath, err })
      return undefined
    })
    const raw = (documentSymbols?.data ?? []) as Array<LspDocumentSymbol | LspSymbolInformation>
    timings.lspDocumentSymbol = performance.now() - tDocSym

    // Build the new node list outside the transaction so we don't hold
    // the DB lock while walking LSP output. The delete + insert + upsert
    // then happens inside one transaction below.
    const nodeInserts: Parameters<typeof CodeGraphQuery.insertNodes>[0] = []
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

    // Build native IntervalTree for O(log n) containing-node resolution
    const nativeTree = Flag.AX_CODE_NATIVE_INDEX ? NativeStore.createIntervalTree() : undefined
    if (nativeTree) {
      for (const node of nodeInserts) {
        nativeTree.insert(
          node.range_start_line,
          node.range_start_char,
          node.range_end_line,
          node.range_end_char,
          node.id,
          node.kind,
          node.name,
        )
      }
    }

    // Plan at most MAX_REFERENCE_QUERIES_PER_FILE unique reference
    // positions. Multiple symbols can share the same selection point;
    // query that point once and fan the result back out to every
    // bookmark attached to it.
    const referenceQueries = planReferenceQueries(refBookmarks, MAX_REFERENCE_QUERIES_PER_FILE)

    // Determine completeness: "full" if every eligible symbol had its
    // references queried, "lsp-only" if the file was indexed but with
    // nodes only, "partial" if LSP returned nothing.
    const completeness: "partial" | "lsp-only" =
      documentSymbols?.completeness === "full" && raw.length > 0 ? "lsp-only" : "partial"

    let referenceFailures = 0
    const refResults: PreparedReferenceResult[] = []
    if (referenceQueries.length > 0) {
      // Resolve each bookmark's references in small batches. A wide
      // Promise.all here can stampede tsserver/gopls/pyright with
      // hundreds of concurrent RPCs once file-level concurrency is
      // factored in, so we keep modest per-file parallelism.
      const tRefs = performance.now()
      // Track reference-query failures. When LSP.references throws
      // (server crash, RPC timeout, malformed response) the old code
      // silently swallowed the error and returned []. The edge
      // resolver then treated it as "no references found", leaving
      // gaps in the call graph with no operator visibility. We now
      // count failures and downgrade the file's completeness to
      // "partial" if any reference query failed — the completeness
      // flag is the contract with downstream consumers (findCallers,
      // findReferences) for "trust this file's edges". See BUG-76.
      for (let i = 0; i < referenceQueries.length; i += REFERENCE_QUERY_CONCURRENCY) {
        const batch = referenceQueries.slice(i, i + REFERENCE_QUERY_CONCURRENCY)
        const batchResults = await Promise.all(
          batch.map(async (query) => {
            const envelope = await LSP.referencesEnvelope({
              file: absPath,
              line: query.selectionLine,
              character: query.selectionChar,
              cache: true,
            }).catch((err) => {
              referenceFailures++
              log.warn("LSP references failed; edges will be incomplete for this symbol", {
                file: absPath,
                symbols: query.bookmarks.map((bookmark) => bookmark.nodeId),
                line: query.selectionLine,
                err: err instanceof Error ? err.message : String(err),
              })
              return undefined
            })
            const locations = (envelope?.data ?? []) as LspLocation[]
            if (envelope && envelope.completeness !== "full") {
              referenceFailures++
              log.warn("LSP references were incomplete for this symbol", {
                file: absPath,
                symbols: query.bookmarks.map((bookmark) => bookmark.nodeId),
                line: query.selectionLine,
                completeness: envelope.completeness,
                serverIDs: envelope.serverIDs,
              })
            }
            return { bookmarks: query.bookmarks, locations }
          }),
        )
        refResults.push(...batchResults)
      }
      timings.lspReferences = performance.now() - tRefs
    }

    return {
      kind: "commit",
      absPath,
      lang,
      sha,
      size,
      now,
      tStart,
      nodeCount,
      nodeInserts,
      refBookmarks,
      refResults,
      referenceFailures,
      completeness,
      timings,
      nativeTree,
    }
  }

  function commitPreparedIndex(
    projectID: ProjectID,
    prepared: Extract<PreparedIndex, { kind: "commit" }>,
  ): IndexResult {
    const edgeInserts: Parameters<typeof CodeGraphQuery.insertEdges>[0] = []
    let completeness: IndexResult["completeness"] = prepared.completeness

    if (prepared.refResults.length > 0) {
      const tResolve = performance.now()
      const dbRowsByFile = new Map<string, ReturnType<typeof CodeGraphQuery.nodesInFile>>()
      const callerKindByNode = new Map<CodeNodeID, CodeNodeKind | undefined>()
      const rowsForFile = (file: string) => {
        const cached = dbRowsByFile.get(file)
        if (cached) return cached
        const rows = CodeGraphQuery.nodesInFile(projectID, file)
        dbRowsByFile.set(file, rows)
        return rows
      }

      for (const { bookmarks, locations } of prepared.refResults) {
        for (const loc of locations) {
          let refFile: string
          try {
            refFile = fileURLToPath(loc.uri)
          } catch {
            continue
          }

          const sameFile = refFile === prepared.absPath
          const callerNodeId = sameFile
            ? resolveContainingNodeInMemory(
                prepared.nodeInserts,
                prepared.refBookmarks,
                loc.range.start.line,
                loc.range.start.character,
                prepared.nativeTree,
              )
            : resolveContainingNodeFromRows(rowsForFile(refFile), loc.range.start.line, loc.range.start.character)
          if (!callerNodeId) continue

          let callerKind: CodeNodeKind | undefined
          if (sameFile) {
            callerKind = __lookupCallerKind(projectID, callerNodeId, true, prepared.refBookmarks)
          } else if (callerKindByNode.has(callerNodeId)) {
            callerKind = callerKindByNode.get(callerNodeId)
          } else {
            callerKind = CodeGraphQuery.getNode(projectID, callerNodeId)?.kind
            callerKindByNode.set(callerNodeId, callerKind)
          }

          for (const bookmark of bookmarks) {
            if (
              sameFile &&
              loc.range.start.line >= bookmark.rangeStartLine &&
              loc.range.start.line <= bookmark.rangeEndLine
            ) {
              continue
            }

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
              time_created: prepared.now,
              time_updated: prepared.now,
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
                time_created: prepared.now,
                time_updated: prepared.now,
              })
            }
          }
        }
      }

      if (edgeInserts.length > 0 && completeness !== "partial") completeness = "full"
      if (prepared.referenceFailures > 0) completeness = "partial"
      prepared.timings.edgeResolve = performance.now() - tResolve
    }

    const tTxn = performance.now()
    Database.transaction((_tx) => {
      CodeGraphQuery.deleteEdgesTouchingFile(projectID, prepared.absPath)
      CodeGraphQuery.deleteNodesInFile(projectID, prepared.absPath)

      for (let i = 0; i < prepared.nodeInserts.length; i += 50) {
        CodeGraphQuery.insertNodes(prepared.nodeInserts.slice(i, i + 50))
      }

      for (let i = 0; i < edgeInserts.length; i += 60) {
        CodeGraphQuery.insertEdges(edgeInserts.slice(i, i + 60))
      }

      CodeGraphQuery.upsertFile({
        id: CodeFileID.ascending(),
        project_id: projectID,
        path: prepared.absPath,
        sha: prepared.sha,
        size: prepared.size,
        lang: prepared.lang,
        indexed_at: prepared.now,
        completeness,
        time_created: prepared.now,
        time_updated: prepared.now,
      })
    })
    prepared.timings.dbTransaction = performance.now() - tTxn
    prepared.timings.total = performance.now() - prepared.tStart

    log.info("indexed file", {
      file: prepared.absPath,
      nodes: prepared.nodeCount,
      edges: edgeInserts.length,
      completeness,
    })
    return {
      nodes: prepared.nodeCount,
      edges: edgeInserts.length,
      completeness,
      timings: prepared.timings,
    }
  }

  // Options passed to indexFiles. `onProgress` fires once per file
  // as each file finishes (not per batch boundary) so the caller can
  // show live progress — `currentFile` is the path that just
  // resolved. `lock` controls the cross-process lockfile behavior
  // (see IndexLock) — callers that need to cooperate with other
  // ax-code processes set this to "acquire" (wait) or "try" (skip if
  // held). "none" skips the lock entirely and is reserved for tests
  // that run in isolated temp directories.
  //
  // `pruneOrphans`: when true, delete code_file / code_node /
  // code_edge rows whose `code_file.path` is NOT in the `files`
  // input list and whose path starts with `pruneScopePrefix`. Only
  // set this from a full-project walk (the CLI) — partial re-index
  // callers (the file watcher) must leave it false, or they would
  // nuke every file they didn't happen to pass in. The scope prefix
  // prevents one worktree's run from purging a sibling worktree's
  // rows when both share a project id.
  export type IndexFilesOptions = {
    concurrency?: number
    onProgress?: (completed: number, total: number, currentFile?: string) => void
    lock?: "acquire" | "try" | "none"
    lockTimeoutMs?: number
    onLockWait?: () => void
    pruneOrphans?: boolean
    pruneScopePrefix?: string
    force?: boolean
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
  // Result shape for `indexFiles`. Field meanings:
  //   nodes/edges — totals written this run (delta only, not graph totals).
  //   files       — count of files that produced fresh rows (newly indexed).
  //   unchanged   — count of files short-circuited by the hash-skip fast path.
  //   skipped     — count of files LSP returned nothing for (partial completeness, 0 nodes).
  //   failed      — count of files that threw during indexing.
  //   pruned      — counts removed by the orphan purge (all zeros if pruneOrphans was false).
  export type IndexFilesResult = {
    nodes: number
    edges: number
    files: number
    unchanged: number
    skipped: number
    failed: number
    pruned: { files: number; nodes: number; edges: number }
    timings: IndexTimings
  }

  export async function indexFiles(
    projectID: ProjectID,
    files: string[],
    concurrencyOrOpts: number | IndexFilesOptions = 4,
  ): Promise<IndexFilesResult> {
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
      return await indexFilesLocked(projectID, files, concurrency, opts)
    } finally {
      lockHandle?.[Symbol.dispose]()
    }
  }

  async function indexFilesLocked(
    projectID: ProjectID,
    files: string[],
    concurrency: number,
    opts: IndexFilesOptions,
  ): Promise<IndexFilesResult> {
    const onProgress = opts.onProgress
    let nodes = 0
    let edges = 0
    let indexed = 0
    let unchanged = 0
    let skipped = 0
    let failed = 0
    let pruned = { files: 0, nodes: 0, edges: 0 }
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

    // Orphan purge (opt-in, CLI full-walk only). Runs before the
    // batch loop so any file rows we delete here won't be touched by
    // subsequent indexFile calls. Scoped to a path prefix so that
    // running `ax-code index` in a subdirectory, or in one worktree
    // of a shared project id, cannot purge rows that belong to a
    // different walk root. See `IndexFilesOptions.pruneOrphans`.
    if (opts.pruneOrphans) {
      const scopePrefix = opts.pruneScopePrefix ?? ""
      const live = new Set(files)
      pruned = CodeGraphQuery.pruneOrphanFiles(projectID, live, scopePrefix)
      if (pruned.files > 0) {
        log.info("pruned orphan files", { projectID, ...pruned, scopePrefix })
      }
    }

    // Per-file progress counter. JS is single-threaded so plain
    // increment inside async continuations is race-free — each
    // resolution runs to completion on the event loop before the next.
    let completed = 0

    const applyResult = (result: IndexResult) => {
      nodes += result.nodes
      edges += result.edges
      if (result.completeness === "failed") failed++
      else if (result.completeness === "unchanged") unchanged++
      else if (result.nodes > 0 || result.completeness !== "partial") indexed++
      else skipped++

      aggregate.readFile += result.timings.readFile
      aggregate.lspTouch += result.timings.lspTouch
      aggregate.lspDocumentSymbol += result.timings.lspDocumentSymbol
      aggregate.symbolWalk += result.timings.symbolWalk
      aggregate.lspReferences += result.timings.lspReferences
      aggregate.edgeResolve += result.timings.edgeResolve
      aggregate.dbTransaction += result.timings.dbTransaction
      aggregate.total += result.timings.total
    }

    let nextIndex = 0
    const workerCount = Math.max(1, Math.min(concurrency, files.length || 1))
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = nextIndex++
        const file = files[idx]
        if (!file) return

        // Prepare the expensive file/LSP work outside the project lock,
        // then serialize only the graph-resolution + DB commit section.
        const result = await prepareIndexFile(projectID, file, { force: opts.force })
          .then((prepared) => {
            if (prepared.kind === "final") return prepared.result
            return withProjectLock(projectID, () => Promise.resolve(commitPreparedIndex(projectID, prepared)))
          })
          .catch((err): IndexResult => {
            log.error("indexFile failed", { file, err })
            return { nodes: 0, edges: 0, completeness: "failed", timings: emptyTimings }
          })

        completed++
        onProgress?.(completed, files.length, file)
        applyResult(result)
      }
    })

    await Promise.all(workers)

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

    return { nodes, edges, files: indexed, unchanged, skipped, failed, pruned, timings: aggregate }
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
