import { layoutRadius } from "./force-layout.js"
import type { LayoutLink, LayoutNode } from "./force-layout.js"
import type { WikiGraphNodeKind } from "@ax-code/ax-wiki/graph"

export type HierarchyInput = {
  nodes: ReadonlyArray<{ id: string; kind: WikiGraphNodeKind }>
  edges: ReadonlyArray<{ from: string; to: string; kind: string }>
}

/** A page with the sources it owns, or the head-less group of nodes no page cites. */
export type HierarchyGroup = { head?: string; sources: string[]; loose: string[] }

/**
 * The evidence graph is not a tree. A hierarchy (page -> source -> symbol) is derived
 * from each node's first citing page or container, ordered by id so it is deterministic;
 * every other edge stays a cross link. Shared by the radial, arc and treemap views.
 */
export function deriveHierarchy(input: HierarchyInput, origin: { x: number; y: number }) {
  const degree = new Map<string, number>()
  for (const edge of input.edges) {
    if (edge.from === edge.to) continue
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  }
  const nodes: LayoutNode[] = input.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    degree: degree.get(node.id) ?? 0,
    radius: layoutRadius(degree.get(node.id) ?? 0),
    x: origin.x,
    y: origin.y,
  }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = (kind: WikiGraphNodeKind) =>
    nodes
      .filter((node) => node.kind === kind)
      .map((node) => node.id)
      .sort()

  const treeParent = new Map<string, string>()
  const ordered = [...input.edges].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1))
  for (const edge of ordered) {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to || treeParent.has(edge.to)) continue
    if (edge.kind === "references-source" && from.kind === "page" && to.kind === "source")
      treeParent.set(edge.to, edge.from)
    else if (edge.kind === "contains" && from.kind === "source" && to.kind === "symbol")
      treeParent.set(edge.to, edge.from)
  }
  const children = new Map<string, string[]>()
  for (const [child, parent] of treeParent) children.set(parent, [...(children.get(parent) ?? []), child].sort())

  const groups: HierarchyGroup[] = ids("page").map((id) => ({ head: id, sources: children.get(id) ?? [], loose: [] }))
  const orphanSources = ids("source").filter((id) => !treeParent.has(id))
  const orphanSymbols = ids("symbol").filter((id) => !treeParent.has(id))
  if (orphanSources.length > 0 || orphanSymbols.length > 0)
    groups.push({ sources: orphanSources, loose: orphanSymbols })

  const links: LayoutLink[] = input.edges
    .filter((edge) => edge.from !== edge.to && byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => ({ source: edge.from, target: edge.to, from: edge.from, to: edge.to }))
  return { nodes, byId, links, treeParent, children, groups }
}
