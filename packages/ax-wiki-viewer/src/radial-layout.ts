import { LAYOUT_WORLD, layoutRadius } from "./force-layout.js"
import type { ForceLayout, LayoutLink, LayoutNode } from "./force-layout.js"
import type { WikiGraphNodeKind } from "@ax-code/ax-wiki/graph"

/**
 * DOM-free radial cluster layout. The evidence graph is not a tree, so a hierarchy is
 * derived (page -> source -> symbol) from each node's first citing page or
 * container; every other edge stays a cross link. Branch lengths are never
 * invented: radius encodes leafhood (leaves on the outer ring), not distance.
 */
const GAP = (3 * Math.PI) / 180
/** Minimum arc length a leaf slot may have, in world units, so bubbles never touch. */
const MIN_ARC = 16
const MIN_RING = 340

type Group = { head?: string; sources: string[]; loose: string[] }

export function createRadialLayout(input: {
  nodes: ReadonlyArray<{ id: string; kind: WikiGraphNodeKind }>
  edges: ReadonlyArray<{ from: string; to: string; kind: string }>
}): ForceLayout {
  const cx = LAYOUT_WORLD.width / 2
  const cy = LAYOUT_WORLD.height / 2
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
    x: cx,
    y: cy,
  }))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = (kind: WikiGraphNodeKind) =>
    nodes
      .filter((node) => node.kind === kind)
      .map((node) => node.id)
      .sort()

  // Primary parents: edges sorted so the first citing page (by id) wins, deterministically.
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

  const groups: Group[] = ids("page").map((id) => ({ head: id, sources: children.get(id) ?? [], loose: [] }))
  const orphanSources = ids("source").filter((id) => !treeParent.has(id))
  const orphanSymbols = ids("symbol").filter((id) => !treeParent.has(id))
  if (orphanSources.length > 0 || orphanSymbols.length > 0)
    groups.push({ sources: orphanSources, loose: orphanSymbols })

  const slots = (id: string) => Math.max(1, children.get(id)?.length ?? 0)
  const groupLeaves = (group: Group) =>
    Math.max(1, group.sources.reduce((sum, id) => sum + slots(id), 0) + group.loose.length)
  const total = groups.reduce((sum, group) => sum + groupLeaves(group), 0)

  const angles = new Map<string, number>()
  const links: LayoutLink[] = input.edges
    .filter((edge) => edge.from !== edge.to && byId.has(edge.from) && byId.has(edge.to))
    .map((edge) => ({ source: edge.from, target: edge.to, from: edge.from, to: edge.to }))
  const layout: ForceLayout = {
    nodes,
    links,
    byId,
    stop: () => {},
    reheat: () => {},
    radial: { cx, cy, angles, treeParent },
  }
  if (total === 0) return layout

  const gaps = groups.length > 1 ? groups.length : 0
  const unit = (2 * Math.PI - gaps * GAP) / total
  const R = Math.max(MIN_RING, (MIN_ARC * total) / (2 * Math.PI))
  const ringOf = (node: LayoutNode): number => {
    if (node.kind === "page") return 0.34 * R
    if (node.kind === "symbol") return R
    return (children.get(node.id)?.length ?? 0) === 0 ? R : 0.68 * R
  }
  const place = (id: string, angle: number) => {
    const node = byId.get(id)!
    const ring = ringOf(node)
    angles.set(id, angle)
    node.x = cx + ring * Math.cos(angle)
    node.y = cy + ring * Math.sin(angle)
    if (node.kind !== "page") node.radius = Math.max(3.5, Math.min(node.radius, 0.4 * ring * unit))
  }

  let cursor = -Math.PI / 2
  for (const group of groups) {
    const start = cursor
    for (const sourceId of group.sources) {
      const kids = children.get(sourceId) ?? []
      const slot = slots(sourceId) * unit
      place(sourceId, cursor + slot / 2)
      kids.forEach((kid, index) => place(kid, cursor + (index + 0.5) * unit))
      cursor += slot
    }
    for (const symbolId of group.loose) {
      place(symbolId, cursor + unit / 2)
      cursor += unit
    }
    if (group.sources.length === 0 && group.loose.length === 0) cursor += unit
    if (group.head) place(group.head, (start + cursor) / 2)
    cursor += gaps > 0 ? GAP : 0
  }
  return layout
}
