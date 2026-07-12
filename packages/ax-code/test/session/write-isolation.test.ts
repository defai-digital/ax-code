import { describe, expect, test } from "vitest"
import { WriteIsolation } from "../../src/session/write-isolation"

function agent(
  name: string,
  rules: Array<{ permission: string; pattern: string; action: "allow" | "deny" | "ask" }>,
) {
  return { name, permission: rules }
}

describe("WriteIsolation.classifyAgentWriteClass", () => {
  test("explore is always read-only", () => {
    expect(
      WriteIsolation.classifyAgentWriteClass(
        agent("explore", [{ permission: "edit", pattern: "*", action: "allow" }]),
      ),
    ).toBe("read-only")
  })

  test("deny-all with selective read tools is read-only", () => {
    const klass = WriteIsolation.classifyAgentWriteClass(
      agent("research", [
        { permission: "*", pattern: "*", action: "deny" },
        { permission: "read", pattern: "*", action: "allow" },
        { permission: "grep", pattern: "*", action: "allow" },
      ]),
    )
    expect(klass).toBe("read-only")
  })

  test("default allow agents are writers", () => {
    expect(
      WriteIsolation.classifyAgentWriteClass(
        agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
      ),
    ).toBe("writer")
  })
})

describe("WriteIsolation.evaluateParallelAgents", () => {
  test("allows all-explore parallel digs", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
      agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
    ])
    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error("expected ok")
    expect(decision.writers).toEqual([])
    expect(decision.readers).toEqual(["explore", "explore"])
  })

  test("allows a single writer with readers", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      agent("explore", [{ permission: "*", pattern: "*", action: "deny" }]),
      agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
    ])
    expect(decision.ok).toBe(true)
    if (!decision.ok) throw new Error("expected ok")
    expect(decision.writers).toEqual(["build"])
  })

  test("rejects multi-writer fan-out", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      agent("build", [{ permission: "*", pattern: "*", action: "allow" }]),
      agent("debug", [{ permission: "*", pattern: "*", action: "allow" }]),
    ])
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected rejection")
    expect(decision.reason).toBe("multi_writer")
    expect(decision.message).toContain("concurrent writers")
  })
})
