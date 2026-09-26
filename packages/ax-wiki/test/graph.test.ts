import { expect, test } from "vitest"
import { GRAPH_LIMITS, graphRelativePath, parseWikiGraph, projectWikiManifest } from "../src/graph.js"

const hash = "a".repeat(64)
const manifest = () => ({
  schemaVersion: 1,
  generator: "ax-wiki",
  pages: {
    "guide.md": { title: "Guide", sources: ["src/a.ts", "src/a.ts"], sourceHashes: { "src/a.ts": hash } },
  },
})

test("projects only recorded directed membership and keeps freshness unknown without observations", () => {
  const graph = projectWikiManifest(manifest(), { snapshot: "fixture" })
  expect(graph.nodes.map((n) => n.id)).toEqual(["page:guide.md", "source:src/a.ts"])
  expect(graph.edges).toEqual([
    {
      from: "page:guide.md",
      to: "source:src/a.ts",
      kind: "references-source",
      freshness: "unknown",
      recordedHash: hash,
    },
  ])
  expect(graph.nodes.every((n) => n.freshness === "unknown")).toBe(true)
  expect(graph.codeRelationships).toBe("unavailable")
})

test("compares each page's recorded evidence and aggregates conflicting freshness honestly", () => {
  const input = manifest()
  Object.assign(input.pages, {
    "other.md": { title: "Other", sources: ["src/a.ts"], sourceHashes: { "src/a.ts": "b".repeat(64) } },
  })
  const graph = projectWikiManifest(input, { snapshot: "fixture", observed: new Map([["src/a.ts", hash]]) })
  expect(graph.nodes.map((n) => [n.id, n.freshness])).toEqual([
    ["page:guide.md", "fresh"],
    ["source:src/a.ts", "stale"],
    ["page:other.md", "stale"],
  ])
  expect(
    projectWikiManifest(input, { snapshot: "fixture", observed: new Map([["src/a.ts", null]]) }).nodes.every(
      (n) => n.freshness === "stale",
    ),
  ).toBe(true)
})

test.each(["/tmp/a", "../a", "a/../b", "a//b", "a/./b", "C:/a", "C:a", "\\\\server\\share", "a\u0000b", "a\u202eb"])(
  "rejects unsafe relative path %j",
  (value) => {
    expect(() => graphRelativePath(value)).toThrow()
  },
)

test("deterministically caps without dangling edges and reports known omissions", () => {
  const pages = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [
      `p${String(i).padStart(3, "0")}.md`,
      { title: "Page", sources: [`src/${i}.ts`], sourceHashes: {} },
    ]),
  )
  const input = { schemaVersion: 1, generator: "ax-wiki", pages }
  const graph = projectWikiManifest(input, { snapshot: "fixture" })
  expect(graph.nodes).toHaveLength(GRAPH_LIMITS.nodes)
  expect(graph.edges).toHaveLength(100)
  expect(graph.omitted).toEqual({ nodes: 400, edges: 200 })
  expect(
    projectWikiManifest(
      { ...input, pages: Object.fromEntries(Object.entries(pages).reverse()) },
      { snapshot: "fixture" },
    ),
  ).toEqual(graph)
  expect(parseWikiGraph(graph)).toEqual(graph)
})

test("caps dense relationships independently of nodes", () => {
  const sources = Array.from({ length: 30 }, (_, i) => `src/${i}.ts`)
  const pages = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [`${i}.md`, { title: "Page", sources, sourceHashes: {} }]),
  )
  const graph = projectWikiManifest({ schemaVersion: 1, generator: "ax-wiki", pages }, { snapshot: "fixture" })
  expect(graph.nodes).toHaveLength(60)
  expect(graph.edges).toHaveLength(500)
  expect(graph.omitted).toEqual({ nodes: 0, edges: 400 })
})

test("rejects malformed versions, duplicate IDs, dangling endpoints and invented relations", () => {
  const graph = projectWikiManifest(manifest(), { snapshot: "fixture" })
  for (const bad of [
    { ...graph, schemaVersion: 2 },
    { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
    { ...graph, nodes: graph.nodes.slice(0, 1) },
    { ...graph, edges: [{ ...graph.edges[0], kind: "calls" }] },
    { ...graph, edges: [graph.edges[0], graph.edges[0]] },
    { ...graph, edges: [{ ...graph.edges[0], to: graph.edges[0].from }] },
    { ...graph, omitted: { nodes: -1, edges: 0 } },
  ])
    expect(() => parseWikiGraph(bad)).toThrow()
})

test("allowlists exports, detaches input, and preserves hostile labels as inert text", () => {
  const input = manifest()
  input.pages["guide.md"].title = '</script><img src=x onerror="attack()">'
  const graph = projectWikiManifest(input, { snapshot: "fixture" })
  const parsed = parseWikiGraph({ ...graph, root: "/private/root", token: "secret" })
  graph.nodes[0].label = "Changed"
  expect(parsed.nodes[0].label).toBe(input.pages["guide.md"].title)
  expect(parsed).not.toHaveProperty("root")
  expect(parsed).not.toHaveProperty("token")
})

test("empty manifest is valid; unsupported and oversized input fail clearly", () => {
  expect(
    projectWikiManifest({ schemaVersion: 1, generator: "ax-wiki", pages: {} }, { snapshot: "empty" }).nodes,
  ).toEqual([])
  expect(() =>
    projectWikiManifest({ schemaVersion: 1, generator: "foreign", pages: {} }, { snapshot: "bad" }),
  ).toThrow()
  const input = manifest()
  input.pages["guide.md"].sources = Array(50_001).fill("src/a.ts")
  expect(() => projectWikiManifest(input, { snapshot: "large" })).toThrow(/reference limit/)
})

test("retains stale evidence beyond the view cap and discloses each node's full reference count", () => {
  const sources = Array.from({ length: 200 }, (_, i) => `src/${String(i).padStart(3, "0")}.ts`)
  const hashes = Object.fromEntries(sources.map((source) => [source, hash]))
  const observed = new Map(sources.map((source) => [source, hash]))
  observed.set(sources[199], "b".repeat(64))
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": { title: "Guide", sources, sourceHashes: hashes },
      },
    },
    { snapshot: "cap", observed },
  )
  expect(graph.nodes[0].freshness).toBe("stale")
  expect(graph.nodes[0].recordedReferences).toBe(200)
  expect(graph.edges).toHaveLength(199)
  expect(graph.edges.every((edge) => edge.freshness === "fresh")).toBe(true)
  expect(graph.omitted).toEqual({ nodes: 1, edges: 1 })
  observed.set(sources[199], "invalid-hash")
  expect(() =>
    projectWikiManifest(
      {
        schemaVersion: 1,
        generator: "ax-wiki",
        pages: {
          "guide.md": { title: "Guide", sources, sourceHashes: hashes },
        },
      },
      { snapshot: "cap", observed },
    ),
  ).toThrow(/content hash/)
})
