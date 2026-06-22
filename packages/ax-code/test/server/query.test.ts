import { describe, expect, test } from "vitest"
import z from "zod"
import { DefaultQueryNumber, OptionalQueryNumber } from "../../src/server/routes/query"

describe("query number helpers", () => {
  test("treat bare query numbers as omitted", () => {
    const optional = OptionalQueryNumber(z.number().int().positive())
    const defaulted = DefaultQueryNumber(z.number().int().positive(), 25)

    expect(optional.isOptional()).toBe(true)
    expect(optional.parse("")).toBeUndefined()
    expect(optional.parse(undefined)).toBeUndefined()
    expect(defaulted.isOptional()).toBe(true)
    expect(defaulted.parse("")).toBe(25)
    expect(defaulted.parse(undefined)).toBe(25)
  })

  test("accept decimal query number strings", () => {
    const optional = OptionalQueryNumber(z.number())

    expect(optional.parse("10")).toBe(10)
    expect(optional.parse("-1.5")).toBe(-1.5)
    expect(optional.parse(".25")).toBe(0.25)
  })

  test("reject non-decimal query number strings", () => {
    const optional = OptionalQueryNumber(z.number())

    expect(optional.safeParse("abc").success).toBe(false)
    expect(optional.safeParse("0x10").success).toBe(false)
    expect(optional.safeParse("1e3").success).toBe(false)
  })

  test("reject unsafe integer strings instead of rounding them", () => {
    const optional = OptionalQueryNumber(z.number())

    expect(optional.safeParse("9007199254740993").success).toBe(false)
    expect(optional.safeParse("-9007199254740993").success).toBe(false)
    expect(optional.safeParse("9007199254740992.5").success).toBe(false)
  })
})
