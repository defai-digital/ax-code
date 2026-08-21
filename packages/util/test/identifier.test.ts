import { describe, expect, test } from "vitest"
import { BASE62_ALPHABET, Identifier } from "../src/identifier"

const TIME_PATTERN = /^[0-9a-f]{14}$/

describe("Identifier", () => {
  test("ascending ids carry the z marker and a fixed shape", () => {
    const id = Identifier.ascending()
    expect(id).toHaveLength(26)
    expect(id[0]).toBe("z")
    expect(id.slice(1, 15)).toMatch(TIME_PATTERN)
    for (const char of id.slice(15)) expect(BASE62_ALPHABET).toContain(char)
  })

  test("descending ids carry the - marker", () => {
    expect(Identifier.descending()[0]).toBe("-")
  })

  test("ascending ids sort by creation order", () => {
    const ids = Array.from({ length: 50 }, () => Identifier.ascending())
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(ids)
  })

  test("descending ids sort in reverse creation order", () => {
    const ids = Array.from({ length: 50 }, () => Identifier.descending())
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort().reverse()).toEqual(ids)
  })

  test("keeps order when the same-millisecond counter wraps", () => {
    const base = Date.now() + 5_000
    const ids = Array.from({ length: 4097 }, () => Identifier.create(false, base))
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(ids)
  })

  test("clamps clock rollback to preserve monotonicity", () => {
    const base = Date.now() + 10_000
    const first = Identifier.create(false, base)
    const second = Identifier.create(false, base - 1_000)
    expect(second > first).toBe(true)
  })

  test("rejects invalid timestamps", () => {
    expect(() => Identifier.create(false, -1)).toThrow(RangeError)
    expect(() => Identifier.create(false, Number.NaN)).toThrow(RangeError)
    expect(() => Identifier.create(false, 2 ** 44)).toThrow(RangeError)
  })
})
