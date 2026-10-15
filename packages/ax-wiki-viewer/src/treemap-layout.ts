import { LAYOUT_WORLD } from "./force-layout.js"
import type { ForceLayout } from "./force-layout.js"
import { deriveHierarchy } from "./hierarchy.js"
import type { HierarchyInput } from "./hierarchy.js"

export const TREEMAP_SIZE = { width: 1200, height: 720 } as const
/** Header band reserved for a parent's name, by depth (page, source). */
const HEADER = [26, 17] as const
const PAD = 4

type Cell = { id: string; value: number; kids: Cell[] }
type Rect = { x: number; y: number; w: number; h: number }

/**
 * Squarified treemap (Bruls et al.): pack `cells` into `box`, keeping rectangles close to
 * square so labels fit. Values must be positive; ties break by id so output is deterministic.
 */
export function squarify(cells: Cell[], box: Rect): Map<string, Rect> {
  const out = new Map<string, Rect>()
  const sorted = [...cells].sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1))
  const total = sorted.reduce((sum, cell) => sum + cell.value, 0)
  if (sorted.length === 0 || total <= 0 || box.w <= 0 || box.h <= 0) {
    for (const cell of sorted) out.set(cell.id, { x: box.x, y: box.y, w: 0, h: 0 })
    return out
  }
  const scale = (box.w * box.h) / total
  const worst = (areas: number[], side: number) => {
    const sum = areas.reduce((a, b) => a + b, 0)
    return Math.max((side * side * Math.max(...areas)) / (sum * sum), (sum * sum) / (side * side * Math.min(...areas)))
  }
  let { x, y, w, h } = box
  let index = 0
  while (index < sorted.length) {
    const side = Math.min(w, h)
    const areas = [sorted[index].value * scale]
    let end = index + 1
    while (end < sorted.length) {
      const next = [...areas, sorted[end].value * scale]
      if (worst(next, side) > worst(areas, side)) break
      areas.push(sorted[end].value * scale)
      end++
    }
    const rowArea = areas.reduce((a, b) => a + b, 0)
    if (w >= h) {
      const rowW = rowArea / h
      let cursor = y
      for (let i = index; i < end; i++) {
        const cellH = areas[i - index] / rowW
        out.set(sorted[i].id, { x, y: cursor, w: rowW, h: cellH })
        cursor += cellH
      }
      x += rowW
      w -= rowW
    } else {
      const rowH = rowArea / w
      let cursor = x
      for (let i = index; i < end; i++) {
        const cellW = areas[i - index] / rowH
        out.set(sorted[i].id, { x: cursor, y, w: cellW, h: rowH })
        cursor += cellW
      }
      y += rowH
      h -= rowH
    }
    index = end
  }
  return out
}

/** Width-to-height ratios the treemap may take to fill its canvas without becoming a strip. */
export const TREEMAP_ASPECT = { min: 0.8, max: 2.6 } as const

/**
 * DOM-free nested treemap: page -> source -> symbol. Every cited file is one unit of area
 * (plus one per symbol drawn inside it), so a page's area is the number of files it cites
 * in this view. Cross links are not drawn here; the viewer shows them as lines when a cell
 * is focused. Every node is a rectangle centered on its x/y. `aspect` is the canvas
 * width-to-height ratio the rectangle should fill.
 */
export function createTreemapLayout(input: HierarchyInput, options: { aspect?: number } = {}): ForceLayout {
  const origin = { x: LAYOUT_WORLD.width / 2, y: LAYOUT_WORLD.height / 2 }
  const { nodes, byId, links, children, groups } = deriveHierarchy(input, origin)
  const weight = () => 1
  const aspect =
    options.aspect !== undefined && Number.isFinite(options.aspect) && options.aspect > 0
      ? Math.min(TREEMAP_ASPECT.max, Math.max(TREEMAP_ASPECT.min, options.aspect))
      : TREEMAP_SIZE.width / TREEMAP_SIZE.height
  // The framed bounds (with their 20-unit margin) take the canvas aspect, not just the cells.
  const size = { width: TREEMAP_SIZE.width, height: (TREEMAP_SIZE.width + 40) / aspect - 40 }

  const sourceCell = (id: string): Cell => {
    const kids = (children.get(id) ?? []).map((kid) => ({ id: kid, value: weight(), kids: [] }))
    return { id, value: kids.length + 1, kids }
  }
  const pageCells: Cell[] = groups.map((group, index) => {
    const kids = [
      ...group.sources.map(sourceCell),
      ...group.loose.map((id) => ({ id, value: weight(), kids: [] as Cell[] })),
    ]
    const id = group.head ?? `\u0000unattached:${index}`
    return {
      id,
      value: Math.max(
        1,
        kids.reduce((sum, kid) => sum + kid.value, 0),
      ),
      kids,
    }
  })

  const rects = new Map<string, { w: number; h: number; depth: number }>()
  const left = origin.x - size.width / 2
  const top = origin.y - size.height / 2
  const assign = (cells: Cell[], box: Rect, depth: number) => {
    for (const [id, rect] of squarify(cells, box)) {
      const cell = cells.find((candidate) => candidate.id === id)!
      const node = byId.get(id)
      if (node) {
        node.x = rect.x + rect.w / 2
        node.y = rect.y + rect.h / 2
        node.radius = Math.max(3, Math.min(10, Math.min(rect.w, rect.h) / 4))
        rects.set(id, { w: rect.w, h: rect.h, depth })
      }
      if (cell.kids.length === 0) continue
      const header = depth < HEADER.length ? HEADER[depth] : 0
      assign(
        cell.kids,
        { x: rect.x + PAD, y: rect.y + header, w: rect.w - 2 * PAD, h: rect.h - header - PAD },
        depth + 1,
      )
    }
  }
  assign(pageCells, { x: left, y: top, w: size.width, h: size.height }, 0)

  // Draw parents first so children sit on top of them.
  nodes.sort((a, b) => (rects.get(a.id)?.depth ?? 0) - (rects.get(b.id)?.depth ?? 0))
  return {
    nodes,
    links,
    byId,
    stop: () => {},
    reheat: () => {},
    treemap: { rects },
    bounds: {
      minX: left - 20,
      minY: top - 20,
      maxX: left + size.width + 20,
      maxY: top + size.height + 20,
    },
  }
}
