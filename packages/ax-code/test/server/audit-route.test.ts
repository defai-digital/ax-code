import { describe, expect, test } from "bun:test"
import { parseAuditJsonLine } from "../../src/server/routes/audit"

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
})
