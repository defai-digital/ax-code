import { expect, test } from "vitest"
import { createRadialLayout } from "../src/radial-layout.js"

const nodes = [
  { id: "p:a", kind: "page" as const },
  { id: "p:b", kind: "page" as const },
  { id: "s:1", kind: "source" as const },
  { id: "s:2", kind: "source" as const },
  { id: "s:3", kind: "source" as const },
  { id: "s:orphan", kind: "source" as const },
  { id: "y:1", kind: "symbol" as const },
  { id: "y:2", kind: "symbol" as const },
  { id: "y:loose", kind: "symbol" as const },
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
const radius = (layout: ReturnType<typeof createRadialLayout>, id: string) => {
  const node = layout.byId.get(id)!
  return Math.hypot(node.x - layout.radial!.cx, node.y - layout.radial!.cy)
}

test("derives a deterministic hierarchy with the first citing page as primary parent", () => {
  const layout = createRadialLayout({ nodes, edges })
  const parent = layout.radial!.treeParent
  expect(parent.get("s:2")).toBe("p:a")
  expect(parent.get("s:3")).toBe("p:b")
  expect(parent.get("y:1")).toBe("s:1")
  expect(parent.has("s:orphan")).toBe(false)
  expect(
    createRadialLayout({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }).byId.get("s:2"),
  ).toMatchObject({
    x: layout.byId.get("s:2")!.x,
    y: layout.byId.get("s:2")!.y,
  })
})

test("puts every leaf on the outer ring", () => {
  const layout = createRadialLayout({ nodes, edges })
  const outer = radius(layout, "y:1")
  for (const id of ["y:2", "y:loose", "s:2", "s:3", "s:orphan"]) expect(radius(layout, id)).toBeCloseTo(outer)
  // A source that owns symbols is internal, so it stays inside.
  expect(radius(layout, "s:1")).toBeLessThan(outer)
})

test("a parent sits at the mean angle of its children and wedges do not overlap", () => {
  const layout = createRadialLayout({ nodes, edges })
  const angle = (id: string) => layout.radial!.angles.get(id)!
  expect(angle("s:1")).toBeCloseTo((angle("y:1") + angle("y:2")) / 2)
  expect(angle("p:a")).not.toBeCloseTo(angle("p:b"))
})

test("bubbles never overlap on a dense ring", () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ id: `s:${i}`, kind: "source" as const }))
  const dense = createRadialLayout({
    nodes: [{ id: "p", kind: "page" }, ...many],
    edges: many.map((n) => ({ from: "p", to: n.id, kind: "references-source" })),
  })
  const list = dense.nodes.filter((n) => n.kind === "source")
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++)
      expect(Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y)).toBeGreaterThan(list[i].radius + list[j].radius)
})

test("handles empty and orphan-only graphs", () => {
  expect(createRadialLayout({ nodes: [], edges: [] }).nodes).toEqual([])
  const only = createRadialLayout({ nodes: [{ id: "s", kind: "source" }], edges: [] })
  expect(Number.isFinite(only.nodes[0].x) && Number.isFinite(only.nodes[0].y)).toBe(true)
})
