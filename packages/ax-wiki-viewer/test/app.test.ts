import { expect, test } from "vitest"
import type { WikiGraphNode, WikiGraphPage } from "@ax-code/ax-wiki/graph"
import { searchPage, sourceUnverified } from "../src/app.js"

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
