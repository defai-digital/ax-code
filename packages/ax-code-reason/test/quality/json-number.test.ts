import { describe, expect, test } from "vitest"
import z from "zod"
import { JsonNumber } from "../../src/quality/json-number"

// JsonNumber normalizes numeric strings parsed from JSON artifacts while
// leaving non-numeric (and unsafe-integer) values untouched for the wrapped
// schema to reject.

describe("JsonNumber", () => {
  const schema = JsonNumber(z.number())

  test("passes real numbers through", () => {
    expect(schema.parse(7)).toBe(7)
    expect(schema.parse(3.5)).toBe(3.5)
    expect(schema.parse(-2)).toBe(-2)
  })

  test("coerces numeric strings, including whitespace-padded and signed forms", () => {
    expect(schema.parse("7")).toBe(7)
    expect(schema.parse(" 42 ")).toBe(42)
    expect(schema.parse("-3")).toBe(-3)
    expect(schema.parse("+2")).toBe(2)
    expect(schema.parse("3.5")).toBe(3.5)
    expect(schema.parse(".5")).toBe(0.5)
    expect(schema.parse("1.")).toBe(1)
  })

  test("leaves non-numeric strings untouched so the number schema rejects them", () => {
    expect(schema.safeParse("abc").success).toBe(false)
    expect(schema.safeParse("").success).toBe(false)
    expect(schema.safeParse("7a").success).toBe(false)
    expect(schema.safeParse("0x10").success).toBe(false)
    expect(schema.safeParse("1e3").success).toBe(false)
    expect(schema.safeParse(true).success).toBe(false)
  })

  test("rejects unsafe integers instead of silently losing precision", () => {
    // A numeric string beyond the safe-integer range is left as a string...
    expect(schema.safeParse("9007199254740993").success).toBe(false)
    // ...and an unsafe integer number is normalized to NaN, which the
    // number schema rejects.
    expect(schema.safeParse(Number.MAX_SAFE_INTEGER + 2).success).toBe(false)
    // The boundary itself is still accepted.
    expect(schema.parse(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("rejects non-finite numbers", () => {
    expect(schema.safeParse(Number.NaN).success).toBe(false)
    expect(schema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false)
    expect(schema.safeParse("Infinity").success).toBe(false)
  })

  test("respects the wrapped schema's constraints", () => {
    const intSchema = JsonNumber(z.number().int())
    expect(intSchema.parse("7")).toBe(7)
    expect(intSchema.safeParse("3.5").success).toBe(false)
    const ranged = JsonNumber(z.number().min(0).max(1))
    expect(ranged.parse("0.5")).toBe(0.5)
    expect(ranged.safeParse("1.5").success).toBe(false)
  })
})
