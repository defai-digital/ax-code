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

test("projects recorded summaries and provenanced symbol anchors", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": {
          title: "Guide",
          summary: "Guide summary.",
          symbols: ["Foo", "Ghost", "Foo"],
          sources: ["src/a.ts", "src/b.ts"],
          sourceHashes: {},
        },
        "other.md": {
          title: "Other",
          summary: "",
          symbols: ["Widget"],
          sources: ["src/c.ts"],
          sourceHashes: {},
        },
      },
    },
    { snapshot: "symbols", sourceContents: new Map([["src/a.ts", "export class Foo {}"]]) },
  )
  expect(graph.schemaVersion).toBe(1)
  const guide = graph.nodes.find((n) => n.id === "page:guide.md")!
  expect(guide.summary).toBe("Guide summary.")
  expect(guide.symbols).toEqual([
    { name: "Foo", provenance: "verified" },
    { name: "Ghost", provenance: "inferred" },
  ])
  const other = graph.nodes.find((n) => n.id === "page:other.md")!
  expect(other.summary).toBe("")
  expect(other.symbols).toEqual([{ name: "Widget", provenance: "unavailable" }])
  const source = graph.nodes.find((n) => n.id === "source:src/a.ts")!
  expect(source.summary).toBe("")
  expect(source.symbols).toEqual([])
})

test("defaults missing manifest summary and symbols for hand-written manifests", () => {
  const graph = projectWikiManifest(manifest(), { snapshot: "fixture" })
  expect(graph.nodes[0].summary).toBe("")
  expect(graph.nodes[0].symbols).toEqual([])
})

test("enforces symbol and summary caps with clear failures", () => {
  const page = (symbols: unknown, summary: unknown) => ({
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: { "guide.md": { title: "Guide", summary, symbols, sources: ["src/a.ts"], sourceHashes: {} } },
  })
  expect(
    projectWikiManifest(
      page(
        Array.from({ length: 32 }, (_, i) => `s${i}`),
        "x",
      ),
      { snapshot: "ok" },
    ).nodes[0].symbols,
  ).toHaveLength(32)
  expect(() => projectWikiManifest(page(Array(33).fill("s"), "x"), { snapshot: "many" })).toThrow(/node symbol limit/)
  expect(() => projectWikiManifest(page(["x".repeat(257)], "x"), { snapshot: "long" })).toThrow()
  expect(() => projectWikiManifest(page([], "x".repeat(2049)), { snapshot: "long" })).toThrow()
  expect(() => projectWikiManifest(page(["ok", 7], "x"), { snapshot: "bad" })).toThrow()
  expect(projectWikiManifest(page([], "x".repeat(2048)), { snapshot: "edge" }).nodes[0].summary).toHaveLength(2048)
})

test("parses populated nodes and rejects bad provenance, duplicates, and versions", () => {
  const graph = projectWikiManifest(manifest(), { snapshot: "fixture" })
  const populated = {
    ...graph,
    nodes: [{ ...graph.nodes[0], summary: "S", symbols: [{ name: "A", provenance: "verified" }] }, graph.nodes[1]],
  }
  expect(parseWikiGraph(populated).nodes[0].symbols).toEqual([{ name: "A", provenance: "verified" }])
  const bad = (node: unknown) => ({ ...graph, nodes: [node, graph.nodes[1]] })
  expect(() => parseWikiGraph(bad({ ...graph.nodes[0], symbols: [{ name: "A", provenance: "maybe" }] }))).toThrow(
    /provenance/,
  )
  expect(() =>
    parseWikiGraph(
      bad({
        ...graph.nodes[0],
        symbols: [
          { name: "A", provenance: "verified" },
          { name: "A", provenance: "verified" },
        ],
      }),
    ),
  ).toThrow(/Duplicate/)
  expect(() => parseWikiGraph({ ...graph, schemaVersion: 3 })).toThrow(/Unsupported/)
  expect(() => parseWikiGraph({ ...graph, schemaVersion: "1" })).toThrow(/Unsupported/)
  const detached = parseWikiGraph({ ...graph, nodes: [{ ...graph.nodes[0], injected: "x" }, graph.nodes[1]] })
  expect(detached.nodes[0]).not.toHaveProperty("injected")
})

test("projects symbol nodes and contains edges with inherited freshness", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": { title: "Guide", sources: ["src/a.ts"], sourceHashes: { "src/a.ts": hash } },
      },
    },
    {
      snapshot: "inventory",
      observed: new Map([["src/a.ts", hash]]),
      inventory: new Map([
        [
          "src/a.ts",
          [
            { name: "Foo", qualified: "Foo", kind: "class" },
            { name: "bar", qualified: "Foo.bar", kind: "method" },
            { name: "bar", qualified: "Foo.bar", kind: "method" },
          ],
        ],
        ["src/uncited.ts", [{ name: "Nope", qualified: "Nope", kind: "function" }]],
      ]),
    },
  )
  expect(graph.nodes.map((n) => n.id)).toEqual([
    "page:guide.md",
    "source:src/a.ts",
    "symbol:src/a.ts#Foo",
    "symbol:src/a.ts#Foo.bar",
  ])
  const symbol = graph.nodes.find((n) => n.id === "symbol:src/a.ts#Foo.bar")!
  expect(symbol).toMatchObject({
    kind: "symbol",
    label: "bar",
    path: "src/a.ts",
    detail: "method Foo.bar",
    freshness: "fresh",
    recordedReferences: 0,
  })
  expect(graph.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
    ["page:guide.md", "source:src/a.ts", "references-source"],
    ["source:src/a.ts", "symbol:src/a.ts#Foo", "contains"],
    ["source:src/a.ts", "symbol:src/a.ts#Foo.bar", "contains"],
  ])
  expect(graph.nodes.find((n) => n.id === "source:src/a.ts")!.recordedReferences).toBe(1)
})

test("validates contains endpoints and inventory entries strictly", () => {
  const graph = projectWikiManifest(manifest(), { snapshot: "fixture" })
  const symbol = {
    id: "symbol:src/a.ts#Foo",
    kind: "symbol",
    label: "Foo",
    path: "src/a.ts",
    freshness: "unknown",
    recordedReferences: 0,
    summary: "",
    symbols: [],
    detail: "class Foo",
  }
  const ok = {
    ...graph,
    nodes: [...graph.nodes, symbol],
    edges: [
      ...graph.edges,
      { from: "source:src/a.ts", to: "symbol:src/a.ts#Foo", kind: "contains", freshness: "unknown" },
    ],
  }
  expect(parseWikiGraph(ok).edges).toHaveLength(2)
  const bad = (edge: unknown) => ({ ...ok, edges: [...graph.edges, edge] })
  expect(() =>
    parseWikiGraph(bad({ from: "page:guide.md", to: "symbol:src/a.ts#Foo", kind: "contains", freshness: "unknown" })),
  ).toThrow(/relationship/)
  expect(() =>
    parseWikiGraph(bad({ from: "source:src/a.ts", to: "source:src/a.ts", kind: "contains", freshness: "unknown" })),
  ).toThrow(/relationship/)
  expect(() =>
    parseWikiGraph(
      bad({ from: "page:guide.md", to: "symbol:src/a.ts#Foo", kind: "references-source", freshness: "unknown" }),
    ),
  ).toThrow(/relationship/)
  expect(() =>
    projectWikiManifest(manifest(), {
      snapshot: "bad",
      inventory: new Map([["src/a.ts", [{ name: "", qualified: "x", kind: "class" }]]]),
    }),
  ).toThrow()
  expect(() =>
    projectWikiManifest(manifest(), {
      snapshot: "bad",
      inventory: new Map([["src/a.ts", [{ name: "x".repeat(257), qualified: "x", kind: "class" }]]]),
    }),
  ).toThrow()
})

test("shares view caps across symbols with neighborhoods together", () => {
  const inventory = new Map([
    ["src/a.ts", Array.from({ length: 300 }, (_, i) => ({ name: `s${i}`, qualified: `s${i}`, kind: "function" }))],
  ])
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: { "guide.md": { title: "Guide", sources: ["src/a.ts"], sourceHashes: {} } },
    },
    { snapshot: "capped", inventory },
  )
  expect(graph.nodes).toHaveLength(200)
  expect(graph.nodes[0].id).toBe("page:guide.md")
  expect(graph.nodes[1].id).toBe("source:src/a.ts")
  expect(graph.omitted).toEqual({ nodes: 102, edges: 102 })
})
