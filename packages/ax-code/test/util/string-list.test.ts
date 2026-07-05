import { describe, expect, test } from "vitest"
import { stringList, uniqueItems, uniqueSortedStrings, uniqueStrings } from "../../src/util/string-list"

describe("util.string-list", () => {
  test("filters unknown values to strings", () => {
    expect(stringList(["a", 1, "b", null, ""])).toEqual(["a", "b", ""])
    expect(stringList("not-array")).toEqual([])
  })

  test("deduplicates generic items while preserving first occurrence order", () => {
    const first = { id: "first" }
    const second = { id: "second" }

    expect(uniqueItems([first, second, first])).toEqual([first, second])
  })

  test("deduplicates and sorts strings", () => {
    expect(uniqueStrings(["b", "a", "b"])).toEqual(["b", "a"])
    expect(uniqueSortedStrings(["b", "a", "b"])).toEqual(["a", "b"])
  })
})
