import { describe, expect, test } from "vitest"
import { FormatUnknownError } from "../../src/cli/error"

describe("cli error formatting", () => {
  test("falls back when non-Error string conversion throws", () => {
    const broken = function brokenThrowable() {
      return undefined
    }
    Object.defineProperty(broken, Symbol.toPrimitive, {
      value() {
        throw new Error("cannot stringify")
      },
    })

    expect(FormatUnknownError(broken)).toBe("Unexpected error")
  })
})
