import { describe, expect, test } from "bun:test"
import { toErrorMessage } from "@/util/error-message"

describe("toErrorMessage", () => {
  test("uses Error.message", () => {
    expect(toErrorMessage(new TypeError("invalid value"))).toBe("invalid value")
  })

  test("stringifies non-Error values", () => {
    expect(toErrorMessage("plain failure")).toBe("plain failure")
    expect(toErrorMessage(42)).toBe("42")
    expect(toErrorMessage(null)).toBe("null")
  })
})
