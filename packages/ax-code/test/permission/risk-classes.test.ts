import { describe, expect, test } from "bun:test"
import { classify, SAFE_PERMISSIONS, RISK_PERMISSIONS } from "../../src/permission/risk-classes"

describe("permission risk classification", () => {
  test("safe permissions classify as safe", () => {
    for (const p of SAFE_PERMISSIONS) {
      expect(classify(p)).toBe("safe")
    }
  })

  test("risk permissions classify as risk", () => {
    for (const p of RISK_PERMISSIONS) {
      expect(classify(p)).toBe("risk")
    }
  })

  test("unknown permissions classify as unknown", () => {
    expect(classify("isolation_escalation")).toBe("unknown")
    expect(classify("doom_loop")).toBe("unknown")
    expect(classify("totally_made_up")).toBe("unknown")
  })

  test("safe and risk sets do not overlap", () => {
    for (const p of SAFE_PERMISSIONS) {
      expect(RISK_PERMISSIONS.has(p)).toBe(false)
    }
  })
})
