/** Browser-safe view projection. No filesystem, hashing, or runtime imports. */
import { provenanceOfSymbol } from "./grounding.js"
import type { SymbolProvenance } from "./grounding.js"

export type { SymbolProvenance } from "./grounding.js"
export type GraphFreshness = "fresh" | "stale" | "unknown"
export type SymbolAnchor = {
  name: string
  provenance: SymbolProvenance
}
export type WikiGraphNode = {
  id: string
  kind: "page" | "source"
  label: string
  path: string
  freshness: GraphFreshness
  /** Total recorded incident relationships, including those omitted from this view. */
  recordedReferences: number
  observedHash?: string
  /** Page nodes carry the recorded manifest summary verbatim (v2; "" when absent). */
  summary: string
  /** Page nodes carry anchored symbols with provenance (v2; [] when absent). */
  symbols: SymbolAnchor[]
}
export type WikiGraphEdge = {
  from: string
  to: string
  kind: "references-source"
  freshness: GraphFreshness
  recordedHash?: string
}
export type WikiGraph = {
  schemaVersion: 1
  snapshot: string
  scope: "wiki-manifest"
  codeRelationships: "unavailable"
  nodes: WikiGraphNode[]
  edges: WikiGraphEdge[]
  omitted: { nodes: number; edges: number }
}
export const GRAPH_LIMITS = {
  nodes: 200,
  edges: 500,
  pages: 10_000,
  references: 50_000,
  symbolsPerNode: 32,
  symbolName: 256,
  summary: 2048,
} as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
  return value as Record<string, unknown>
}
function text(value: unknown, max = 1024): string {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > max ||
    /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value)
  )
    throw new Error("Invalid graph text")
  return value
}
export function graphRelativePath(value: unknown): string {
  const result = text(value)
  if (/[\\:?#]/.test(result) || result.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("Expected a root-relative graph path")
  return result
}
function hash(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid content hash")
  return value
}
function freshness(value: unknown): GraphFreshness {
  if (value !== "fresh" && value !== "stale" && value !== "unknown") throw new Error("Invalid freshness")
  return value
}
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid count")
  return value
}
function provenance(value: unknown): SymbolProvenance {
  if (value !== "verified" && value !== "inferred" && value !== "unavailable") throw new Error("Invalid provenance")
  return value
}
function summaryText(value: unknown): string {
  if (value === undefined || value === "") return ""
  return text(value, GRAPH_LIMITS.summary)
}
function symbolAnchors(value: unknown): SymbolAnchor[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > GRAPH_LIMITS.symbolsPerNode) throw new Error("Invalid node symbols")
  const seen = new Set<string>()
  return value.map((raw) => {
    const anchor = record(raw)
    const name = text(anchor.name, GRAPH_LIMITS.symbolName)
    if (seen.has(name)) throw new Error("Duplicate node symbol")
    seen.add(name)
    return { name, provenance: provenance(anchor.provenance) }
  })
}
/** Validate and detach an allowlisted graph; extra producer fields never reach exports. */
export function parseWikiGraph(input: unknown): WikiGraph {
  const value = record(input)
  if (value.schemaVersion !== 1 || value.scope !== "wiki-manifest" || value.codeRelationships !== "unavailable")
    throw new Error("Unsupported Wiki graph schema")
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length > GRAPH_LIMITS.nodes ||
    !Array.isArray(value.edges) ||
    value.edges.length > GRAPH_LIMITS.edges
  )
    throw new Error("Graph exceeds view limits")
  const ids = new Map<string, WikiGraphNode>()
  const nodes = value.nodes.map((raw): WikiGraphNode => {
    const node = record(raw)
    if (node.kind !== "page" && node.kind !== "source") throw new Error("Unsupported node kind")
    const id = text(node.id, 1100)
    if (ids.has(id)) throw new Error("Duplicate node id")
    const parsed: WikiGraphNode = {
      id,
      kind: node.kind,
      label: text(node.label),
      path: graphRelativePath(node.path),
      freshness: freshness(node.freshness),
      recordedReferences: count(node.recordedReferences),
      observedHash: hash(node.observedHash),
      summary: summaryText(node.summary),
      symbols: symbolAnchors(node.symbols),
    }
    ids.set(id, parsed)
    return parsed
  })
  const pairs = new Set<string>()
  const edges = value.edges.map((raw): WikiGraphEdge => {
    const edge = record(raw)
    const from = text(edge.from, 1100),
      to = text(edge.to, 1100)
    if (edge.kind !== "references-source" || ids.get(from)?.kind !== "page" || ids.get(to)?.kind !== "source")
      throw new Error("Invalid graph relationship or endpoint")
    const pair = JSON.stringify([from, to])
    if (pairs.has(pair)) throw new Error("Duplicate relationship")
    pairs.add(pair)
    return {
      from,
      to,
      kind: "references-source",
      freshness: freshness(edge.freshness),
      recordedHash: hash(edge.recordedHash),
    }
  })
  const incidents = new Map<string, number>()
  for (const edge of edges) for (const id of [edge.from, edge.to]) incidents.set(id, (incidents.get(id) ?? 0) + 1)
  for (const node of nodes) {
    if (node.recordedReferences < (incidents.get(node.id) ?? 0) || node.recordedReferences > GRAPH_LIMITS.references)
      throw new Error("Invalid recorded relationship count")
  }
  const omitted = record(value.omitted)
  return {
    schemaVersion: 1,
    snapshot: text(value.snapshot, 128),
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes,
    edges,
    omitted: { nodes: count(omitted.nodes), edges: count(omitted.edges) },
  }
}

/** Project recorded membership only. Missing observations are unknown, never fresh. */
export function projectWikiManifest(
  input: unknown,
  options: {
    snapshot: string
    observed?: ReadonlyMap<string, string | null>
    /** Bounded source excerpts keyed by root-relative path, used for symbol provenance. */
    sourceContents?: ReadonlyMap<string, string>
  },
): WikiGraph {
  const manifest = record(input)
  if (manifest.schemaVersion !== 1 || manifest.generator !== "ax-wiki") throw new Error("Unsupported Wiki manifest")
  const pages = Object.entries(record(manifest.pages)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  if (pages.length > GRAPH_LIMITS.pages) throw new Error("Manifest exceeds page limit")
  const allNodes = new Map<string, WikiGraphNode>()
  const allEdges: WikiGraphEdge[] = []
  let references = 0
  for (const [pagePath, raw] of pages) {
    const page = record(raw)
    const location = graphRelativePath(pagePath)
    if (!Array.isArray(page.sources) || (references += page.sources.length) > GRAPH_LIMITS.references)
      throw new Error("Manifest exceeds reference limit")
    const hashes = record(page.sourceHashes)
    const cited = [...new Set(page.sources.map(graphRelativePath))].sort()
    const reported = page.symbols === undefined ? [] : page.symbols
    if (!Array.isArray(reported) || reported.length > GRAPH_LIMITS.symbolsPerNode)
      throw new Error("Manifest exceeds node symbol limit")
    const excerpts = cited
      .map((source) => options.sourceContents?.get(source))
      .filter((value): value is string => value !== undefined)
    const supplied = excerpts.length > 0 ? excerpts : undefined
    const id = `page:${location}`
    const node: WikiGraphNode = {
      id,
      kind: "page",
      path: location,
      label: text(page.title),
      freshness: "unknown",
      recordedReferences: 0,
      summary: summaryText(page.summary),
      symbols: [...new Set(reported.map((raw) => text(raw, GRAPH_LIMITS.symbolName)))].map((name) => ({
        name,
        provenance: provenanceOfSymbol(name, supplied),
      })),
    }
    allNodes.set(id, node)
    const states: GraphFreshness[] = []
    for (const source of cited) {
      const recordedHash = hash(Object.hasOwn(hashes, source) ? hashes[source] : undefined)
      const observation = options.observed?.get(source)
      const observed = observation === null ? null : hash(observation)
      const state: GraphFreshness =
        observed === null
          ? "stale"
          : observed === undefined || recordedHash === undefined
            ? "unknown"
            : observed === recordedHash
              ? "fresh"
              : "stale"
      const target = `source:${source}`
      const existing = allNodes.get(target)
      const combined =
        existing?.freshness === "stale" || state === "stale"
          ? "stale"
          : existing?.freshness === "unknown" || state === "unknown"
            ? "unknown"
            : "fresh"
      allNodes.set(target, {
        id: target,
        kind: "source",
        path: source,
        label: source,
        freshness: combined,
        recordedReferences: (existing?.recordedReferences ?? 0) + 1,
        observedHash: observed ?? undefined,
        summary: "",
        symbols: [],
      })
      allEdges.push({ from: id, to: target, kind: "references-source", freshness: state, recordedHash })
      states.push(state)
      node.recordedReferences++
    }
    node.freshness = states.includes("stale")
      ? "stale"
      : !states.length || states.includes("unknown")
        ? "unknown"
        : "fresh"
  }
  // Interleave each page with its evidence, rather than filling the cap with pages alone.
  const nodes = [...allNodes.values()].slice(0, GRAPH_LIMITS.nodes)
  const selected = new Set(nodes.map((node) => node.id))
  const edges = allEdges.filter((edge) => selected.has(edge.from) && selected.has(edge.to)).slice(0, GRAPH_LIMITS.edges)
  return parseWikiGraph({
    schemaVersion: 1,
    snapshot: options.snapshot,
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes,
    edges,
    omitted: { nodes: allNodes.size - nodes.length, edges: allEdges.length - edges.length },
  })
}
