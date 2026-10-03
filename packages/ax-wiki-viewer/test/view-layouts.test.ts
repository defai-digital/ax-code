import { expect, test } from "vitest"
import { createArcLayout, ARC_SPACING } from "../src/arc-layout.js"
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

test("arc layout puts every node on one baseline in hierarchy order without overlap", () => {
  const layout = createArcLayout({ nodes, edges })
  const ys = new Set(layout.nodes.map((node) => node.y))
  expect(ys.size).toBe(1)
  const xs = (id: string) => layout.byId.get(id)!.x
  // page a, its files (each followed by its symbols), then page b ...
  expect(xs("p:a")).toBeLessThan(xs("s:1"))
  expect(xs("s:1")).toBeLessThan(xs("y:1"))
  expect(xs("y:2")).toBeLessThan(xs("s:2"))
  expect(xs("s:2")).toBeLessThan(xs("p:b"))
  const sorted = [...layout.nodes].sort((a, b) => a.x - b.x)
  for (let i = 1; i < sorted.length; i++) {
    expect(sorted[i].x - sorted[i - 1].x).toBeGreaterThanOrEqual(ARC_SPACING - 1e-9)
    expect(sorted[i].x - sorted[i - 1].x).toBeGreaterThan(sorted[i].radius + sorted[i - 1].radius - 1)
  }
  expect(layout.arc?.baselineY).toBe([...ys][0])
  expect(layout.bounds!.maxX).toBeGreaterThan(layout.bounds!.minX)
})

test("arc layout handles empty graphs", () => {
  const layout = createArcLayout({ nodes: [], edges: [] })
  expect(layout.nodes).toEqual([])
  expect(Number.isFinite(layout.bounds!.minX)).toBe(true)
})

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
