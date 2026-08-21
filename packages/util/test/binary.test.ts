import { describe, expect, test } from "vitest"
import { Binary } from "../src/binary"

type Item = { id: string }

const id = (item: Item) => item.id

describe("Binary.search", () => {
  test("finds existing items", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(items, "b", id)).toEqual({ found: true, index: 1 })
    expect(Binary.search(items, "a", id)).toEqual({ found: true, index: 0 })
    expect(Binary.search(items, "c", id)).toEqual({ found: true, index: 2 })
  })

  test("reports the insertion index when missing", () => {
    const items = [{ id: "a" }, { id: "c" }, { id: "e" }]
    expect(Binary.search(items, "b", id)).toEqual({ found: false, index: 1 })
    expect(Binary.search(items, "z", id)).toEqual({ found: false, index: 3 })
    expect(Binary.search([], "a", id)).toEqual({ found: false, index: 0 })
  })
})

describe("Binary.insert", () => {
  test("keeps the array sorted and mutates it in place", () => {
    const items: Item[] = [{ id: "a" }, { id: "d" }]
    const returned = Binary.insert(items, { id: "b" }, id)
    expect(returned).toBe(items)
    Binary.insert(items, { id: "c" }, id)
    Binary.insert(items, { id: "z" }, id)
    Binary.insert(items, { id: "0" }, id)
    expect(items.map(id)).toEqual(["0", "a", "b", "c", "d", "z"])
  })

  test("allows duplicates", () => {
    const items: Item[] = [{ id: "a" }]
    Binary.insert(items, { id: "a" }, id)
    expect(items).toHaveLength(2)
  })
})
