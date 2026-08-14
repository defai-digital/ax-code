import { describe, expect, test } from "vitest"
import {
  clearSessionToolCycleRing,
  ensureSessionToolCycleRing,
  sessionToolCycleSignatures,
  toolCycleSignature,
} from "../../src/session/tool-cycle-ring"

describe("session tool cycle ring", () => {
  test("persists entries across ensure() calls for the same session", () => {
    const sessionID = "ses_ring_persist"
    clearSessionToolCycleRing(sessionID)
    const first = ensureSessionToolCycleRing(sessionID)
    first.push({ tool: "bash", input: '{"command":"ls"}' })
    const second = ensureSessionToolCycleRing(sessionID)
    expect(second).toBe(first)
    expect(second).toHaveLength(1)
    expect(sessionToolCycleSignatures(sessionID).has(toolCycleSignature("bash", '{"command":"ls"}'))).toBe(true)
    clearSessionToolCycleRing(sessionID)
    expect(sessionToolCycleSignatures(sessionID).size).toBe(0)
  })

  test("isolates rings by session id", () => {
    clearSessionToolCycleRing("ses_a")
    clearSessionToolCycleRing("ses_b")
    ensureSessionToolCycleRing("ses_a").push({ tool: "read", input: "a.ts" })
    expect(sessionToolCycleSignatures("ses_b").size).toBe(0)
    clearSessionToolCycleRing("ses_a")
  })
})
