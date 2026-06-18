import { describe, expect, test } from "bun:test"

import { parseAuditExportSince, validateAuditPruneDays } from "../../src/cli/cmd/audit"

describe("audit cli", () => {
  test("rejects non-positive prune day windows", () => {
    expect(() => validateAuditPruneDays(-1)).toThrow("--days must be at least 1")
    expect(() => validateAuditPruneDays(0)).toThrow("--days must be at least 1")
    expect(() => validateAuditPruneDays(Number.NaN)).toThrow("--days must be at least 1")
    expect(validateAuditPruneDays(1)).toBe(1)
  })

  test("parses valid audit export since values", () => {
    expect(parseAuditExportSince("2026-04-01")).toBe(Date.parse("2026-04-01"))
    expect(parseAuditExportSince(" 2026-04-01T00:00:00Z ")).toBe(Date.parse("2026-04-01T00:00:00Z"))
    expect(parseAuditExportSince(undefined)).toBeUndefined()
    expect(parseAuditExportSince("")).toBeUndefined()
  })

  test("rejects invalid audit export since values", () => {
    expect(() => parseAuditExportSince("not-a-date")).toThrow("--since must be a valid date")
    expect(() => parseAuditExportSince({})).toThrow("--since must be a valid date")
  })
})
