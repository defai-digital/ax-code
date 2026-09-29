import { expect, test } from "vitest"
import { parseWikiGraph, projectWikiManifest } from "@ax-code/ax-wiki/graph"
import {
  countsBarText,
  defaultFilters,
  focusDirection,
  isDefaultFilters,
  isNodeVisible,
  overlayText,
  viewCounts,
  viewState,
} from "../src/visibility.js"

const HASH_A = "a".repeat(64)
const HASH_B = "b".repeat(64)
const HASH_C = "c".repeat(64)
const WRONG = "0".repeat(64)

const graph = projectWikiManifest(
  {
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: {
      "guide.md": {
        title: "Guide",
        sources: ["src/a.ts", "src/b.ts"],
        sourceHashes: { "src/a.ts": HASH_A, "src/b.ts": HASH_B },
      },
      "other.md": {
        title: "Other",
        sources: ["src/b.ts", "src/c.ts"],
        sourceHashes: { "src/b.ts": HASH_B, "src/c.ts": HASH_C },
      },
    },
  },
  {
    snapshot: "visibility-fixture",
    observed: new Map([
      ["src/a.ts", HASH_A],
      ["src/b.ts", WRONG],
    ]),
  },
)

test("fixture carries all three freshness states", () => {
  const states = new Set(graph.nodes.map((node) => node.freshness))
  expect(states).toEqual(new Set(["fresh", "stale", "unknown"]))
})

test("default filters reveal every snapshot node and edge", () => {
  const counts = viewCounts(graph, defaultFilters())
  expect(isDefaultFilters(defaultFilters())).toBe(true)
  expect(counts.visibleNodes).toBe(graph.nodes.length)
  expect(counts.visibleEdges).toBe(graph.edges.length)
  expect(counts.filteredNodes).toBe(0)
  expect(counts.filteredEdges).toBe(0)
  expect(viewState(graph, defaultFilters())).toBe("ok")
  for (const node of graph.nodes) expect(isNodeVisible(node, defaultFilters())).toBe(true)
})

test("kind toggles hide nodes and their incident edges without touching recorded totals", () => {
  const filters = { ...defaultFilters(), kinds: { page: true, source: false } }
  const counts = viewCounts(graph, filters)
  expect(counts.visibleNodes).toBe(2)
  expect(counts.visibleEdges).toBe(0)
  expect(counts.recordedNodes).toBe(graph.nodes.length + graph.omitted.nodes)
  expect(counts.recordedEdges).toBe(graph.edges.length + graph.omitted.edges)
  expect(counts.visibleNodes + counts.filteredNodes + counts.omittedNodes).toBe(counts.recordedNodes)
  expect(counts.visibleEdges + counts.filteredEdges + counts.omittedEdges).toBe(counts.recordedEdges)
  expect(isDefaultFilters(filters)).toBe(false)
})

test("freshness toggles hide by state and converge on zero-match when all are off", () => {
  const onlyFresh = { ...defaultFilters(), freshness: { fresh: true, stale: false, unknown: false } }
  expect(viewCounts(graph, onlyFresh).visibleNodes).toBe(1)
  const none = { ...defaultFilters(), freshness: { fresh: false, stale: false, unknown: false } }
  expect(viewCounts(graph, none).visibleNodes).toBe(0)
  expect(viewState(graph, none)).toBe("zero-match")
})

test("query matches label and path case-insensitively", () => {
  const byTitle = { ...defaultFilters(), query: "  GUIDE " }
  expect(graph.nodes.filter((node) => isNodeVisible(node, byTitle)).map((node) => node.id)).toEqual(["page:guide.md"])
  const byPath = { ...defaultFilters(), query: "SRC/B" }
  expect(graph.nodes.filter((node) => isNodeVisible(node, byPath)).map((node) => node.id)).toEqual(["source:src/b.ts"])
})

test("chip and legend label counts equal snapshot totals", () => {
  const counts = viewCounts(graph, defaultFilters())
  expect(counts.byKind).toEqual({ page: 2, source: 3 })
  expect(counts.byFreshness).toEqual({ fresh: 1, stale: 3, unknown: 1 })
  expect(counts.byKind.page + counts.byKind.source).toBe(graph.nodes.length)
  expect(counts.byFreshness.fresh + counts.byFreshness.stale + counts.byFreshness.unknown).toBe(graph.nodes.length)
})

test("omitted records are disclosed but never counted as visible", () => {
  const capped = parseWikiGraph({
    schemaVersion: 1,
    snapshot: "capped",
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes: [
      { id: "page:g.md", kind: "page", label: "G", path: "g.md", freshness: "unknown", recordedReferences: 5 },
      { id: "source:s.ts", kind: "source", label: "s.ts", path: "s.ts", freshness: "unknown", recordedReferences: 1 },
    ],
    edges: [{ from: "page:g.md", to: "source:s.ts", kind: "references-source", freshness: "unknown" }],
    omitted: { nodes: 4, edges: 4 },
  })
  const counts = viewCounts(capped, defaultFilters())
  expect(counts.visibleNodes).toBe(2)
  expect(counts.visibleEdges).toBe(1)
  expect(counts.recordedNodes).toBe(6)
  expect(counts.recordedEdges).toBe(5)
  expect(countsBarText(counts, "ok")).toBe(
    "2 of 6 nodes · 1 of 5 edges in view · 4 nodes and 4 edges beyond the view cap",
  )
})

test("degenerate states are named instead of rendering a blank canvas", () => {
  const empty = parseWikiGraph({
    schemaVersion: 1,
    snapshot: "empty",
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes: [],
    edges: [],
    omitted: { nodes: 0, edges: 0 },
  })
  expect(viewState(empty, defaultFilters())).toBe("empty")
  const kindsOff = { ...defaultFilters(), kinds: { page: false, source: false } }
  expect(viewState(graph, kindsOff)).toBe("all-kinds-hidden")
  const single = { ...defaultFilters(), query: "other.md" }
  expect(viewState(graph, single)).toBe("single-node")
  const noEdges = { ...defaultFilters(), kinds: { page: true, source: false } }
  expect(viewState(graph, noEdges)).toBe("no-edges")
  expect(overlayText("zero-match", viewCounts(graph, { ...defaultFilters(), query: "nope" }))).toContain(
    "No nodes match",
  )
  expect(overlayText("single-node", viewCounts(graph, single))).toContain("single node")
  expect(overlayText("empty", viewCounts(empty, defaultFilters()))).toContain("Empty snapshot")
})

test("counts bar discloses filtered nodes and stays stable under default filters", () => {
  const counts = viewCounts(graph, defaultFilters())
  expect(countsBarText(counts, "ok")).toBe("5 of 5 nodes · 4 of 4 edges in view")
  const filtered = viewCounts(graph, { ...defaultFilters(), query: "guide" })
  expect(countsBarText(filtered, "single-node")).toContain("hidden by filters")
})

test("focus direction reads outgoing, incoming, unrelated, and self-loop edges", () => {
  expect(focusDirection({ from: "a", to: "b" }, "a")).toBe("outgoing")
  expect(focusDirection({ from: "a", to: "b" }, "b")).toBe("incoming")
  expect(focusDirection({ from: "a", to: "b" }, "c")).toBeNull()
  expect(focusDirection({ from: "a", to: "a" }, "a")).toBeNull()
})

test("counting never mutates its inputs", () => {
  const filters = defaultFilters()
  const frozen = structuredClone(filters)
  viewCounts(graph, filters)
  viewState(graph, filters)
  expect(filters).toEqual(frozen)
})
