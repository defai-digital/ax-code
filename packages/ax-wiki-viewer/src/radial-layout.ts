import { LAYOUT_WORLD } from "./force-layout.js"
import type { ForceLayout, LayoutNode } from "./force-layout.js"
import { deriveHierarchy } from "./hierarchy.js"
import type { HierarchyGroup, HierarchyInput } from "./hierarchy.js"

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

export function createRadialLayout(input: HierarchyInput): ForceLayout {
  const cx = LAYOUT_WORLD.width / 2
  const cy = LAYOUT_WORLD.height / 2
  const { nodes, byId, links, treeParent, children, groups } = deriveHierarchy(input, { x: cx, y: cy })

  const slots = (id: string) => Math.max(1, children.get(id)?.length ?? 0)
  const groupLeaves = (group: HierarchyGroup) =>
    Math.max(1, group.sources.reduce((sum, id) => sum + slots(id), 0) + group.loose.length)
  const total = groups.reduce((sum, group) => sum + groupLeaves(group), 0)

  const angles = new Map<string, number>()
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
