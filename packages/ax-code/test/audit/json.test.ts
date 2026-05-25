import { describe, expect, test } from "bun:test"
import { auditSessionIDFromRecord, parseAuditJsonLineResult } from "../../src/audit/json"

describe("audit JSONL decoding", () => {
  test("parses valid audit JSON lines", () => {
    expect(parseAuditJsonLineResult(JSON.stringify({ session_id: "ses_1" }))).toEqual({
      ok: true,
      value: { session_id: "ses_1" },
    })
  })

  test("reports corrupt audit JSON lines without throwing", () => {
    const parsed = parseAuditJsonLineResult("{truncated")
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toBeInstanceOf(SyntaxError)
  })

  test("extracts only string audit session IDs from decoded records", () => {
    expect(auditSessionIDFromRecord({ session_id: "ses_1" })).toBe("ses_1")
    expect(auditSessionIDFromRecord({ session_id: 1 })).toBeUndefined()
    expect(auditSessionIDFromRecord(null)).toBeUndefined()
  })
})
