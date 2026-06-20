import { describe, expect, test } from "vitest"
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

  test("falls back when non-Error string conversion throws", () => {
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })

    expect(toErrorMessage(broken)).toBe("Unknown error")
    expect(toError(broken)).toMatchObject({ message: "Unknown error" })
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
