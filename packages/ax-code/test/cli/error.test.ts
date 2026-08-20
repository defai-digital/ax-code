import { describe, expect, test } from "vitest"
import z from "zod"
import { FormatError, FormatUnknownError } from "../../src/cli/error"

describe("cli error formatting", () => {
  test("formats zod validation failures as human-readable text, not raw JSON", () => {
    const schema = z.string().startsWith("ses")
    const result = schema.safeParse("nonexistent")
    expect(result.success).toBe(false)
    if (result.success) return

    const formatted = FormatError(result.error)

    expect(formatted).toBeDefined()
    expect(formatted).toContain('must start with "ses"')
    expect(formatted).not.toContain('"code"')
    expect(formatted).not.toContain("invalid_format")
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

    expect(FormatUnknownError(broken)).toBe("Unexpected error")
  })
})
