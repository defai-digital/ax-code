import { describe, expect, test } from "bun:test"

import { validateAuditPruneDays } from "../../src/cli/cmd/audit"

describe("audit cli", () => {
  test("rejects non-positive prune day windows", () => {
    expect(() => validateAuditPruneDays(-1)).toThrow("--days must be at least 1")
    expect(() => validateAuditPruneDays(0)).toThrow("--days must be at least 1")
    expect(() => validateAuditPruneDays(Number.NaN)).toThrow("--days must be at least 1")
    expect(validateAuditPruneDays(1)).toBe(1)
  })
})
