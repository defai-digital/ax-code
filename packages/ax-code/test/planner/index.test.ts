import { describe, expect, test } from "bun:test"
import { Planner } from "../../src/planner"

describe("planner.execute", () => {
  test("stops later sequential batches after abort failure", async () => {
    const plan = Planner.create("test", [
      {
        name: "first",
        fallbackStrategy: "abort",
        maxRetries: 0,
      },
      {
        name: "second",
        dependencies: ["phase-1"],
      },
    ])

    const calls: string[] = []
    const result = await Planner.execute(plan, async (phase) => {
      calls.push(phase.id)
      return {
        phaseId: phase.id,
        success: phase.id !== "phase-1",
        error: phase.id === "phase-1" ? "failed" : undefined,
        duration: 0,
        tokensUsed: 0,
        filesModified: [],
        wasRetry: false,
        retryAttempt: 1,
      }
    })

    expect(calls).toEqual(["phase-1"])
    expect(result.phaseResults).toHaveLength(1)
    expect(result.warnings.some((item) => item.includes("stopping plan"))).toBe(true)
  })

  test("stops later batches after abort failure in a parallel batch", async () => {
    const plan = Planner.create("test", [
      {
        name: "first",
        canRunInParallel: true,
        fallbackStrategy: "abort",
        maxRetries: 0,
      },
      {
        name: "second",
        canRunInParallel: true,
      },
      {
        name: "third",
        dependencies: ["phase-1", "phase-2"],
      },
    ])

    const calls: string[] = []
    const result = await Planner.execute(plan, async (phase) => {
      calls.push(phase.id)
      return {
        phaseId: phase.id,
        success: phase.id !== "phase-1",
        error: phase.id === "phase-1" ? "failed" : undefined,
        duration: 0,
        tokensUsed: 0,
        filesModified: [],
        wasRetry: false,
        retryAttempt: 1,
      }
    })

    expect(calls.sort()).toEqual(["phase-1", "phase-2"])
    expect(result.phaseResults).toHaveLength(2)
    expect(result.warnings.some((item) => item.includes("stopping plan"))).toBe(true)
  })

  test("executes every phase when a parallel batch exceeds maxParallelPhases", async () => {
    const plan = Planner.create("test", [
      {
        name: "first",
        canRunInParallel: true,
      },
      {
        name: "second",
        canRunInParallel: true,
      },
      {
        name: "third",
        canRunInParallel: true,
      },
    ])

    const calls: string[] = []
    const result = await Planner.execute(
      plan,
      async (phase) => {
        calls.push(phase.id)
        return {
          phaseId: phase.id,
          success: true,
          duration: 0,
          tokensUsed: 0,
          filesModified: [],
          wasRetry: false,
          retryAttempt: 1,
        }
      },
      { maxParallelPhases: 2 },
    )

    expect(calls.sort()).toEqual(["phase-1", "phase-2", "phase-3"])
    expect(result.phaseResults).toHaveLength(3)
    expect(result.success).toBe(true)
  })
})
