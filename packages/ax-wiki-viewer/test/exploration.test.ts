import { expect, test } from "vitest"
import { citationSummary, localNeighborhood } from "../src/exploration.js"

const nodes = [
  { id: "a", kind: "page" as const },
  { id: "b", kind: "page" as const },
  { id: "s", kind: "source" as const },
  { id: "t", kind: "source" as const },
  { id: "symbol", kind: "symbol" as const },
]
const edges = [
  { from: "a", to: "s", kind: "references-source" as const },
  { from: "b", to: "s", kind: "references-source" as const },
  { from: "b", to: "t", kind: "references-source" as const },
  { from: "s", to: "t", kind: "uses" as const },
  { from: "s", to: "symbol", kind: "contains" as const },
]

test("sharing and placed cells do not confuse imports or duplicate citations with citing pages", () => {
  const summary = citationSummary({
    nodes,
    edges: [...edges, edges[0], { from: "missing", to: "s", kind: "references-source" }],
  })
  expect(summary.pages.get("a")).toEqual({ admitted: 1, placed: 1, shared: 1 })
  expect(summary.pages.get("b")).toEqual({ admitted: 2, placed: 1, shared: 1 })
  expect([...summary.citingPages.get("s")!].sort()).toEqual(["a", "b"])
})

test("one/two hop scope follows typed evidence in both directions and never crosses filtered nodes", () => {
  expect([...localNeighborhood(nodes, edges, { root: "a", hops: 1 }, "all")].sort()).toEqual(["a", "s"])
  expect([...localNeighborhood(nodes, edges, { root: "a", hops: 2 }, "citations")].sort()).toEqual(["a", "b", "s"])
  expect([...localNeighborhood(nodes, edges, { root: "t", hops: 1 }, "imports")].sort()).toEqual(["s", "t"])
  expect([
    ...localNeighborhood(
      nodes.filter((n) => n.id !== "s"),
      edges,
      { root: "a", hops: 2 },
      "all",
    ),
  ]).toEqual(["a"])
  expect(localNeighborhood(nodes, edges, { root: "missing", hops: 2 }, "all").size).toBe(0)
})
