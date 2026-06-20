import { describe, expect, test } from "vitest"
import { decodeToolParamsValue, parseToolParams } from "../../src/cli/cmd/debug/agent"

describe("debug agent", () => {
  test("decodeToolParamsValue decodes already-parsed params", () => {
    expect(decodeToolParamsValue({ path: "src/index.ts", limit: 2 })).toEqual({
      path: "src/index.ts",
      limit: 2,
    })
    expect(() => decodeToolParamsValue(["not", "object"])).toThrow("Tool params must be a JSON object")
    expect(() => decodeToolParamsValue(null)).toThrow("Tool params must be a JSON object")
  })

  test("parseToolParams decodes JSON object params", () => {
    expect(parseToolParams()).toEqual({})
    expect(parseToolParams("  ")).toEqual({})
    expect(parseToolParams(JSON.stringify({ path: "src/index.ts", limit: 2 }))).toEqual({
      path: "src/index.ts",
      limit: 2,
    })
  })

  test("parseToolParams rejects invalid JSON and non-object JSON", () => {
    expect(() => parseToolParams("{not json")).toThrow("Failed to parse --params as JSON")
    expect(() => parseToolParams(JSON.stringify(["not", "object"]))).toThrow("Tool params must be a JSON object")
    expect(() => parseToolParams("null")).toThrow("Tool params must be a JSON object")
  })
})
