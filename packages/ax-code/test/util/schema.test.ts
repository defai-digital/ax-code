import { describe, expect, test } from "vitest"
import z from "zod"
import { JsonNumber } from "../../src/util/schema"

describe("JsonNumber", () => {
  test("accepts decimal number strings", () => {
    const schema = JsonNumber(z.number())

    expect(schema.parse("10")).toBe(10)
    expect(schema.parse("-1.5")).toBe(-1.5)
    expect(schema.parse(".25")).toBe(0.25)
  })

  test("rejects non-decimal number strings", () => {
    const schema = JsonNumber(z.number())

    expect(schema.safeParse("0x10").success).toBe(false)
    expect(schema.safeParse("1e3").success).toBe(false)
  })
})
