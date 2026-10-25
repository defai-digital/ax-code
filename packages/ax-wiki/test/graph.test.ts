import { expect, test } from "vitest"
import { cutGraphText, GRAPH_LIMITS, graphRelativePath, parseWikiGraph, projectWikiManifest } from "../src/graph.js"

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
    ["page:other.md", "stale"],
    ["source:src/a.ts", "stale"],
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
  // Pages are admitted first, so a wiki with more pages than the cap keeps pages only.
  expect(graph.nodes).toHaveLength(GRAPH_LIMITS.nodes)
  expect(graph.nodes.every((node) => node.kind === "page")).toBe(true)
  expect(graph.edges).toHaveLength(0)
  expect(graph.omitted).toEqual({ nodes: 400, edges: 300 })
  expect(graph.pages).toHaveLength(300)
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
  expect(() => projectWikiManifest(page("s", "x"), { snapshot: "shape" })).toThrow(/page symbols/)
  expect(() => projectWikiManifest(page(["x".repeat(257)], "x"), { snapshot: "long" })).toThrow()
  expect(() => projectWikiManifest(page([], "x".repeat(2049)), { snapshot: "long" })).toThrow()
  expect(() => projectWikiManifest(page(["ok", 7], "x"), { snapshot: "bad" })).toThrow()
  expect(projectWikiManifest(page([], "x".repeat(2048)), { snapshot: "edge" }).nodes[0].summary).toHaveLength(2048)
})

test("caps page symbols as a view limit instead of rejecting a generator-sized manifest", () => {
  // The native generator records up to 80 symbols and 20 glosses per page.
  const symbols = Array.from({ length: 80 }, (_, i) => `s${String(i).padStart(2, "0")}`)
  const glossed = ["s79", "s40", "s05"]
  const page = (extra: Record<string, unknown>) => ({
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: { "guide.md": { title: "Guide", summary: "x", sources: ["src/a.ts"], sourceHashes: {}, ...extra } },
  })
  const plain = projectWikiManifest(page({ symbols }), { snapshot: "plain" }).nodes[0].symbols
  expect(plain.map((anchor) => anchor.name)).toEqual(symbols.slice(0, 32))
  const graph = projectWikiManifest(
    page({ symbols, symbolSummaries: glossed.map((name) => ({ name, summary: `Gloss for ${name}.` })) }),
    { snapshot: "glossed" },
  )
  const kept = graph.nodes[0].symbols.map((anchor) => anchor.name)
  // Glossed names survive the cap; the kept set stays in recorded order.
  expect(kept).toEqual([...symbols.slice(0, 30), "s40", "s79"])
  expect(parseWikiGraph(graph).nodes[0].symbols).toHaveLength(32)
  // Names past the cap are still validated, and duplicates never consume a slot.
  expect(() => projectWikiManifest(page({ symbols: [...symbols, 7] }), { snapshot: "bad" })).toThrow()
  expect(
    projectWikiManifest(page({ symbols: [...Array(40).fill("dup"), ...symbols] }), { snapshot: "dup" }).nodes[0]
      .symbols,
  ).toHaveLength(32)
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

test("projects uses edges between cited sources with combined freshness", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": {
          title: "Guide",
          sources: ["src/a.ts", "src/b.ts"],
          sourceHashes: { "src/a.ts": hash, "src/b.ts": hash },
        },
      },
    },
    {
      snapshot: "imports",
      observed: new Map([
        ["src/a.ts", hash],
        ["src/b.ts", null],
      ]),
      imports: new Map([
        ["src/a.ts", ["src/b.ts", "src/b.ts", "src/a.ts", "src/uncited.ts"]],
        ["src/b.ts", ["src/a.ts"]],
      ]),
    },
  )
  const uses = graph.edges.filter((e) => e.kind === "uses")
  // Duplicates, self imports, and uncited targets never become edges.
  expect(uses.map((e) => [e.from, e.to])).toEqual([
    ["source:src/a.ts", "source:src/b.ts"],
    ["source:src/b.ts", "source:src/a.ts"],
  ])
  // Either endpoint stale marks the edge stale.
  expect(uses.every((e) => e.freshness === "stale")).toBe(true)
  expect(graph.nodes.find((n) => n.id === "source:src/a.ts")!.recordedReferences).toBe(1)
})

test("emits inventory-derived edges once when pages share a source", () => {
  const input = {
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: {
      "guide.md": { title: "Guide", sources: ["src/a.ts", "src/b.ts"], sourceHashes: {} },
      "other.md": { title: "Other", sources: ["src/a.ts"], sourceHashes: {} },
    },
  }
  const graph = projectWikiManifest(input, {
    snapshot: "shared",
    inventory: new Map([["src/a.ts", [{ name: "Foo", qualified: "Foo", kind: "class" }]]]),
    imports: new Map([["src/a.ts", ["src/b.ts"]]]),
  })
  expect(graph.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
    ["page:guide.md", "source:src/a.ts", "references-source"],
    ["page:guide.md", "source:src/b.ts", "references-source"],
    ["page:other.md", "source:src/a.ts", "references-source"],
    ["source:src/a.ts", "source:src/b.ts", "uses"],
    ["source:src/a.ts", "symbol:src/a.ts#Foo", "contains"],
  ])
})

test("validates uses endpoints strictly", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: { "guide.md": { title: "Guide", sources: ["src/a.ts", "src/b.ts"], sourceHashes: {} } },
    },
    { snapshot: "fixture" },
  )
  const ok = {
    ...graph,
    edges: [...graph.edges, { from: "source:src/a.ts", to: "source:src/b.ts", kind: "uses", freshness: "unknown" }],
  }
  expect(parseWikiGraph(ok).edges).toHaveLength(3)
  const bad = (edge: unknown) => ({ ...ok, edges: [...graph.edges, edge] })
  expect(() =>
    parseWikiGraph(bad({ from: "page:guide.md", to: "source:src/b.ts", kind: "uses", freshness: "unknown" })),
  ).toThrow(/relationship/)
  expect(() =>
    parseWikiGraph(bad({ from: "source:src/a.ts", to: "source:src/a.ts", kind: "uses", freshness: "unknown" })),
  ).toThrow(/relationship/)
  expect(() =>
    parseWikiGraph(bad({ from: "source:src/a.ts", to: "source:src/b.ts", kind: "depends-on", freshness: "unknown" })),
  ).toThrow(/relationship/)
  expect(() =>
    projectWikiManifest(manifest(), { snapshot: "bad", imports: new Map([["src/a.ts", ["../escape.ts"]]]) }),
  ).toThrow()
})

test("projects recorded symbol glosses onto symbol nodes", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "guide.md": {
          title: "Guide",
          sources: ["src/a.ts"],
          sourceHashes: {},
          symbolSummaries: [
            { name: "Foo", summary: "Holds the balance." },
            { name: "Ghost", summary: "Not in this source." },
          ],
        },
      },
    },
    {
      snapshot: "gloss",
      inventory: new Map([
        [
          "src/a.ts",
          [
            { name: "Foo", qualified: "Foo", kind: "class" },
            { name: "bar", qualified: "Foo.bar", kind: "method" },
          ],
        ],
      ]),
    },
  )
  expect(graph.nodes.find((n) => n.id === "symbol:src/a.ts#Foo")!.summary).toBe("Holds the balance.")
  expect(graph.nodes.find((n) => n.id === "symbol:src/a.ts#Foo.bar")!.summary).toBe("")
  expect(graph.nodes.find((n) => n.id === "source:src/a.ts")!.summary).toBe("")
})

test("first citing page wins when several pages gloss one symbol", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "b-guide.md": {
          title: "B",
          sources: ["src/a.ts"],
          sourceHashes: {},
          symbolSummaries: [{ name: "Foo", summary: "Second gloss." }],
        },
        "a-guide.md": {
          title: "A",
          sources: ["src/a.ts"],
          sourceHashes: {},
          symbolSummaries: [{ name: "Foo", summary: "First gloss." }],
        },
      },
    },
    {
      snapshot: "gloss-order",
      inventory: new Map([["src/a.ts", [{ name: "Foo", qualified: "Foo", kind: "class" }]]]),
    },
  )
  expect(graph.nodes.find((n) => n.id === "symbol:src/a.ts#Foo")!.summary).toBe("First gloss.")
})

test("rejects malformed and over-limit gloss lists", () => {
  const bare = () => ({
    schemaVersion: 1,
    generator: "ax-wiki",
    pages: {
      "guide.md": { title: "Guide", sources: ["src/a.ts"], sourceHashes: {} },
    },
  })
  const bad = (symbolSummaries: unknown) => {
    const input = bare()
    ;(input.pages["guide.md"] as Record<string, unknown>).symbolSummaries = symbolSummaries
    return input
  }
  expect(() => projectWikiManifest(bad("nope"), { snapshot: "bad" })).toThrow(/gloss/)
  expect(() => projectWikiManifest(bad([{ name: "", summary: "x" }]), { snapshot: "bad" })).toThrow()
  expect(() =>
    projectWikiManifest(
      bad(Array.from({ length: 65 }, (_, i) => ({ name: `s${i}`, summary: "Long enough gloss text." }))),
      { snapshot: "bad" },
    ),
  ).toThrow(/gloss/)
  expect(projectWikiManifest(bare(), { snapshot: "ok" }).nodes.every((n) => n.summary === "")).toBe(true)
})

test("admits every page before sources and sources round-robin before any symbol", () => {
  const inventory = new Map<string, Array<{ name: string; qualified: string; kind: string }>>()
  const pages: Record<string, unknown> = {}
  for (let p = 0; p < 4; p++) {
    const sources = Array.from({ length: 60 }, (_, i) => `src/p${p}/f${String(i).padStart(2, "0")}.ts`)
    for (const source of sources)
      inventory.set(
        source,
        Array.from({ length: 5 }, (_, s) => ({ name: `s${s}`, qualified: `s${s}`, kind: "function" })),
      )
    pages[`p${p}.md`] = { title: `Page ${p}`, sources, sourceHashes: {} }
  }
  const graph = projectWikiManifest({ schemaVersion: 1, generator: "ax-wiki", pages }, { snapshot: "fair", inventory })
  expect(graph.nodes).toHaveLength(GRAPH_LIMITS.nodes)
  expect(graph.nodes.slice(0, 4).map((node) => node.id)).toEqual([
    "page:p0.md",
    "page:p1.md",
    "page:p2.md",
    "page:p3.md",
  ])
  expect(graph.nodes.some((node) => node.kind === "symbol")).toBe(false)
  const perPage = [0, 1, 2, 3].map((p) => graph.nodes.filter((node) => node.path.startsWith(`src/p${p}/`)).length)
  expect(perPage).toEqual([49, 49, 49, 49])
  expect(graph.edges.every((edge) => edge.kind === "references-source")).toBe(true)
})

test("projects readable pages with related pages, freshness counts and bounded markdown", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "a.md": {
          title: "A",
          purpose: "Explain A",
          generatedAt: "2026-10-14T00:00:00.000Z",
          sources: ["src/x.ts", "src/y.ts"],
          sourceHashes: { "src/x.ts": hash, "src/y.ts": hash },
        },
        "b.md": { title: "B", sources: ["src/x.ts", "src/y.ts"], sourceHashes: {} },
        "c.md": { title: "C", sources: ["src/y.ts"], sourceHashes: {} },
        "d.md": { title: "D", sources: ["src/z.ts"], sourceHashes: {} },
      },
    },
    {
      snapshot: "pages",
      observed: new Map([
        ["src/x.ts", hash],
        ["src/y.ts", "f".repeat(64)],
      ]),
      documents: new Map([
        ["a.md", "# A\r\nBody\u0007 text\u202e"],
        ["b.md", "x".repeat(GRAPH_LIMITS.markdown + 10)],
      ]),
    },
  )
  const [a, b, c, d] = graph.pages!
  expect(a).toMatchObject({
    purpose: "Explain A",
    generatedAt: "2026-10-14T00:00:00.000Z",
    stale: 1,
    unknown: 0,
    changed: ["src/y.ts"],
  })
  expect(a.markdown).toBe("# A\nBody text")
  expect(a.related).toEqual([
    { id: "page:b.md", shared: 2 },
    { id: "page:c.md", shared: 1 },
  ])
  expect(b.truncated).toBe(true)
  expect(b.markdown.length).toBe(GRAPH_LIMITS.markdown)
  expect(c).toMatchObject({
    markdown: "",
    truncated: false,
    unknown: 1,
    related: [
      { id: "page:a.md", shared: 1 },
      { id: "page:b.md", shared: 1 },
    ],
  })
  expect(d.related).toEqual([])
  expect(parseWikiGraph(graph)).toEqual(graph)
})

test("projects coverage areas from the indexed inventory and never reports cited above indexed", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      generatedAt: "2026-10-14T00:00:00.000Z",
      repositoryHead: "abc123",
      model: "provider/model",
      sources: { "src/a.ts": hash, "src/b.ts": hash, "docs/x.md": hash, "README.md": hash },
      pages: { "a.md": { title: "A", sources: ["src/a.ts", "lib/extra.ts"], sourceHashes: {} } },
    },
    { snapshot: "coverage" },
  )
  expect(graph.overview).toMatchObject({
    generatedAt: "2026-10-14T00:00:00.000Z",
    repositoryHead: "abc123",
    model: "provider/model",
    indexedSources: 5,
    citedSources: 2,
  })
  const areas = Object.fromEntries(graph.overview!.areas.map((area) => [area.path, [area.indexed, area.cited]]))
  expect(areas).toEqual({ "": [5, 2], src: [2, 1], docs: [1, 0], lib: [1, 1] })
})

test("groups cited files into sizeable directory modules and sums recorded imports between groups", () => {
  const sources = [
    "pkg/a/1.ts",
    "pkg/a/2.ts",
    "pkg/a/3.ts",
    "pkg/b/1.ts",
    "pkg/b/2.ts",
    "pkg/b/3.ts",
    "pkg/b/deep/x.ts",
    "root.ts",
  ]
  const graph = projectWikiManifest(
    { schemaVersion: 1, generator: "ax-wiki", pages: { "a.md": { title: "A", sources, sourceHashes: {} } } },
    {
      snapshot: "modules",
      imports: new Map([
        ["pkg/a/1.ts", ["pkg/b/1.ts", "pkg/a/2.ts"]],
        ["pkg/a/2.ts", ["pkg/b/deep/x.ts"]],
        ["pkg/b/1.ts", ["root.ts"]],
      ]),
    },
  )
  // pkg/b/deep has one cited file, below the three-file minimum, so it stays inside pkg/b.
  expect(graph.modules!.groups).toEqual([
    { path: "", files: 1 },
    { path: "pkg/a", files: 3 },
    { path: "pkg/b", files: 4 },
  ])
  expect(graph.modules!.dependencies).toEqual([
    { from: "pkg/a", to: "pkg/b", imports: 2 },
    { from: "pkg/b", to: "", imports: 1 },
  ])
  expect(graph.modules!.rule).toContain("at least 3 cited files")
})

test("rejects malformed reading, coverage and module projections", () => {
  const base = projectWikiManifest(manifest(), { snapshot: "fixture", documents: new Map([["guide.md", "Hi"]]) })
  const page = base.pages![0]
  for (const bad of [
    { ...base, pages: [{ ...page, id: "page:other.md" }] },
    { ...base, pages: [{ ...page, markdown: "a\u0000b" }] },
    { ...base, pages: [{ ...page, related: [{ id: "page:missing.md", shared: 1 }] }] },
    { ...base, pages: [{ ...page, sources: ["../escape"] }] },
    { ...base, overview: { ...base.overview!, areas: [{ path: "src", indexed: 1, cited: 2 }] } },
    { ...base, modules: { ...base.modules!, dependencies: [{ from: "nope", to: "src", imports: 1 }] } },
  ])
    expect(() => parseWikiGraph(bad)).toThrow()
  // Older producers omit the optional projections entirely.
  const { pages: _p, overview: _o, modules: _m, ...legacy } = base
  expect(parseWikiGraph(legacy).pages).toBeUndefined()
})

test("page freshness counts stay within the bounded source list", () => {
  const sources = Array.from({ length: GRAPH_LIMITS.sourcesPerPage + 2 }, (_, i) => `src/${i}.ts`)
  const graph = projectWikiManifest(
    { schemaVersion: 1, generator: "ax-wiki", pages: { "a.md": { title: "A", sources, sourceHashes: {} } } },
    { snapshot: "fixture", observed: new Map(sources.map((source) => [source, null])) },
  )
  const page = graph.pages![0]!
  expect(page.sources).toHaveLength(GRAPH_LIMITS.sourcesPerPage)
  // Every recorded citation is stale, so the count must cover the listed sources
  // rather than the citations the cap removed from the list.
  expect(page.stale).toBe(GRAPH_LIMITS.sourcesPerPage)
  expect(page.unknown).toBe(0)
  expect(page.changed).toHaveLength(GRAPH_LIMITS.sourcesPerPage)
  expect(page.changed.every((source) => page.sources.includes(source))).toBe(true)
  // The two citations the cap hides are accounted for beside the list, so the
  // page's own state still agrees with its node, which aggregates every citation.
  expect(page.omitted).toEqual({ sources: 2, stale: 2, unknown: 0 })
  expect(graph.nodes.find((node) => node.id === page.id)?.freshness).toBe("stale")
})

test("reports citations past the cap so a page state matches its node", () => {
  const sources = Array.from({ length: GRAPH_LIMITS.sourcesPerPage + 1 }, (_, i) => `src/${i}.ts`)
  // The projection deduplicates and sorts citations before the cap, so the one it
  // drops is the lexicographically last.
  const sorted = [...sources].sort()
  const listed = sorted.slice(0, GRAPH_LIMITS.sourcesPerPage)
  const digest = "a".repeat(64)
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: { "a.md": { title: "A", sources, sourceHashes: Object.fromEntries(listed.map((s) => [s, digest])) } },
    },
    {
      snapshot: "fixture",
      // Everything the list can name is fresh; only the citation past the cap is gone.
      observed: new Map<string, string | null>([
        ...listed.map((source): [string, string] => [source, digest]),
        [sorted.at(-1)!, null],
      ]),
    },
  )
  const page = graph.pages![0]!
  expect(page.stale).toBe(0)
  expect(page.changed).toEqual([])
  expect(page.omitted).toEqual({ sources: 1, stale: 1, unknown: 0 })
  expect(graph.nodes.find((node) => node.id === page.id)?.freshness).toBe("stale")
})

test("parses a page projected before the omitted counts existed as zeros", () => {
  const graph = parseWikiGraph({
    schemaVersion: 1,
    snapshot: "fixture",
    scope: "wiki-manifest",
    codeRelationships: "unavailable",
    nodes: [
      {
        id: "page:a.md",
        kind: "page",
        label: "A",
        path: "a.md",
        freshness: "fresh",
        recordedReferences: 1,
        summary: "",
        symbols: [],
        detail: "",
        qualified: "",
      },
    ],
    edges: [],
    omitted: { nodes: 0, edges: 0 },
    pages: [
      {
        id: "page:a.md",
        path: "a.md",
        title: "A",
        purpose: "",
        summary: "",
        generatedAt: "",
        sources: ["src/a.ts"],
        stale: 0,
        unknown: 0,
        changed: [],
        related: [],
        markdown: "",
        truncated: false,
      },
    ],
  })
  expect(graph.pages![0]!.omitted).toEqual({ sources: 0, stale: 0, unknown: 0 })
})

test("cuts a composed symbol detail to its own budget instead of failing the projection", () => {
  // `qualified` has its own, larger limit, so `<kind> <qualified>` cannot fit.
  const qualified = "Q".repeat(600)
  expect(GRAPH_LIMITS.qualified).toBeGreaterThan(GRAPH_LIMITS.detail)
  const graph = projectWikiManifest(manifest(), {
    snapshot: "fixture",
    inventory: new Map([["src/a.ts", [{ name: "Foo", qualified, kind: "class" }]]]),
  })
  const symbol = graph.nodes.find((node) => node.kind === "symbol")
  expect(symbol?.qualified).toBe(qualified)
  expect(symbol?.detail.length).toBe(GRAPH_LIMITS.detail)
  expect(symbol?.detail.startsWith("class Q")).toBe(true)
})

test("cuts graph text on a code-point boundary", () => {
  const value = `a${"\u{1D11E}".repeat(4)}𝄞`
  expect(cutGraphText("abcdef", 3)).toBe("abc")
  expect(cutGraphText("ab𝄞", 3)).toBe("ab")
  expect(cutGraphText(value, 4)).toBe("a𝄞")
  for (let max = 0; max <= value.length; max++) expect(() => encodeURIComponent(cutGraphText(value, max))).not.toThrow()
})

test("projects page-specific unverified source identities before applying the node cap", () => {
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "a.md": { title: "Known", sources: ["src/a.ts", "src/b.ts"], sourceHashes: { "src/a.ts": hash } },
        "b.md": { title: "Unknown", sources: ["src/a.ts"], sourceHashes: {} },
      },
    },
    {
      snapshot: "fixture",
      observed: new Map([
        ["src/a.ts", hash],
        ["src/b.ts", hash],
      ]),
    },
  )
  expect(graph.pages!.map((page) => [page.path, page.unverified, page.unknown])).toEqual([
    ["a.md", ["src/b.ts"], 1],
    ["b.md", ["src/a.ts"], 1],
  ])
  expect(parseWikiGraph(graph)).toEqual(graph)
  const legacy = { ...graph, pages: graph.pages!.map(({ unverified, ...page }) => page) }
  expect(parseWikiGraph(legacy).pages!.every((page) => page.unverified === undefined)).toBe(true)
  expect(() => parseWikiGraph({ ...graph, pages: [{ ...graph.pages![0], unverified: ["../escape"] }] })).toThrow()
})

test.each([[], ["src/other.ts"], ["src/a.ts", "src/a.ts"]].map((unverified) => ({ unverified })))(
  "rejects inconsistent unverified source identities %j",
  ({ unverified }) => {
    const graph = projectWikiManifest(manifest(), { snapshot: "fixture" })
    graph.pages![0].unverified = unverified
    expect(() => parseWikiGraph(graph)).toThrow("Invalid unverified sources")
  },
)

test("records module omissions before graph drawing caps and parses optional scope safely", () => {
  const sources = Array.from({ length: 40 }, (_, i) =>
    Array.from({ length: 3 }, (_, j) => `g${String(i).padStart(2, "0")}/${j}.ts`),
  ).flat()
  const imports = new Map(
    sources
      .filter((file) => file.endsWith("/0.ts"))
      .map((from) => [from, sources.filter((file) => file.endsWith("/0.ts") && file !== from)]),
  )
  imports.get("g00/0.ts")!.push("g00/1.ts")
  const graph = projectWikiManifest(
    { schemaVersion: 1, generator: "ax-wiki", pages: { "all.md": { title: "All", sources, sourceHashes: {} } } },
    {
      snapshot: "scope",
      imports,
      importScan: { status: "partial", analyzedFiles: 120, unresolvedImports: 2 },
    },
  )
  expect(graph.modules!.groups).toHaveLength(40)
  expect(graph.modules!.dependencies).toHaveLength(800)
  expect(graph.modules!.evidence).toEqual({
    scan: { status: "partial", analyzedFiles: 120, unresolvedImports: 2 },
    internalImports: 1,
    omittedDependencies: 760,
    omittedDependencyImports: 760,
  })
  expect(parseWikiGraph(graph).modules).toEqual(graph.modules)
  const legacy = { ...graph, modules: { ...graph.modules!, evidence: undefined } }
  expect(parseWikiGraph(legacy).modules!.evidence).toBeUndefined()
  for (const change of [
    { internalImports: -1 },
    { omittedDependencies: 0.5 },
    { scan: { status: "complete" } },
    { scan: { status: "partial", analyzedFiles: -1 } },
  ]) {
    expect(() =>
      parseWikiGraph({ ...graph, modules: { ...graph.modules!, evidence: { ...graph.modules!.evidence, ...change } } }),
    ).toThrow()
  }
  const parsed = parseWikiGraph({
    ...graph,
    modules: {
      ...graph.modules!,
      evidence: { ...graph.modules!.evidence, secret: "discard", scan: { status: "unknown", secret: "discard" } },
    },
  })
  expect(JSON.stringify(parsed.modules)).not.toContain("discard")
})

test("rejects aggregate module count overflow before a viewer consumes it", () => {
  const graph = projectWikiManifest(manifest(), { snapshot: "overflow" })
  const modules = {
    rule: "Fixture",
    groups: [
      { path: "a", files: 1 },
      { path: "b", files: 1 },
    ],
    dependencies: [
      { from: "a", to: "b", imports: Number.MAX_SAFE_INTEGER },
      { from: "b", to: "a", imports: 1 },
    ],
  }
  expect(() => parseWikiGraph({ ...graph, modules })).toThrow("Invalid count")
  expect(() =>
    parseWikiGraph({
      ...graph,
      modules: {
        ...modules,
        dependencies: [],
        groups: [
          { path: "a", files: Number.MAX_SAFE_INTEGER },
          { path: "b", files: 1 },
        ],
      },
    }),
  ).toThrow("Invalid count")
})
