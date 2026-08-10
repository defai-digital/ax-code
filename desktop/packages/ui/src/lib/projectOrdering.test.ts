import { describe, expect, test } from "vitest"
import { compareProjectsForDisplay, sortProjectsForDisplay } from "./projectOrdering"

describe("sortProjectsForDisplay", () => {
  test("puts pinned projects first and sorts them by lastOpenedAt", () => {
    const projects = [
      { id: "a", path: "/a", lastOpenedAt: 100, orderIndex: 0 },
      { id: "b", path: "/b", pinned: true, lastOpenedAt: 50 },
      { id: "c", path: "/c", pinned: true, lastOpenedAt: 200 },
      { id: "d", path: "/d", lastOpenedAt: 300 },
    ]

    const sorted = sortProjectsForDisplay(projects)
    expect(sorted.map((p) => p.id)).toEqual(["c", "b", "a", "d"])
  })

  test("keeps relative order for unpinned projects when orderIndex is provided", () => {
    const a = { id: "a", path: "/a", lastOpenedAt: 10 }
    const b = { id: "b", path: "/b", lastOpenedAt: 90 }
    const sorted = sortProjectsForDisplay([a, b])
    expect(sorted.map((p) => p.id)).toEqual(["a", "b"])
  })

  test("compareProjectsForDisplay prefers pin over recency", () => {
    const result = compareProjectsForDisplay(
      { path: "/old", pinned: true, lastOpenedAt: 1 },
      { path: "/new", lastOpenedAt: 999 },
    )
    expect(result).toBeLessThan(0)
  })
})
