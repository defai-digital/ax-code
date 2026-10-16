import { expect, test } from "vitest"
import { projectWikiManifest } from "@ax-code/ax-wiki/graph"
import type { WikiGraphNode, WikiGraphPage } from "@ax-code/ax-wiki/graph"
import { pageState, searchPage, sourceUnverified } from "../src/app.js"

const page = (markdown: string): WikiGraphPage => ({
  id: "page:guide.md",
  path: "guide.md",
  title: "Guide",
  purpose: "",
  summary: "",
  generatedAt: "",
  sources: [],
  stale: 0,
  unknown: 0,
  changed: [],
  related: [],
  markdown,
  truncated: false,
  omitted: { sources: 0, stale: 0, unknown: 0 },
})

test("returns a markdown snippet around the match", () => {
  const snippet = searchPage(page(`${"alpha ".repeat(20)}needle one${" omega".repeat(20)}`), "needle")
  expect(snippet).toContain("needle one")
  expect(snippet).toMatch(/^…/)
})

test("keeps the snippet on the match when case folding changes the string length", () => {
  // "İ" lowercases to two code units, shifting every later index in the lowered copy.
  const snippet = searchPage(page(`${"İ".repeat(60)} needle target`), "needle")
  expect(snippet).toContain("needle target")
})

test("matches metadata without a snippet and reports misses", () => {
  expect(searchPage({ ...page(""), title: "Needle Docs" }, "needle")).toBe("")
  expect(searchPage(page("nothing here"), "needle")).toBeUndefined()
  expect(searchPage(page("anything"), "   ")).toBe("")
})

const sourceNode = (path: string, freshness: WikiGraphNode["freshness"]): WikiGraphNode => ({
  id: `source:${path}`,
  kind: "source",
  label: path,
  path,
  freshness,
  recordedReferences: 1,
  summary: "",
  symbols: [],
  detail: "",
  qualified: "",
})

test("reads a cited file's own freshness instead of the page's unverified count", () => {
  // The page cites one unverified file, which must not mark its other files.
  const citing = { ...page(""), sources: ["src/a.ts", "src/b.ts"], unknown: 1 }
  const nodes = [sourceNode("src/a.ts", "fresh"), sourceNode("src/b.ts", "unknown")]
  expect(sourceUnverified("src/a.ts", citing, nodes)).toBe(false)
  expect(sourceUnverified("src/b.ts", citing, nodes)).toBe(true)
})

test("falls back to the page count when the view cap omitted the source node", () => {
  const citing = { ...page(""), sources: ["src/a.ts"], unknown: 1 }
  expect(sourceUnverified("src/a.ts", citing, [])).toBe(true)
  expect(sourceUnverified("src/a.ts", { ...citing, unknown: 0 }, [])).toBe(false)
})

test("counts the citations the page projection could not list", () => {
  // Only the citation past `sourcesPerPage` changed, so the listed counters are
  // empty: the omitted counts have to decide the page's state.
  const citing = { ...page(""), sources: ["src/a.ts"], omitted: { sources: 1, stale: 1, unknown: 0 } }
  expect(pageState(citing)).toBe("stale")
  expect(pageState({ ...citing, omitted: { sources: 1, stale: 0, unknown: 1 } })).toBe("unknown")
  expect(pageState({ ...citing, omitted: { sources: 1, stale: 0, unknown: 0 } })).toBe("fresh")
  // A page with no citations at all is unverified, not current.
  expect(pageState({ ...page(""), omitted: { sources: 0, stale: 0, unknown: 0 } })).toBe("unknown")
})

test.each(["fresh", "stale"] as const)(
  "keeps a page's unverified file separate from another page's %s citation",
  (other) => {
    const current = "a".repeat(64)
    const graph = projectWikiManifest(
      {
        schemaVersion: 1,
        generator: "ax-wiki",
        pages: {
          "known.md": {
            title: "Known",
            sources: ["src/a.ts"],
            sourceHashes: { "src/a.ts": other === "fresh" ? current : "b".repeat(64) },
          },
          "unknown.md": { title: "Unknown", sources: ["src/a.ts"], sourceHashes: {} },
        },
      },
      { snapshot: "fixture", observed: new Map([["src/a.ts", current]]) },
    )
    const known = graph.pages!.find((page) => page.path === "known.md")!
    const unknown = graph.pages!.find((page) => page.path === "unknown.md")!
    expect(sourceUnverified("src/a.ts", known, graph.nodes)).toBe(false)
    expect(sourceUnverified("src/a.ts", unknown, graph.nodes)).toBe(true)
  },
)

test("keeps mixed page sources distinct after the node cap omits all source nodes", () => {
  const current = "a".repeat(64)
  const graph = projectWikiManifest(
    {
      schemaVersion: 1,
      generator: "ax-wiki",
      pages: {
        "a.md": { title: "Mixed", sources: ["src/a.ts", "src/b.ts"], sourceHashes: { "src/a.ts": current } },
        ...Object.fromEntries(
          Array.from({ length: 200 }, (_, index) => [`p${index}.md`, { title: "Page", sources: [], sourceHashes: {} }]),
        ),
      },
    },
    {
      snapshot: "fixture",
      observed: new Map([
        ["src/a.ts", current],
        ["src/b.ts", current],
      ]),
    },
  )
  const mixed = graph.pages!.find((page) => page.path === "a.md")!
  expect(graph.nodes.every((node) => node.kind === "page")).toBe(true)
  expect(sourceUnverified("src/a.ts", mixed, graph.nodes)).toBe(false)
  expect(sourceUnverified("src/b.ts", mixed, graph.nodes)).toBe(true)
})

test("legacy pages with no unknown evidence do not inherit aggregate uncertainty", () => {
  expect(
    sourceUnverified("src/a.ts", { ...page(""), sources: ["src/a.ts"] }, [sourceNode("src/a.ts", "unknown")]),
  ).toBe(false)
  expect(
    sourceUnverified("src/a.ts", { ...page(""), sources: ["src/a.ts"], unknown: 1 }, [sourceNode("src/a.ts", "stale")]),
  ).toBe(true)
})
