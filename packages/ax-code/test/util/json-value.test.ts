import { describe, expect, test } from "vitest"
import { parseJsonPayload, parseJsonResult, parseJsonStrict } from "../../src/util/json-value"

describe("util.json-value", () => {
  test("parseJsonPayload parses valid JSON values", () => {
    expect(parseJsonPayload(JSON.stringify({ type: "event" }))).toEqual({ type: "event" })
    expect(parseJsonPayload("  null\n")).toBeNull()
    expect(parseJsonPayload("0")).toBe(0)
  })

  test("parseJsonPayload returns undefined for absent, empty, or malformed payloads", () => {
    expect(parseJsonPayload(undefined)).toBeUndefined()
    expect(parseJsonPayload("")).toBeUndefined()
    expect(parseJsonPayload("   \n")).toBeUndefined()
    expect(parseJsonPayload("{not json")).toBeUndefined()
  })

  test("parseJsonResult preserves parse errors for callers that report failures", () => {
    expect(parseJsonResult(JSON.stringify({ type: "event" }))).toEqual({
      ok: true,
      value: { type: "event" },
    })

    const parsed = parseJsonResult("{not json")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toBeInstanceOf(SyntaxError)
  })

  test("parseJsonStrict returns parsed values or rethrows parse errors", () => {
    expect(parseJsonStrict(JSON.stringify({ type: "event" }))).toEqual({ type: "event" })
    expect(() => parseJsonStrict("{not json")).toThrow(SyntaxError)
  })

  test("parseJsonStrict wraps unprintable parse failures as SyntaxError", () => {
    const originalParse = JSON.parse
    const failure = {
      toString() {
        throw new Error("cannot print")
      },
    }
    JSON.parse = (() => {
      throw failure
    }) as typeof JSON.parse
    try {
      expect(() => parseJsonStrict("{}")).toThrow(SyntaxError)
      expect(() => parseJsonStrict("{}")).toThrow("Unknown error")
    } finally {
      JSON.parse = originalParse
    }
  })
})
