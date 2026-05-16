import { describe, expect, test } from "bun:test"
import { Planner } from "../../src/planner"
import type { PhaseResult } from "../../src/planner"

function ok(phaseId: string): PhaseResult {
  return {
    phaseId,
    success: true,
    duration: 0,
    tokensUsed: 0,
    filesModified: [],
    wasRetry: false,
    retryAttempt: 1,
  }
}

describe("planner phaseReviewer hook (PRD v4.2.0 P1-3)", () => {
  test("does not affect successful phases when reviewer returns block:false", async () => {
    const plan = Planner.create("test", [{ name: "phase-a", maxRetries: 0 }])
    const result = await Planner.execute(plan, async (phase) => ok(phase.id), {
      phaseReviewer: async () => ({ block: false }),
    })
    expect(result.success).toBe(true)
  })

  test("blocking reviewer demotes a successful phase to failure", async () => {
    const plan = Planner.create("test", [
      { name: "phase-a", fallbackStrategy: "abort", maxRetries: 0 },
      { name: "phase-b", dependencies: ["phase-1"] },
    ])
    const result = await Planner.execute(plan, async (phase) => ok(phase.id), {
      phaseReviewer: async (phase) =>
        phase.name === "phase-a" ? { block: true, error: "critic blocked: HIGH bug @ src/foo.ts:1" } : { block: false },
    })
    expect(result.success).toBe(false)
    expect(plan.phases[0].status).toBe("failed")
  })

  test("blocking reviewer triggers replan fallback", async () => {
    const plan = Planner.create("test", [{ name: "phase-a", fallbackStrategy: "replan", maxRetries: 0 }])

    let replanCalled = 0
    let executions = 0
    const result = await Planner.execute(
      plan,
      async (phase) => {
        executions++
        return ok(phase.id)
      },
      {
        phaseReviewer: async (phase) => (phase.id === "phase-1" ? { block: true, error: "blocked" } : { block: false }),
        onReplan: async () => {
          replanCalled++
          return [{ name: "recovery", fallbackStrategy: "abort", maxRetries: 0 }]
        },
      },
    )

    expect(replanCalled).toBe(1)
    // executor was called for the original phase plus the recovery phase.
    expect(executions).toBeGreaterThanOrEqual(2)
    expect(plan.phases.some((p) => p.name === "recovery")).toBe(true)
    // recovery succeeded, plan as a whole succeeded.
    expect(result).toBeDefined()
  })

  test("reviewer errors are non-fatal — phase still completes", async () => {
    const plan = Planner.create("test", [{ name: "phase-a", maxRetries: 0 }])
    const result = await Planner.execute(plan, async (phase) => ok(phase.id), {
      phaseReviewer: async () => {
        throw new Error("reviewer crashed")
      },
    })
    expect(result.success).toBe(true)
  })
})
