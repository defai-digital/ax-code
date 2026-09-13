import { describe, expect, test } from "vitest"
import { stringList, uniqueItems, uniqueStrings, uniqueSortedStrings } from "../src/string-list"

describe("stringList", () => {
  test("returns only string members of an array", () => {
    expect(stringList([1, "a", null, "b", {}, "c"])).toEqual(["a", "b", "c"])
  })

  test("returns an empty array for non-array input", () => {
    expect(stringList("a")).toEqual([])
    expect(stringList(undefined)).toEqual([])
    expect(stringList({ 0: "a" })).toEqual([])
  })
})

describe("uniqueItems", () => {
  test("dedupes while preserving first-seen order", () => {
    expect(uniqueItems(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"])
  })

  test("works with iterables", () => {
    expect(uniqueItems(new Set([3, 1, 3, 2]))).toEqual([3, 1, 2])
  })
})

describe("uniqueStrings", () => {
  test("matches uniqueItems for string input", () => {
    expect(uniqueStrings(["x", "x", "y"])).toEqual(["x", "y"])
  })
})

describe("uniqueSortedStrings", () => {
  test("dedupes and sorts", () => {
    expect(uniqueSortedStrings(["b", "a", "b", "c"])).toEqual(["a", "b", "c"])
  })

  test("does not mutate the input array", () => {
    const input = ["b", "a", "b"]
    uniqueSortedStrings(input)
    expect(input).toEqual(["b", "a", "b"])
  })
})
