import { describe, expect, test } from "bun:test"
import { toError, toErrorMessage } from "@/util/error-message"

describe("toErrorMessage", () => {
  test("uses Error.message", () => {
    expect(toErrorMessage(new TypeError("invalid value"))).toBe("invalid value")
  })

  test("stringifies non-Error values", () => {
    expect(toErrorMessage("plain failure")).toBe("plain failure")
    expect(toErrorMessage(42)).toBe("42")
    expect(toErrorMessage(null)).toBe("null")
  })

  test("preserves Error values", () => {
    const error = new TypeError("invalid value")
    expect(toError(error)).toBe(error)
  })

  test("wraps non-Error values", () => {
    expect(toError("plain failure")).toMatchObject({ message: "plain failure" })
    expect(toError(null)).toMatchObject({ message: "null" })
  })
})
