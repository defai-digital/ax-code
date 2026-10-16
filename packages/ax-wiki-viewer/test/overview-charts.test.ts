import { expect, test } from "vitest"
import type { WikiGraphPage } from "@ax-code/ax-wiki/graph"
import { blindSpots, pageOverlap, sharedFiles } from "../src/overview-charts.js"

const area = (path: string, indexed: number, cited: number) => ({ path, indexed, cited })

test("blind spots name the most specific directory holding the uncited files", () => {
  const spots = blindSpots([
    area("", 200, 30),
    area("packages", 180, 20),
    // One child holds most of packages' uncited files, so it replaces the parent.
    area("packages/server", 150, 0),
    area("packages/core", 30, 20),
    area("docs", 20, 10),
    area("docs/guides", 8, 4),
    area("docs/api", 8, 4),
    area("full", 5, 5),
  ])
  // Ties sort by path; docs/api and docs/guides sit inside docs, so they are not listed again.
  expect(spots.map((spot) => spot.path)).toEqual(["packages/server", "docs", "packages/core"])
  expect(spots[0]).toEqual({ path: "packages/server", indexed: 150, cited: 0, uncited: 150 })
  expect(spots.some((spot) => spot.path === "" || spot.path === "full")).toBe(false)
  expect(blindSpots([area("", 3, 3)])).toEqual([])
  expect(blindSpots([area("", 10, 0), area("a", 5, 0), area("b", 5, 0)], 1)).toHaveLength(1)
})

const page = (id: string, sources: string[]): WikiGraphPage => ({
  id: `page:${id}`,
  path: id,
  title: id.toUpperCase(),
  purpose: "",
  summary: "",
  generatedAt: "",
  sources,
  stale: 0,
  unknown: 0,
  changed: [],
  related: [],
  markdown: "",
  truncated: false,
  omitted: { sources: 0, stale: 0, unknown: 0 },
})

test("page overlap counts shared cited files symmetrically with own counts on the diagonal", () => {
  const pages = [page("a", ["x", "y", "z"]), page("b", ["y", "z", "w"]), page("c", ["q"])]
  const overlap = pageOverlap(pages)
  expect(overlap.shared).toEqual([
    [3, 2, 0],
    [2, 3, 0],
    [0, 0, 1],
  ])
  expect(overlap.max).toBe(2)
  expect(overlap.pages.map((entry) => entry.files)).toEqual([3, 3, 1])
  expect(sharedFiles(pages[0], pages[1])).toEqual(["y", "z"])
  expect(pageOverlap(pages, 2).shared).toEqual([
    [3, 2],
    [2, 3],
  ])
})
