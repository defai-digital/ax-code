import { describe, expect, test } from "bun:test"
import { Planner } from "../../src/planner"
import { buildUserPrompt } from "../../src/planner/replan-llm"
import type { PhaseResult, ReplanContext, ReplanGenerator } from "../../src/planner"

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

describe("planner.llmReplanner wrapper", () => {
  test("forwards plan goal, error and depth to generator", async () => {
    const plan = Planner.create("rebuild auth", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }], {
      constraints: ["no DB schema changes"],
    })

    const captured: ReplanContext[] = []
    const generator: ReplanGenerator = async (ctx) => {
      captured.push(ctx)
      return [{ name: "recover", fallbackStrategy: "abort", maxRetries: 0 }]
    }

    await Planner.execute(plan, async (phase) => fail(phase.id, "schema drift"), {
      onReplan: Planner.llmReplanner(generator),
    })

    expect(captured).toHaveLength(1)
    const ctx = captured[0]
    expect(ctx.goal).toBe("rebuild auth")
    expect(ctx.error).toBe("schema drift")
    expect(ctx.depth).toBe(1)
    expect(ctx.failed.name).toBe("first")
    expect(ctx.constraints).toEqual(["no DB schema changes"])
  })

  test("empty generator output maps to null (graceful abort)", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const result = await Planner.execute(plan, async (phase) => fail(phase.id), {
      onReplan: Planner.llmReplanner(async () => []),
    })

    expect(result.warnings.some((w) => w.includes("returned no phases"))).toBe(true)
  })

  test("throwing generator maps to null", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const result = await Planner.execute(plan, async (phase) => fail(phase.id), {
      onReplan: Planner.llmReplanner(async () => {
        throw new Error("upstream LLM 500")
      }),
    })

    expect(result.warnings.some((w) => w.includes("returned no phases"))).toBe(true)
  })

  test("respects maxPhases cap", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const order: string[] = []
    await Planner.execute(
      plan,
      async (phase) => {
        order.push(phase.name)
        return phase.name === "first" ? fail(phase.id) : ok(phase.id)
      },
      {
        onReplan: Planner.llmReplanner(
          async () =>
            Array.from({ length: 8 }, (_, i) => ({
              name: `r${i}`,
              fallbackStrategy: "abort" as const,
              maxRetries: 0,
            })),
          { maxPhases: 2 },
        ),
      },
    )

    expect(order).toEqual(["first", "r0", "r1"])
  })

  test("end-to-end: replan generator produces phases that get executed", async () => {
    const plan = Planner.create("rebuild", [
      { name: "build", fallbackStrategy: "replan", maxRetries: 0 },
      { name: "ship", dependencies: ["phase-1"] },
    ])

    const order: string[] = []
    const result = await Planner.execute(
      plan,
      async (phase) => {
        order.push(phase.name)
        return phase.name === "build" ? fail(phase.id) : ok(phase.id)
      },
      {
        onReplan: Planner.llmReplanner(async ({ goal, failed, error }) => {
          expect(goal).toBe("rebuild")
          expect(failed.name).toBe("build")
          expect(error).toBeTruthy()
          return [
            { name: "diagnose", fallbackStrategy: "abort", maxRetries: 0 },
            { name: "rebuild-clean", fallbackStrategy: "abort", maxRetries: 0 },
          ]
        }),
      },
    )

    expect(order).toEqual(["build", "diagnose", "rebuild-clean", "ship"])
    expect(plan.phases.map((p) => p.name)).toEqual(["build", "ship", "diagnose", "rebuild-clean"])
    expect(result.phaseResults.some((r) => r.phaseId === "phase-2")).toBe(true)
  })
})

describe("planner.withApproval", () => {
  test("approver receives proposed phases and ctx", async () => {
    const plan = Planner.create("rebuild", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const captured: Array<{ proposedNames: string[]; goal: string }> = []
    const approver = async ({ proposed, ctx }: Planner.ApprovalInput) => {
      captured.push({ proposedNames: proposed.map((p) => p.name), goal: ctx.goal })
      return proposed
    }

    const generator: Planner.ReplanGenerator = async () => [
      { name: "alpha", fallbackStrategy: "abort", maxRetries: 0 },
      { name: "beta", fallbackStrategy: "abort", maxRetries: 0 },
    ]

    await Planner.execute(plan, async (phase) => fail(phase.id), {
      onReplan: Planner.llmReplanner(Planner.withApproval(generator, approver)),
    })

    expect(captured).toEqual([{ proposedNames: ["alpha", "beta"], goal: "rebuild" }])
  })

  test("approver can edit phases (return subset)", async () => {
    const plan = Planner.create("rebuild", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const order: string[] = []
    await Planner.execute(
      plan,
      async (phase) => {
        order.push(phase.name)
        return phase.name === "first" ? fail(phase.id) : ok(phase.id)
      },
      {
        onReplan: Planner.llmReplanner(
          Planner.withApproval(
            async () => [
              { name: "keep", fallbackStrategy: "abort", maxRetries: 0 },
              { name: "drop", fallbackStrategy: "abort", maxRetries: 0 },
            ],
            async ({ proposed }) => proposed.filter((p) => p.name !== "drop"),
          ),
        ),
      },
    )

    expect(order).toEqual(["first", "keep"])
  })

  test("approver returning null aborts gracefully", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const result = await Planner.execute(plan, async (phase) => fail(phase.id), {
      onReplan: Planner.llmReplanner(
        Planner.withApproval(
          async () => [{ name: "proposed", fallbackStrategy: "abort", maxRetries: 0 }],
          async () => null,
        ),
      ),
    })

    expect(result.warnings.some((w) => w.includes("returned no phases"))).toBe(true)
  })

  test("approver returning empty array aborts gracefully", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const result = await Planner.execute(plan, async (phase) => fail(phase.id), {
      onReplan: Planner.llmReplanner(
        Planner.withApproval(
          async () => [{ name: "proposed", fallbackStrategy: "abort", maxRetries: 0 }],
          async () => [],
        ),
      ),
    })

    expect(result.warnings.some((w) => w.includes("returned no phases"))).toBe(true)
  })

  test("approver is not called when generator returns nothing", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    let approverCalls = 0
    await Planner.execute(plan, async (phase) => fail(phase.id), {
      onReplan: Planner.llmReplanner(
        Planner.withApproval(
          async () => [],
          async () => {
            approverCalls++
            return null
          },
        ),
      ),
    })

    expect(approverCalls).toBe(0)
  })

  test("approver can substitute entirely different phases", async () => {
    const plan = Planner.create("x", [{ name: "first", fallbackStrategy: "replan", maxRetries: 0 }])

    const order: string[] = []
    await Planner.execute(
      plan,
      async (phase) => {
        order.push(phase.name)
        return phase.name === "first" ? fail(phase.id) : ok(phase.id)
      },
      {
        onReplan: Planner.llmReplanner(
          Planner.withApproval(
            async () => [{ name: "llm-proposed", fallbackStrategy: "abort", maxRetries: 0 }],
            async () => [
              { name: "user-edit-1", fallbackStrategy: "abort", maxRetries: 0 },
              { name: "user-edit-2", fallbackStrategy: "abort", maxRetries: 0 },
            ],
          ),
        ),
      },
    )

    expect(order).toEqual(["first", "user-edit-1", "user-edit-2"])
  })
})

describe("planner.replan-llm.buildUserPrompt", () => {
  test("includes goal, failed name, error, depth", () => {
    const prompt = buildUserPrompt({
      goal: "ship feature X",
      failed: {
        id: "phase-1",
        index: 0,
        name: "extract helper",
        description: "Pull `validate()` out of `auth.ts`",
        objectives: ["create util/validate.ts", "update callers"],
        toolsRequired: [],
        dependencies: [],
        canRunInParallel: false,
        riskLevel: "low",
        requiresApproval: false,
        fallbackStrategy: "replan",
        maxRetries: 0,
        status: "failed",
        retryCount: 0,
      },
      error: "TypeError at line 42",
      depth: 1,
      constraints: ["preserve API"],
    })

    expect(prompt).toContain("Original goal: ship feature X")
    expect(prompt).toContain('Failed phase: "extract helper"')
    expect(prompt).toContain("Description: Pull `validate()` out of `auth.ts`")
    expect(prompt).toContain("create util/validate.ts")
    expect(prompt).toContain("Error: TypeError at line 42")
    expect(prompt).toContain("Replan depth: 1")
    expect(prompt).toContain("preserve API")
  })

  test("omits empty optional sections cleanly", () => {
    const prompt = buildUserPrompt({
      goal: "x",
      failed: {
        id: "p1",
        index: 0,
        name: "p1",
        description: "",
        objectives: [],
        toolsRequired: [],
        dependencies: [],
        canRunInParallel: false,
        riskLevel: "low",
        requiresApproval: false,
        fallbackStrategy: "replan",
        maxRetries: 0,
        status: "failed",
        retryCount: 0,
      },
      error: "e",
      depth: 1,
    })
    expect(prompt).not.toContain("Description:")
    expect(prompt).not.toContain("Original objectives:")
    expect(prompt).not.toContain("Constraints:")
  })
})
