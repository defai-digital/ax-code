import { LAYOUT_WORLD } from "./force-layout.js"
import type { ForceLayout } from "./force-layout.js"
import { deriveHierarchy } from "./hierarchy.js"
import type { HierarchyInput } from "./hierarchy.js"

/** Distance between neighbouring nodes on the baseline, in world units. */
export const ARC_SPACING = 20
/** Tallest arc, so one long import cannot flatten the rest of the picture. */
export const ARC_MAX_HEIGHT = 360

/**
 * DOM-free arc diagram. Nodes sit on one baseline in hierarchy order (page, then each of its
 * files followed by its symbols), so files in the same directory stay adjacent and their
 * imports stay short. Edges become arcs: citations and containment above, imports below.
 */
export function createArcLayout(input: HierarchyInput): ForceLayout {
  const cx = LAYOUT_WORLD.width / 2
  const cy = LAYOUT_WORLD.height / 2
  const { nodes, byId, links, children, groups } = deriveHierarchy(input, { x: cx, y: cy })

  const order: string[] = []
  const slotOf = new Map<string, number>()
  const place = (id: string, width: number) => {
    slotOf.set(id, order.length)
    order.push(id)
    // A page is drawn larger than a file, so it takes extra baseline room.
    for (let extra = 1; extra < width; extra++) order.push("")
  }
  for (const group of groups) {
    if (group.head) place(group.head, 2)
    for (const sourceId of group.sources) {
      place(sourceId, 1)
      for (const symbolId of children.get(sourceId) ?? []) place(symbolId, 1)
    }
    for (const symbolId of group.loose) place(symbolId, 1)
  }

  const left = cx - (order.length * ARC_SPACING) / 2
  for (const node of nodes) {
    const slot = slotOf.get(node.id)
    if (slot === undefined) continue
    node.x = left + (slot + (node.kind === "page" ? 1 : 0.5)) * ARC_SPACING
    node.y = cy
    if (node.kind !== "page") node.radius = Math.max(3.5, Math.min(node.radius, 7))
  }

  let up = 0
  let down = 0
  for (const link of links) {
    const a = byId.get(link.from)!
    const b = byId.get(link.to)!
    const height = Math.min(ARC_MAX_HEIGHT, Math.abs(a.x - b.x) * 0.5)
    const kind = input.edges.find((edge) => edge.from === link.from && edge.to === link.to)?.kind
    if (kind === "uses") down = Math.max(down, height)
    else up = Math.max(up, height)
  }
  const pad = 40
  return {
    nodes,
    links,
    byId,
    stop: () => {},
    reheat: () => {},
    arc: { baselineY: cy },
    bounds: {
      minX: left - pad,
      maxX: left + order.length * ARC_SPACING + pad,
      minY: cy - up - pad,
      maxY: cy + down + pad,
    },
  }
}
