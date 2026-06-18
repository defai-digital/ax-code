import { describe, expect, test } from "bun:test"
import { mcpSchemaByteLength } from "../../src/mcp/tool-conversion"

describe("mcp tool conversion", () => {
  test("measures JSON schema byte length", () => {
    expect(mcpSchemaByteLength({ type: "object", properties: { q: { type: "string" } } })).toBeGreaterThan(0)
  })

  test("reports circular schemas as non-serializable", () => {
    const schema: Record<string, unknown> = { type: "object" }
    schema.self = schema

    expect(() => mcpSchemaByteLength(schema as any)).toThrow("MCP tool schema is not JSON-serializable")
  })

  test("reports bigint schemas as non-serializable", () => {
    expect(() => mcpSchemaByteLength({ type: "object", x: 1n } as any)).toThrow(
      "MCP tool schema is not JSON-serializable",
    )
  })
})
