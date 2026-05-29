import { describe, expect, test } from "bun:test"
import { collectAuditExportRecords, parseAuditJsonLine } from "../../src/server/routes/audit"

describe("audit route JSONL decoding", () => {
  test("parses valid audit JSON lines", () => {
    expect(parseAuditJsonLine(JSON.stringify({ session_id: "ses_1", event_type: "tool.call" }))).toEqual({
      session_id: "ses_1",
      event_type: "tool.call",
    })
  })

  test("skips corrupt audit JSON lines", () => {
    expect(parseAuditJsonLine("{truncated")).toBeNull()
  })

  test("collects audit export records without materializing past the route limit", async () => {
    const lines = [
      JSON.stringify({ session_id: "ses_1", event_type: "tool.call" }),
      "{truncated",
      JSON.stringify({ session_id: "ses_1", event_type: "tool.result" }),
      JSON.stringify({ session_id: "ses_1", event_type: "agent.route" }),
    ]

    const records = await collectAuditExportRecords(lines, { limit: 2 })

    expect(records).toHaveLength(2)
    expect(records.map((record) => record.event_type)).toEqual(["tool.call", "tool.result"])
  })

  test("filters audit export records before applying the route limit", async () => {
    const lines = [
      JSON.stringify({ session_id: "ses_1", event_type: "tool.call" }),
      JSON.stringify({ session_id: "ses_1", event_type: "tool.result" }),
      JSON.stringify({ session_id: "ses_1", event_type: "tool.result" }),
    ]

    const records = await collectAuditExportRecords(lines, { limit: 2, type: "tool.result" })

    expect(records).toHaveLength(2)
    expect(records.every((record) => record.event_type === "tool.result")).toBe(true)
  })
})
