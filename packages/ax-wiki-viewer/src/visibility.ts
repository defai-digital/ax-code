import type { WikiGraph, WikiGraphNode, WikiGraphNodeKind } from "@ax-code/ax-wiki/graph"

/** Browser-safe view filtering. DOM-free so unit tests and the viewer share one definition of visible. */

export type NodeKind = WikiGraphNodeKind
export type FreshnessState = "fresh" | "stale" | "unknown"

export type ViewFilters = {
  query: string
  kinds: Record<NodeKind, boolean>
  freshness: Record<FreshnessState, boolean>
}

export function defaultFilters(): ViewFilters {
  return {
    query: "",
    kinds: { page: true, source: true, symbol: true },
    freshness: { fresh: true, stale: true, unknown: true },
  }
}

export function isDefaultFilters(filters: ViewFilters): boolean {
  return (
    filters.query.trim() === "" &&
    filters.kinds.page &&
    filters.kinds.source &&
    filters.kinds.symbol &&
    filters.freshness.fresh &&
    filters.freshness.stale &&
    filters.freshness.unknown
  )
}

export function nodeMatchesQuery(node: WikiGraphNode, query: string): boolean {
  const needle = query.trim().toLowerCase()
  return !needle || `${node.label} ${node.path}`.toLowerCase().includes(needle)
}

export function isNodeVisible(node: WikiGraphNode, filters: ViewFilters): boolean {
  return filters.kinds[node.kind] && filters.freshness[node.freshness] && nodeMatchesQuery(node, filters.query)
}

export type FocusDirection = "outgoing" | "incoming"

/** Direction of an edge relative to a focused node; null when unrelated (or a self-loop). */
export function focusDirection(edge: { from: string; to: string }, focusId: string): FocusDirection | null {
  if (edge.from === focusId && edge.to === focusId) return null
  if (edge.from === focusId) return "outgoing"
  if (edge.to === focusId) return "incoming"
  return null
}

export type ViewCounts = {
  visibleNodes: number
  visibleEdges: number
  recordedNodes: number
  recordedEdges: number
  filteredNodes: number
  filteredEdges: number
  omittedNodes: number
  omittedEdges: number
  /** Snapshot totals per kind; legend labels. */
  byKind: Record<NodeKind, number>
  /** Outline rows: sources with contained symbols nested by qualified prefix. */
  outline: OutlineSource[]
  /** Snapshot totals per freshness; chip labels. */
  byFreshness: Record<FreshnessState, number>
  /** Nodes passing kind and freshness filters; the match-count denominator. */
  matchCandidates: number
}

/**
 * The single converged count. Every number the viewer shows (chips, legend,
 * counts bar, overlay) derives from this, so displayed counts cannot drift.
 * Invariants: visible + filtered + omitted = recorded, for nodes and edges.
 */
export type OutlineSymbol = { id: string; label: string; detail: string; children: OutlineSymbol[] }
export type OutlineSource = { id: string; label: string; path: string; symbols: OutlineSymbol[] }

/** Parent qualified name, mirroring the grounding separator rule. */
function parentQualified(qualified: string): string | undefined {
  const separator = qualified.includes("::") ? "::" : qualified.includes(".") ? "." : undefined
  if (!separator) return undefined
  const parts = qualified.split(separator).filter(Boolean)
  if (parts.length < 2) return undefined
  return parts.slice(0, -1).join(separator)
}

function nestSymbols(symbols: WikiGraphNode[]): OutlineSymbol[] {
  const byQualified = new Map<string, OutlineSymbol>()
  const roots: OutlineSymbol[] = []
  const ordered = [...symbols].sort((a, b) => {
    const x = a.qualified || a.label
    const y = b.qualified || b.label
    return x < y ? -1 : x > y ? 1 : 0
  })
  for (const symbol of ordered) {
    const entry: OutlineSymbol = { id: symbol.id, label: symbol.label, detail: symbol.detail, children: [] }
    const qualified = symbol.qualified || symbol.label
    const parent = parentQualified(qualified)
    const host = parent === undefined ? undefined : byQualified.get(parent)
    if (host) host.children.push(entry)
    else roots.push(entry)
    if (!byQualified.has(qualified)) byQualified.set(qualified, entry)
  }
  return roots
}

/** Build the file-to-symbol outline from contains edges. */
export function buildOutline(graph: WikiGraph): OutlineSource[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const perSource = new Map<string, WikiGraphNode[]>()
  for (const edge of graph.edges) {
    if (edge.kind !== "contains") continue
    const source = byId.get(edge.from)
    const symbol = byId.get(edge.to)
    if (!source || source.kind !== "source" || !symbol || symbol.kind !== "symbol") continue
    const list = perSource.get(source.id) ?? []
    list.push(symbol)
    perSource.set(source.id, list)
  }
  return [...perSource.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, symbols]) => {
      const source = byId.get(id)!
      return { id, label: source.label, path: source.path, symbols: nestSymbols(symbols) }
    })
}

/** Total symbol rows in an outline, for the display cap more-count. */
export function countOutlineSymbols(outline: readonly OutlineSource[]): number {
  const walk = (symbols: readonly OutlineSymbol[]): number =>
    symbols.reduce((total, symbol) => total + 1 + walk(symbol.children), 0)
  return outline.reduce((total, source) => total + walk(source.symbols), 0)
}

export function viewCounts(graph: WikiGraph, filters: ViewFilters): ViewCounts {
  const byKind: Record<NodeKind, number> = { page: 0, source: 0, symbol: 0 }
  const byFreshness: Record<FreshnessState, number> = { fresh: 0, stale: 0, unknown: 0 }
  const visible = new Set<string>()
  let matchCandidates = 0
  for (const node of graph.nodes) {
    byKind[node.kind]++
    byFreshness[node.freshness]++
    if (filters.kinds[node.kind] && filters.freshness[node.freshness]) matchCandidates++
    if (isNodeVisible(node, filters)) visible.add(node.id)
  }
  let visibleEdges = 0
  for (const edge of graph.edges) if (visible.has(edge.from) && visible.has(edge.to)) visibleEdges++
  return {
    visibleNodes: visible.size,
    visibleEdges,
    recordedNodes: graph.nodes.length + graph.omitted.nodes,
    recordedEdges: graph.edges.length + graph.omitted.edges,
    filteredNodes: graph.nodes.length - visible.size,
    filteredEdges: graph.edges.length - visibleEdges,
    omittedNodes: graph.omitted.nodes,
    omittedEdges: graph.omitted.edges,
    byKind,
    outline: buildOutline(graph),
    byFreshness,
    matchCandidates,
  }
}

export type ViewState = "ok" | "empty" | "zero-match" | "all-kinds-hidden" | "single-node" | "no-edges"

/** Names the degenerate view instead of rendering a blank canvas. */
export function viewState(graph: WikiGraph, filters: ViewFilters): ViewState {
  if (graph.nodes.length === 0) return "empty"
  if (!filters.kinds.page && !filters.kinds.source && !filters.kinds.symbol) return "all-kinds-hidden"
  const counts = viewCounts(graph, filters)
  if (counts.visibleNodes === 0) return "zero-match"
  if (counts.visibleNodes === 1) return "single-node"
  if (counts.visibleEdges === 0) return "no-edges"
  return "ok"
}

/** A page's palette index, or "shared" when more than one page cites a file. */
export type CitingTopic = number | "shared"

/**
 * Topic color follows the citing page, not a detected cluster.
 * Pages are numbered in id order. A file cited by exactly one page uses that
 * page's index. A file cited by several pages is shared.
 */
export function citingTopics(
  nodes: readonly { id: string; kind: NodeKind }[],
  edges: readonly { kind: string; from: string; to: string }[],
): Map<string, CitingTopic> {
  const pages = nodes
    .filter((node) => node.kind === "page")
    .map((node) => node.id)
    .sort()
  const index = new Map(pages.map((id, i) => [id, i]))
  const citers = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (edge.kind !== "references-source") continue
    const set = citers.get(edge.to) ?? new Set<string>()
    set.add(edge.from)
    citers.set(edge.to, set)
  }
  const topic = new Map<string, CitingTopic>()
  for (const [id, i] of index) topic.set(id, i)
  for (const [sourceId, set] of citers) {
    if (set.size !== 1) {
      topic.set(sourceId, "shared")
      continue
    }
    const pageTopic = index.get([...set][0]!)
    topic.set(sourceId, pageTopic === undefined ? "shared" : pageTopic)
  }
  return topic
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function countsBarText(counts: ViewCounts, state: ViewState, query = ""): string {
  // Compact bar form: "N of M nodes · N of M edges in view".
  let text = `${counts.visibleNodes} of ${counts.recordedNodes} nodes · ${counts.visibleEdges} of ${counts.recordedEdges} edges in view`
  if (counts.filteredNodes > 0)
    text += ` · ${plural(counts.filteredNodes, "node", "nodes")} and ${plural(counts.filteredEdges, "edge", "edges")} hidden by filters`
  if (counts.omittedNodes + counts.omittedEdges > 0)
    text += ` · ${plural(counts.omittedNodes, "node", "nodes")} and ${plural(counts.omittedEdges, "edge", "edges")} beyond the view cap`
  if (query.trim() !== "") text += ` · ${counts.visibleNodes} of ${counts.matchCandidates} match`
  if (state === "zero-match" || state === "all-kinds-hidden") text += " · no nodes in view"
  else if (state === "single-node") text += " · single node in view"
  else if (state === "no-edges") text += " · no edges in view"
  else if (state === "empty") text += " · empty snapshot"
  return text
}

export function overlayText(state: ViewState, counts: ViewCounts): string {
  switch (state) {
    case "empty":
      return "Empty snapshot: this Wiki records no pages or sources."
    case "zero-match":
      return "No nodes match the current filters. Clear search or reset the view."
    case "all-kinds-hidden":
      return "All node kinds are hidden. Re-enable pages or sources to restore the view."
    case "single-node":
      return `Degenerate view: a single node with no edges in view (${counts.visibleNodes} of ${counts.recordedNodes} recorded nodes).`
    case "no-edges":
      return `Degenerate view: ${counts.visibleNodes} nodes with no edges in view.`
    case "ok":
      return ""
  }
}
