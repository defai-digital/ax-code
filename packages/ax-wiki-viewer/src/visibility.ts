import type { WikiGraph, WikiGraphNode } from "@ax-code/ax-wiki/graph"

/** Browser-safe view filtering. DOM-free so unit tests and the viewer share one definition of visible. */

export type NodeKind = "page" | "source"
export type FreshnessState = "fresh" | "stale" | "unknown"

export type ViewFilters = {
  query: string
  kinds: Record<NodeKind, boolean>
  freshness: Record<FreshnessState, boolean>
}

export function defaultFilters(): ViewFilters {
  return { query: "", kinds: { page: true, source: true }, freshness: { fresh: true, stale: true, unknown: true } }
}

export function isDefaultFilters(filters: ViewFilters): boolean {
  return (
    filters.query.trim() === "" &&
    filters.kinds.page &&
    filters.kinds.source &&
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
  /** Snapshot totals per freshness; chip labels. */
  byFreshness: Record<FreshnessState, number>
}

/**
 * The single converged count. Every number the viewer shows (chips, legend,
 * counts bar, overlay) derives from this, so displayed counts cannot drift.
 * Invariants: visible + filtered + omitted = recorded, for nodes and edges.
 */
export function viewCounts(graph: WikiGraph, filters: ViewFilters): ViewCounts {
  const byKind: Record<NodeKind, number> = { page: 0, source: 0 }
  const byFreshness: Record<FreshnessState, number> = { fresh: 0, stale: 0, unknown: 0 }
  const visible = new Set<string>()
  for (const node of graph.nodes) {
    byKind[node.kind]++
    byFreshness[node.freshness]++
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
    byFreshness,
  }
}

export type ViewState = "ok" | "empty" | "zero-match" | "all-kinds-hidden" | "single-node" | "no-edges"

/** Names the degenerate view instead of rendering a blank canvas. */
export function viewState(graph: WikiGraph, filters: ViewFilters): ViewState {
  if (graph.nodes.length === 0) return "empty"
  if (!filters.kinds.page && !filters.kinds.source) return "all-kinds-hidden"
  const counts = viewCounts(graph, filters)
  if (counts.visibleNodes === 0) return "zero-match"
  if (counts.visibleNodes === 1) return "single-node"
  if (counts.visibleEdges === 0) return "no-edges"
  return "ok"
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function countsBarText(counts: ViewCounts, state: ViewState): string {
  // Compact bar form: "N of M nodes · N of M edges in view".
  let text = `${counts.visibleNodes} of ${counts.recordedNodes} nodes · ${counts.visibleEdges} of ${counts.recordedEdges} edges in view`
  if (counts.filteredNodes > 0)
    text += ` · ${plural(counts.filteredNodes, "node", "nodes")} and ${plural(counts.filteredEdges, "edge", "edges")} hidden by filters`
  if (counts.omittedNodes + counts.omittedEdges > 0)
    text += ` · ${plural(counts.omittedNodes, "node", "nodes")} and ${plural(counts.omittedEdges, "edge", "edges")} beyond the view cap`
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
