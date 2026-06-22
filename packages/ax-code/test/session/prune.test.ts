import { expect, test } from "vitest"
import { Session } from "../../src/session"

test("reject invalid prune ttl inputs", () => {
  expect(Session.validatePruneTtlDays(1)).toBe(1)
  expect(Session.validatePruneTtlDays(30)).toBe(30)

  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "30", undefined]) {
    expect(() => Session.validatePruneTtlDays(value)).toThrow("Session prune ttlDays must be a positive integer")
  }
})
