import { expect, test } from "vitest"
import type { WikiGraphPage } from "@ax-code/ax-wiki/graph"
import { searchPage } from "../src/app.js"

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
