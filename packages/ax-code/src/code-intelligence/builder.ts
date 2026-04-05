import path from "path"
import { pathToFileURL } from "url"
import { LSP } from "../lsp"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { LANGUAGE_EXTENSIONS } from "../lsp/language"
import { CodeGraphQuery } from "./query"
import { CodeNodeID, CodeEdgeID, CodeFileID } from "./id"
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

function isDocumentSymbol(s: LspDocumentSymbol | LspSymbolInformation): s is LspDocumentSymbol {
  return typeof (s as LspDocumentSymbol).range?.start?.line === "number" && !("location" in s)
}

// Walk a documentSymbol tree depth-first, emitting (symbol, parentQualifiedName)
// pairs. Parent tracking lets us build qualified names like
// "SessionCompaction::isOverflow" for disambiguation.
function* walkDocumentSymbols(
  symbols: LspDocumentSymbol[],
  parentQualified: string,
): Generator<{ symbol: LspDocumentSymbol; parentQualified: string }> {
  for (const symbol of symbols) {
    yield { symbol, parentQualified }
    if (symbol.children && symbol.children.length > 0) {
      const nextParent = parentQualified ? `${parentQualified}::${symbol.name}` : symbol.name
      yield* walkDocumentSymbols(symbol.children, nextParent)
    }
  }
}

export namespace CodeGraphBuilder {
  // Index a single file: extract its symbols via LSP and upsert them as
  // graph nodes. Replaces any existing nodes/edges for the file in an
  // atomic delete-then-insert pattern. Safe to call repeatedly — later
  // calls supersede earlier ones for the same (project, file).
  //
  // Returns the number of nodes inserted, or 0 if the file was skipped
  // (language not supported, LSP unavailable, empty symbol list). Never
  // throws on per-file errors; errors are logged and the builder
  // continues.
  export async function indexFile(
    projectID: ProjectID,
    absPath: string,
  ): Promise<{ nodes: number; edges: number; completeness: "full" | "partial" | "lsp-only" }> {
    const lang = detectLanguage(absPath)
    if (lang === "plaintext") {
      log.info("skipping file, language not recognized", { file: absPath })
      return { nodes: 0, edges: 0, completeness: "partial" }
    }

    // Read once for hash + size. If the file doesn't exist, caller
    // probably wants us to purge it — but that's the purge API, not
    // the index API, so we just return zero.
    const exists = await Filesystem.exists(absPath)
    if (!exists) {
      log.info("skipping file, does not exist", { file: absPath })
      return { nodes: 0, edges: 0, completeness: "partial" }
    }
    const text = await Filesystem.readText(absPath).catch((err) => {
      log.error("failed to read file for indexing", { file: absPath, err })
      return undefined
    })
    if (text === undefined) return { nodes: 0, edges: 0, completeness: "partial" }

    const sha = Bun.hash(text).toString()
    const size = text.length

    // Touch the file through LSP so the server has it open before we
    // query documentSymbol. This also ensures diagnostics arrive, but
    // we don't wait for them — we only need the symbol info.
    await LSP.touchFile(absPath, false)

    // Pull document symbols. LSP.documentSymbol returns a flat array
    // of results (one per matching client) that we flatten and walk.
    const uri = pathToFileURL(absPath).href
    const raw = (await LSP.documentSymbol(uri).catch((err) => {
      log.error("LSP.documentSymbol failed", { file: absPath, err })
      return []
    })) as Array<LspDocumentSymbol | LspSymbolInformation>

    // Determine if any client returned results. "partial" means the
    // language had no LSP client at all (fell through to zero results);
    // "lsp-only" means LSP answered but cross-references are not yet
    // queried in Phase 1 so the graph is symbol-only for this file.
    // "full" is reserved for Phase 2 when references land.
    const completeness: "full" | "partial" | "lsp-only" = raw.length === 0 ? "partial" : "lsp-only"

    // Delete existing state for this file before reinserting. Conservative
    // but correct — we never leave stale nodes/edges lying around.
    CodeGraphQuery.deleteEdgesTouchingFile(projectID, absPath)
    CodeGraphQuery.deleteNodesInFile(projectID, absPath)

    const nodeInserts: Parameters<typeof CodeGraphQuery.insertNodes>[0] = []
    let nodeCount = 0
    const now = Date.now()

    if (raw.length > 0) {
      // LSP may return DocumentSymbol[] (hierarchical) or
      // SymbolInformation[] (flat). Handle both.
      const first = raw[0]
      if (first && isDocumentSymbol(first)) {
        for (const { symbol, parentQualified } of walkDocumentSymbols(raw as LspDocumentSymbol[], "")) {
          const kind = LSP_SYMBOL_KIND_MAP[symbol.kind]
          if (!kind) continue
          const qualified = parentQualified ? `${parentQualified}::${symbol.name}` : symbol.name
          nodeInserts.push({
            id: CodeNodeID.ascending(),
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
          nodeCount++
        }
      } else {
        // SymbolInformation[] path. No parent hierarchy, containerName
        // gives us a qualifier.
        for (const s of raw as LspSymbolInformation[]) {
          const kind = LSP_SYMBOL_KIND_MAP[s.kind]
          if (!kind) continue
          const qualified = s.containerName ? `${s.containerName}::${s.name}` : s.name
          nodeInserts.push({
            id: CodeNodeID.ascending(),
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
          nodeCount++
        }
      }
    }

    // Bulk insert. SQLite's multi-row insert is fast but has a 999-
    // parameter default limit; our row has ~14 columns so we chunk
    // at 50 rows per statement as a safe margin.
    for (let i = 0; i < nodeInserts.length; i += 50) {
      CodeGraphQuery.insertNodes(nodeInserts.slice(i, i + 50))
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

    log.info("indexed file", { file: absPath, nodes: nodeCount, completeness })
    return { nodes: nodeCount, edges: 0, completeness }
  }

  // Index a batch of files with a concurrency cap. Returns cumulative
  // counts. The cap exists because each indexFile call can trigger LSP
  // RPCs and we don't want to saturate slow servers; 4 concurrent files
  // is a conservative default.
  export async function indexFiles(
    projectID: ProjectID,
    files: string[],
    concurrency = 4,
  ): Promise<{ nodes: number; edges: number; files: number; skipped: number }> {
    let nodes = 0
    let edges = 0
    let indexed = 0
    let skipped = 0

    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency)
      const results = await Promise.all(
        batch.map((file) =>
          indexFile(projectID, file).catch((err) => {
            log.error("indexFile failed", { file, err })
            return { nodes: 0, edges: 0, completeness: "partial" as const }
          }),
        ),
      )
      for (const r of results) {
        nodes += r.nodes
        edges += r.edges
        if (r.nodes > 0 || r.completeness !== "partial") indexed++
        else skipped++
      }
    }

    const totalNodes = CodeGraphQuery.countNodes(projectID)
    const totalEdges = CodeGraphQuery.countEdges(projectID)
    CodeGraphQuery.upsertCursor(projectID, null, totalNodes, totalEdges)

    return { nodes, edges, files: indexed, skipped }
  }

  // Remove all graph state for a single file. Used when a file is
  // deleted from disk or moved out of scope.
  export function purgeFile(projectID: ProjectID, absPath: string): void {
    CodeGraphQuery.deleteEdgesTouchingFile(projectID, absPath)
    CodeGraphQuery.deleteNodesInFile(projectID, absPath)
    CodeGraphQuery.deleteFile(projectID, absPath)
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
