import { describe, expect, test } from "vitest"
import { Permission } from "../../src/permission"
import { evaluate } from "../../src/permission/evaluate"

describe("computer exact-grant evaluation (ADR-052)", () => {
  test("wildcard allow does not grant computer_capture", () => {
    const result = evaluate("computer_capture", "app:com.apple.iCal", [
      { permission: "*", pattern: "*", action: "allow" },
    ])
    expect(result.action).toBe("ask")
  })

  test("exact allow matches only the named app pattern", () => {
    const rules = [{ permission: "computer_capture", pattern: "app:com.apple.iCal", action: "allow" as const }]
    expect(evaluate("computer_capture", "app:com.apple.iCal", rules).action).toBe("allow")
    expect(evaluate("computer_capture", "app:com.apple.Safari", rules).action).toBe("ask")
  })

  test("wildcard deny still matches computer permissions", () => {
    const result = evaluate("computer_input", "app:com.apple.iCal", [
      { permission: "computer_input", pattern: "*", action: "deny" },
    ])
    expect(result.action).toBe("deny")
  })

  test("computer_commit is interactive-only and never-autonomous", () => {
    expect(Permission.isInteractiveOnly("computer_commit")).toBe(true)
    expect(Permission.isNeverAutonomousAutoApprove("computer_capture")).toBe(true)
    expect(Permission.isNeverAutonomousAutoApprove("computer_input")).toBe(true)
    expect(Permission.isNeverAutonomousAutoApprove("computer_commit")).toBe(true)
    expect(Permission.isNeverAutonomousAutoApprove("bash")).toBe(false)
  })
})
