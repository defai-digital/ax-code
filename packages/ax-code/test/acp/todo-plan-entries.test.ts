import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"

describe("ACP todo plan entry decoding", () => {
  test("decodes parsed todo values into ACP plan entries", () => {
    const entries = ACP.decodeTodoPlanEntries([
      { content: "Wire command", status: "pending", priority: "high" },
      { content: "Run validation", status: "in_progress", priority: "medium" },
      { content: "Document result", status: "completed", priority: "low" },
      { content: "Drop obsolete path", status: "cancelled", priority: "low" },
    ])

    expect(entries).toEqual([
      { priority: "medium", status: "pending", content: "Wire command" },
      { priority: "medium", status: "in_progress", content: "Run validation" },
      { priority: "medium", status: "completed", content: "Document result" },
      { priority: "medium", status: "completed", content: "Drop obsolete path" },
    ])
  })

  test("parses serialized todo output", () => {
    const entries = ACP.parseTodoPlanEntries(
      `  ${JSON.stringify([{ content: "Review", status: "pending", priority: "medium" }])}\n`,
    )

    expect(entries).toEqual([{ priority: "medium", status: "pending", content: "Review" }])
  })

  test("returns null for invalid JSON", () => {
    expect(ACP.parseTodoPlanEntries("not-json")).toBeNull()
    expect(ACP.parseTodoPlanEntries("")).toBeNull()
  })

  test("returns null for malformed todo values", () => {
    expect(ACP.decodeTodoPlanEntries([{ content: "Review", status: "blocked", priority: "medium" }])).toBeNull()
  })
})
