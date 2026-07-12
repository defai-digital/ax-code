import { describe, expect, test } from "vitest"
import { WriteIsolation } from "../../src/session/write-isolation"

/**
 * task_parallel integration with LLM sessions is covered by smoke dogfood.
 * Unit coverage here locks the write-isolation gate the tool applies before
 * fan-out (ADR-048 Phase 1).
 */
describe("task_parallel write isolation contract", () => {
  test("parallel explore digs are permitted", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      {
        name: "explore",
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "read", pattern: "*", action: "allow" },
        ],
      },
      {
        name: "explore",
        permission: [
          { permission: "*", pattern: "*", action: "deny" },
          { permission: "grep", pattern: "*", action: "allow" },
        ],
      },
    ])
    expect(decision.ok).toBe(true)
  })

  test("parallel build digs are rejected", () => {
    const decision = WriteIsolation.evaluateParallelAgents([
      {
        name: "build",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
      {
        name: "test",
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
      },
    ])
    expect(decision.ok).toBe(false)
    if (decision.ok) throw new Error("expected multi_writer rejection")
    expect(decision.reason).toBe("multi_writer")
  })
})
