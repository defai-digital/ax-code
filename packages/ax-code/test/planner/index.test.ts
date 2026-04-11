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

  test("times out a phase when it exceeds phaseTimeoutMs", async () => {
    const plan = Planner.create("test", [{ name: "slow", maxRetries: 0 }])

    const result = await Planner.execute(
      plan,
      async () =>
        new Promise(() => {
          return
        }),
      { phaseTimeoutMs: 10 },
    )

    expect(result.success).toBe(false)
    expect(result.phaseResults).toHaveLength(1)
    expect(result.phaseResults[0]?.error).toContain("Phase timed out after 10ms")
  })

  test("clears phase timeout when a phase completes", async () => {
    const plan = Planner.create("test", [{ name: "fast", maxRetries: 0 }])
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const seen = new Set<ReturnType<typeof setTimeout>>()
    const cleared = new Set<ReturnType<typeof setTimeout>>()

    globalThis.setTimeout = ((fn: (...args: any[]) => void, ms?: number, ...args: any[]) => {
      const id = originalSetTimeout(fn, ms, ...args)
      seen.add(id)
      return id
    }) as typeof setTimeout
    globalThis.clearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
      if (id) cleared.add(id)
      return originalClearTimeout(id)
    }) as typeof clearTimeout

    try {
      const result = await Planner.execute(plan, async (phase) => ({
        phaseId: phase.id,
        success: true,
        duration: 0,
        tokensUsed: 0,
        filesModified: [],
        wasRetry: false,
        retryAttempt: 1,
      }))

      expect(result.success).toBe(true)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    }

    expect(seen.size).toBeGreaterThan(0)
    expect(cleared.size).toBeGreaterThan(0)
    expect([...cleared].some((id) => seen.has(id))).toBe(true)
  })

  test("increments skipped phases for skip fallbacks", async () => {
    const plan = Planner.create("test", [
      { name: "first", fallbackStrategy: "skip", maxRetries: 0 },
      { name: "second", fallbackStrategy: "skip", maxRetries: 0, canRunInParallel: true },
      { name: "third", fallbackStrategy: "skip", maxRetries: 0, canRunInParallel: true },
    ])

    const result = await Planner.execute(plan, async (phase) => ({
      phaseId: phase.id,
      success: false,
      error: "failed",
      duration: 0,
      tokensUsed: 0,
      filesModified: [],
      wasRetry: false,
      retryAttempt: 1,
    }))

    expect(result.success).toBe(false)
    expect(plan.phasesSkipped).toBe(3)
    expect(result.warnings.filter((item) => item.includes("skipped"))).toHaveLength(3)
  })
})
