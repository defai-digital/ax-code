import { describe, expect, test } from "bun:test"
import { nextInList } from "./preferences"

describe("layout preference helpers", () => {
  test("cycles forward through a list", () => {
    expect(nextInList(["a", "b", "c"], "a", 1)).toBe("b")
    expect(nextInList(["a", "b", "c"], "c", 1)).toBe("a")
  })

  test("cycles backward through a list", () => {
    expect(nextInList(["a", "b", "c"], "a", -1)).toBe("c")
    expect(nextInList(["a", "b", "c"], "b", -1)).toBe("a")
  })

  test("falls back to the first item when the current value is missing", () => {
    expect(nextInList(["a", "b", "c"], "x", 1)).toBe("a")
    expect(nextInList(["a", "b", "c"], undefined, 1)).toBe("a")
  })

  test("returns nothing for an empty list", () => {
    expect(nextInList([], "a", 1)).toBeUndefined()
  })
})
