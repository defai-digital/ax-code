import { expect, test } from "vitest"
import { createTreemapLayout, squarify, TREEMAP_SIZE } from "../src/treemap-layout.js"

const nodes = [
  { id: "p:a", kind: "page" as const },
  { id: "p:b", kind: "page" as const },
  { id: "s:1", kind: "source" as const },
  { id: "s:2", kind: "source" as const },
  { id: "s:3", kind: "source" as const },
  { id: "s:orphan", kind: "source" as const },
  { id: "y:1", kind: "symbol" as const },
  { id: "y:2", kind: "symbol" as const },
]
const edges = [
  { from: "p:a", to: "s:1", kind: "references-source" },
  { from: "p:a", to: "s:2", kind: "references-source" },
  { from: "p:b", to: "s:2", kind: "references-source" },
  { from: "p:b", to: "s:3", kind: "references-source" },
  { from: "s:1", to: "y:1", kind: "contains" },
  { from: "s:1", to: "y:2", kind: "contains" },
  { from: "s:1", to: "s:3", kind: "uses" },
]

test("squarify tiles the box exactly and is deterministic", () => {
  const cells = [5, 3, 3, 2, 1, 1].map((value, i) => ({ id: `c${i}`, value, kids: [] }))
  const box = { x: 10, y: 20, w: 400, h: 300 }
  const out = squarify(cells, box)
  expect(out.size).toBe(cells.length)
  let area = 0
  for (const rect of out.values()) {
    expect(rect.x).toBeGreaterThanOrEqual(box.x - 1e-6)
    expect(rect.y).toBeGreaterThanOrEqual(box.y - 1e-6)
    expect(rect.x + rect.w).toBeLessThanOrEqual(box.x + box.w + 1e-6)
    expect(rect.y + rect.h).toBeLessThanOrEqual(box.y + box.h + 1e-6)
    area += rect.w * rect.h
  }
  expect(area).toBeCloseTo(box.w * box.h, 4)
  const again = squarify([...cells].reverse(), box)
  for (const [id, rect] of out) expect(again.get(id)).toEqual(rect)
  expect(squarify([], box).size).toBe(0)
})

test("treemap nests sources inside pages and symbols inside sources", () => {
  const layout = createTreemapLayout({ nodes, edges })
  const rect = (id: string) => {
    const node = layout.byId.get(id)!
    const size = layout.treemap!.rects.get(id)!
    return { x0: node.x - size.w / 2, y0: node.y - size.h / 2, x1: node.x + size.w / 2, y1: node.y + size.h / 2 }
  }
  const inside = (child: string, parent: string) => {
    const c = rect(child),
      p = rect(parent)
    expect(c.x0).toBeGreaterThanOrEqual(p.x0 - 1e-6)
    expect(c.y0).toBeGreaterThanOrEqual(p.y0 - 1e-6)
    expect(c.x1).toBeLessThanOrEqual(p.x1 + 1e-6)
    expect(c.y1).toBeLessThanOrEqual(p.y1 + 1e-6)
  }
  inside("s:1", "p:a")
  inside("s:3", "p:b")
  inside("y:1", "s:1")
  inside("y:2", "s:1")
  for (const node of layout.nodes) {
    expect(Number.isFinite(node.x) && Number.isFinite(node.y)).toBe(true)
    expect(layout.treemap!.rects.get(node.id)!.w).toBeGreaterThan(0)
  }
  // Parents are drawn before their children.
  const order = layout.nodes.map((node) => node.id)
  expect(order.indexOf("p:a")).toBeLessThan(order.indexOf("s:1"))
  expect(order.indexOf("s:1")).toBeLessThan(order.indexOf("y:1"))
  expect(layout.bounds!.maxX - layout.bounds!.minX).toBeGreaterThan(TREEMAP_SIZE.width)
})

test("treemap handles empty and orphan-only graphs", () => {
  expect(createTreemapLayout({ nodes: [], edges: [] }).nodes).toEqual([])
  const only = createTreemapLayout({ nodes: [{ id: "s", kind: "source" }], edges: [] })
  expect(layoutFinite(only.nodes[0])).toBe(true)
})

function layoutFinite(node: { x: number; y: number }) {
  return Number.isFinite(node.x) && Number.isFinite(node.y)
}

test("treemap gives every cited file the same area and fills the requested aspect", () => {
  const input = {
    nodes: [
      { id: "p:a", kind: "page" as const },
      { id: "p:b", kind: "page" as const },
      ...["s:1", "s:2", "s:3"].map((id) => ({ id, kind: "source" as const })),
    ],
    edges: [
      { from: "p:a", to: "s:1", kind: "references-source" },
      { from: "p:a", to: "s:2", kind: "references-source" },
      { from: "p:b", to: "s:3", kind: "references-source" },
      // Imports no longer inflate a file's cell.
      { from: "s:1", to: "s:3", kind: "uses" },
      { from: "s:2", to: "s:3", kind: "uses" },
    ],
  }
  const layout = createTreemapLayout(input, { aspect: 2 })
  const area = (id: string) => {
    const rect = layout.treemap!.rects.get(id)!
    return rect.w * rect.h
  }
  const pageA = area("p:a"),
    pageB = area("p:b")
  expect(pageA / pageB).toBeCloseTo(2, 1)
  expect(area("s:1") / area("s:2")).toBeCloseTo(1, 1)
  const bounds = layout.bounds!
  expect((bounds.maxX - bounds.minX) / (bounds.maxY - bounds.minY)).toBeCloseTo(2, 5)
  // Extreme canvases are clamped so the map never becomes a strip.
  const wide = createTreemapLayout(input, { aspect: 10 }).bounds!
  expect((wide.maxX - wide.minX) / (wide.maxY - wide.minY)).toBeCloseTo(2.6, 5)
})
