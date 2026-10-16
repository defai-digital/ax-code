import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import { Instance } from "../../src/project/instance"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

// ADR-212: every pending request carries the runtime's own risk class and
// interactive-only flag so clients can order and badge approvals.

beforeEach(() => {
  vi.stubEnv("AX_CODE_ISOLATION_MODE", "workspace-write")
  vi.stubEnv("AX_CODE_ISOLATION_NETWORK", "false")
  // Supervised mode: autonomous mode would auto-approve safe-class requests.
  vi.stubEnv("AX_CODE_AUTONOMOUS", "false")
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await Instance.disposeAll()
})

async function waitForPending(id: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const found = (await Permission.list()).find((entry) => entry.id === id)
    if (found) return found
    await sleep(5)
  }
  return undefined
}

test.each([
  { permission: "todoread", riskClass: "safe", interactiveOnly: false },
  { permission: "bash", riskClass: "risk", interactiveOnly: false },
  { permission: "bash_destructive", riskClass: "risk", interactiveOnly: true },
  { permission: "hook", riskClass: "risk", interactiveOnly: true },
  { permission: "not_a_registered_permission", riskClass: "unknown", interactiveOnly: false },
] as const)("a pending $permission request carries riskClass $riskClass", async (expected) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const asked: Permission.Request[] = []
      const unsubscribe = Bus.subscribe(Permission.Event.Asked, (event) => {
        asked.push(event.properties)
      })
      const requestID = PermissionID.make(`per_risk_${expected.permission}`)
      const request = Permission.ask({
        id: requestID,
        sessionID: SessionID.make("ses_risk_class"),
        permission: expected.permission,
        patterns: ["*"],
        metadata: {},
        always: [],
        // An explicit ask rule keeps even safe-class requests pending.
        ruleset: [{ permission: "*", pattern: "*", action: "ask" }],
      })

      const pending = await waitForPending(requestID)
      expect(pending).toMatchObject({ riskClass: expected.riskClass, interactiveOnly: expected.interactiveOnly })
      await sleep(0)
      expect(asked.find((entry) => entry.id === requestID)).toMatchObject({
        riskClass: expected.riskClass,
        interactiveOnly: expected.interactiveOnly,
      })

      unsubscribe()
      await Permission.reply({ requestID, reply: "reject" })
      await expect(request).rejects.toBeInstanceOf(Permission.RejectedError)
    },
  })
})

test("a caller cannot supply its own risk class", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const requestID = PermissionID.make("per_risk_spoofed")
      const request = Permission.ask({
        id: requestID,
        sessionID: SessionID.make("ses_risk_spoofed"),
        permission: "bash_destructive",
        patterns: ["rm -rf build"],
        metadata: {},
        always: [],
        ruleset: [],
        riskClass: "safe",
        interactiveOnly: false,
      })

      const pending = await waitForPending(requestID)
      expect(pending).toMatchObject({ riskClass: "risk", interactiveOnly: true })

      await Permission.reply({ requestID, reply: "reject" })
      await expect(request).rejects.toBeInstanceOf(Permission.RejectedError)
    },
  })
})
