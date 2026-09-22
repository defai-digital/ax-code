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
    expect(NamedError.message(null)).toBe("null")
    expect(NamedError.message(undefined)).toBe("undefined")
  })

  test("never renders a non-Error record as [object Object]", () => {
    // Deserialized NamedError body rejected by an HTTP client: data.message wins.
    expect(NamedError.message({ name: "SessionNotFoundError", data: { message: "Session not found: ses_x" } })).toBe(
      "Session not found: ses_x",
    )
    // A record with a plain message field.
    expect(NamedError.message({ message: "plain record" })).toBe("plain record")
    // Only a name is left: use it rather than "[object Object]".
    expect(NamedError.message({ name: "SomeError" })).toBe("SomeError")
    // Empty message fields fall through instead of returning "".
    expect(NamedError.message({ name: "SomeError", message: "", data: { message: "" } })).toBe("SomeError")
    // No message fields at all: bounded JSON serialization.
    expect(NamedError.message({ a: 1 })).toBe('{"a":1}')
    expect(NamedError.message([1, 2])).toBe("[1,2]")
  })

  test("falls back safely for unserializable records", () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(NamedError.message(circular)).toBe("[unserializable error]")

    // Huge records are bounded so a single message line cannot flood output.
    const huge = { blob: "x".repeat(5000) }
    expect(NamedError.message(huge)).toHaveLength(2048)
    expect(NamedError.message(huge).startsWith('{"blob":"xxxx')).toBe(true)
  })
})
