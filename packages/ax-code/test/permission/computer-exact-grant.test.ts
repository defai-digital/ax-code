import { afterEach, describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { Permission } from "../../src/permission"
import { evaluate } from "../../src/permission/evaluate"
import { Instance } from "../../src/project/instance"
import { PermissionID } from "../../src/permission/schema"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(() => {
  vi.unstubAllEnvs()
})

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

  test("ask does not auto-approve computer_capture under autonomous full-access wildcard allow", async () => {
    vi.stubEnv("AX_CODE_AUTONOMOUS", "1")
    vi.stubEnv("AX_CODE_ISOLATION_MODE", "full-access")
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const pending = Permission.ask({
          id: PermissionID.make("per_computer_capture"),
          sessionID: SessionID.make("ses_computer_grant"),
          permission: "computer_capture",
          patterns: ["app:com.apple.iCal"],
          metadata: {},
          always: [],
          ruleset: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        const deadline = Date.now() + 3000
        let list = await Permission.list()
        while (list.length === 0 && Date.now() < deadline) {
          await sleep(10)
          list = await Permission.list()
        }
        expect(list).toHaveLength(1)
        expect(list[0]?.permission).toBe("computer_capture")
        await Permission.reply({ requestID: list[0]!.id, reply: "reject" })
        await expect(pending).rejects.toBeInstanceOf(Permission.RejectedError)
      },
    })
  })
})
