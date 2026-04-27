import { describe, expect, test } from "bun:test"
import { Planner } from "../../src/planner"
import type { PhaseResult, Replanner, TaskPhase } from "../../src/planner"

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

function fail(phaseId: string, error = "boom"): PhaseResult {
  return {
    phaseId,
    success: false,
    error,
    duration: 0,
    tokensUsed: 0,
    filesModified: [],
    wasRetry: false,
    retryAttempt: 1,
  }
}

describe("planner replan hook", () => {
  test("invokes onReplan when phase with replan strategy fails", async () => {
    const plan = Planner.create("test", [
      { name: "first", fallbackStrategy: "replan", maxRetries: 0 },
      { name: "second", dependencies: ["phase-1"] },
    ])

    const replanCalls: string[] = []
    const result = await Planner.execute(
      plan,
      async (phase) => (phase.id === "phase-1" ? fail(phase.id) : ok(phase.id)),
      {
        onReplan: async ({ failed, error }) => {
          replanCalls.push(`${failed.id}:${error}`)
          return [{ name: "recovery", fallbackStrategy: "abort", maxRetries: 0 }]
        },
      },
    )

    expect(replanCalls).toEqual(["phase-1:boom"])
    // recovery executed and succeeded; second phase still runs
    const ids = result.phaseResults.map((r) => r.phaseId)
    expect(ids).toContain("phase-2")
    expect(plan.phases.some((p) => p.name === "recovery")).toBe(true)
  })

  test("inserts replanned phases sequentially after the failed phase", async () => {
    const plan = Planner.create("test", [
      { name: "first", fallbackStrategy: "replan", maxRetries: 0 },
      { name: "follow-up", dependencies: ["phase-1"] },
    ])

    const order: string[] = []
    const result = await Planner.execute(
      plan,
      async (phase) => {
        order.push(phase.id)
        return phase.id === "phase-1" ? fail(phase.id) : ok(phase.id)
      },
      {
        onReplan: async () => [
          { name: "recovery-1", fallbackStrategy: "abort", maxRetries: 0 },
          { name: "recovery-2", fallbackStrategy: "abort", maxRetries: 0 },
        ],
      },
    )

    expect(order).toEqual(["phase-1", "phase-1-replan-1-1", "phase-1-replan-1-2", "phase-2"])
    expect(result.success).toBe(false) // phase-1 still counted as failed
    expect(plan.phasesCompleted).toBe(3) // 2 replan phases + follow-up
  })

  test("aborts when onReplan returns null", async () => {
    const plan = Planner.create("test", [
      { name: "first", fallbackStrategy: "replan", maxRetries: 0 },
      { name: "second", dependencies: ["phase-1"] },
    ])

    const order: string[] = []
    const result = await Planner.execute(
      plan,
      async (phase) => {
        order.push(phase.id)
        return phase.id === "phase-1" ? fail(phase.id) : ok(phase.id)
      },
      {
        onReplan: async () => null,
      },
    )

    expect(order).toEqual(["phase-1"])
    expect(result.warnings.some((w) => w.includes("returned no phases"))).toBe(true)
  })

  test("aborts when fallbackStrategy is replan but no onReplan provided", async () => {
    const plan = Planner.create("test", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const result = await Planner.execute(plan, async (phase) => fail(phase.id))
    expect(result.warnings.some((w) => w.includes("no onReplan callback"))).toBe(true)
  })

  test("respects maxReplanDepth to prevent infinite recursion", async () => {
    const plan = Planner.create("test", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    let calls = 0
    const result = await Planner.execute(
      plan,
      async (phase) => {
        calls++
        return fail(phase.id)
      },
      {
        maxReplanDepth: 2,
        onReplan: async ({ depth }) => [
          {
            name: `replan-${depth}`,
            fallbackStrategy: "replan",
            maxRetries: 0,
          },
        ],
      },
    )

    expect(calls).toBe(3) // original + 2 replan depths
    expect(result.warnings.some((w) => w.includes("exceeds maxReplanDepth"))).toBe(true)
  })

  test("replan phases respect their own skip strategy", async () => {
    const plan = Planner.create("test", [
      { name: "first", fallbackStrategy: "replan", maxRetries: 0 },
      { name: "second", dependencies: ["phase-1"] },
    ])

    const result = await Planner.execute(
      plan,
      async (phase) => {
        if (phase.id === "phase-1") return fail(phase.id)
        if (phase.name === "skippy") return fail(phase.id)
        return ok(phase.id)
      },
      {
        onReplan: async () => [{ name: "skippy", fallbackStrategy: "skip", maxRetries: 0 }],
      },
    )

    expect(plan.phasesSkipped).toBe(1)
    expect(result.phaseResults.some((r) => r.phaseId === "phase-2")).toBe(true)
  })

  test("replan works in parallel batches", async () => {
    const plan = Planner.create("test", [
      { name: "first", canRunInParallel: true, fallbackStrategy: "replan", maxRetries: 0 },
      { name: "second", canRunInParallel: true },
      { name: "third", dependencies: ["phase-1", "phase-2"] },
    ])

    let replanCalled = false
    const result = await Planner.execute(
      plan,
      async (phase) => (phase.id === "phase-1" ? fail(phase.id) : ok(phase.id)),
      {
        onReplan: async () => {
          replanCalled = true
          return [{ name: "recover", fallbackStrategy: "abort", maxRetries: 0 }]
        },
      },
    )

    expect(replanCalled).toBe(true)
    expect(result.phaseResults.some((r) => r.phaseId === "phase-3")).toBe(true)
  })

  test("appends replan phases to plan.phases for downstream visibility", async () => {
    const plan = Planner.create("test", [{ name: "main", fallbackStrategy: "replan", maxRetries: 0 }])

    await Planner.execute(plan, async (phase) => (phase.name === "main" ? fail(phase.id) : ok(phase.id)), {
      onReplan: async () => [
        { name: "recover-A", fallbackStrategy: "abort", maxRetries: 0 },
        { name: "recover-B", fallbackStrategy: "abort", maxRetries: 0 },
      ],
    })

    const phaseNames = plan.phases.map((p) => p.name)
    expect(phaseNames).toEqual(["main", "recover-A", "recover-B"])
  })

  test("ReplanInput exposes failure context", async () => {
    const plan = Planner.create("test", [{ name: "main", fallbackStrategy: "replan", maxRetries: 0 }])

    let captured: { failedName?: string; error?: string; depth?: number } = {}
    await Planner.execute(plan, async (phase) => fail(phase.id, "specific error message"), {
      onReplan: async (input) => {
        captured = { failedName: input.failed.name, error: input.error, depth: input.depth }
        return null
      },
    })

    expect(captured.failedName).toBe("main")
    expect(captured.error).toBe("specific error message")
    expect(captured.depth).toBe(1)
  })

  test("type: replanner can return TaskPhase partials", () => {
    // Compile-time check: Replanner type accepts the API we expose.
    const replanner: Replanner | undefined = async () => [{ name: "x" } satisfies Partial<TaskPhase> & { name: string }]
    expect(replanner).toBeDefined()
  })
})
