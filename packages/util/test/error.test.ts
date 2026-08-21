import { describe, expect, test } from "vitest"
import z from "zod"
import { NamedError } from "../src/error"

const TestError = NamedError.create(
  "TestError",
  z.object({
    message: z.string(),
    code: z.number().optional(),
  }),
)

const BareError = NamedError.create("BareError", z.object({ code: z.number() }))

describe("NamedError.create", () => {
  test("exposes name, data, and schema round-trip", () => {
    const error = new TestError({ message: "boom", code: 7 })
    expect(error.name).toBe("TestError")
    expect(error.data).toEqual({ message: "boom", code: 7 })
    expect(TestError.Schema.parse(error.toObject())).toEqual({
      name: "TestError",
      data: { message: "boom", code: 7 },
    })
  })

  test("prefers data.message for the Error message and falls back to the name", () => {
    expect(new TestError({ message: "boom" }).message).toBe("boom")
    expect(new TestError({ message: "" }).message).toBe("TestError")
    expect(new BareError({ code: 1 }).message).toBe("BareError")
  })

  test("propagates ErrorOptions cause", () => {
    const cause = new Error("root")
    expect(new TestError({ message: "boom" }, { cause }).cause).toBe(cause)
  })

  test("ships a built-in Unknown error", () => {
    const error = new NamedError.Unknown({ message: "unexpected" })
    expect(error.name).toBe("UnknownError")
    expect(error.message).toBe("unexpected")
  })
})

describe("NamedError.isInstance", () => {
  test("matches instances by name only", () => {
    const error = new TestError({ message: "boom" })
    expect(TestError.isInstance(error)).toBe(true)
    expect(BareError.isInstance(error)).toBe(false)
    expect(TestError.isInstance(new Error("boom"))).toBe(false)
    expect(TestError.isInstance({ name: "TestError" })).toBe(true)
    expect(TestError.isInstance({ name: "OtherError" })).toBe(false)
  })

  test("returns false instead of throwing for null, undefined, and primitives", () => {
    expect(TestError.isInstance(null)).toBe(false)
    expect(TestError.isInstance(undefined)).toBe(false)
    expect(TestError.isInstance("TestError")).toBe(false)
    expect(TestError.isInstance(42)).toBe(false)
  })
})

describe("NamedError.message", () => {
  test("extracts messages from errors and arbitrary values", () => {
    expect(NamedError.message(new Error("boom"))).toBe("boom")
    expect(NamedError.message("plain")).toBe("plain")
    expect(NamedError.message(42)).toBe("42")
  })
})
