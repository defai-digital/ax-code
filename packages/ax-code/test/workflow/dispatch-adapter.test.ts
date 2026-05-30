import { afterEach, describe, expect, test } from "bun:test"
import type { DispatchExecutor } from "../../src/dispatch"
import { Instance } from "../../src/project/instance"
import { WorkflowFixtureSpecs, WorkflowRun, WorkflowScheduler, parseWorkflowSpecV1 } from "../../src/workflow"
import { WorkflowDispatchWritePolicyError } from "../../src/workflow/dispatch-adapter"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("WorkflowDispatchAdapter", () => {
  test("executes read-only phases through dispatcher without TaskQueue children", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const executor: DispatchExecutor = async (spec) => ({
            output: `dispatch:${spec.agent}:${spec.prompt}`,
            filesModified: ["src/alpha.ts", "src/beta.ts"],
            filesProposed: ["src/gamma.ts"],
            tokensUsed: 17,
          })
          const run = await WorkflowRun.create({ spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage) })
          const result = await WorkflowScheduler.start(run.id, {
            allowScaleBeyondDefaults: true,
            enqueueChildren: false,
            dispatchExecutor: executor,
          })

          expect(result.status).toBe("completed")
          expect(result.phases.every((phase) => phase.status === "completed")).toBe(true)
          expect(result.children).toHaveLength(9)
          expect(result.children.every((child) => child.status === "completed")).toBe(true)
          expect(result.children.every((child) => child.taskQueueID === undefined)).toBe(true)
          expect(result.children.every((child) => child.sessionID === undefined)).toBe(true)
          expect(result.children.every((child) => child.evidenceRefs.length === 1)).toBe(true)
          expect(result.budgetUsage.childAgents).toBe(9)
          expect(result.budgetUsage.totalTokens).toBe(153)

          const childLogs = result.artifacts.filter((artifact) => artifact.kind === "log" && artifact.childID)
          expect(childLogs).toHaveLength(9)
          expect(childLogs[0]?.payload).toMatchObject({
            status: "completed",
            filesModified: ["src/alpha.ts", "src/beta.ts"],
            filesProposed: ["src/gamma.ts"],
            tokensUsed: 17,
          })
          expect(childLogs[0]?.summary).toContain("files=2 (src/alpha.ts, src/beta.ts)")
          expect(childLogs[0]?.summary).toContain("proposed=1 (src/gamma.ts)")
          expect(result.children.every((child) => child.artifactIDs.length === 1)).toBe(true)
          expect(result.children[0]?.outputSummary).toContain("files=2 (src/alpha.ts, src/beta.ts)")
          expect(result.children[0]?.outputSummary).toContain("proposed=1 (src/gamma.ts)")
          expect(result.children.every((child) => child.evidenceRefs[0]?.kind === "artifact")).toBe(true)
          expect(
            result.children.every((child) => child.evidenceRefs[0]?.id === child.artifactIDs[0]),
          ).toBe(true)
          expect(result.children.every((child) => childLogs.some((artifact) => artifact.id === child.artifactIDs[0])))
            .toBe(true)
          expect(result.artifacts.some((artifact) => artifact.kind === "summary" && artifact.exposeToMainContext)).toBe(
            true,
          )

          const { TaskQueue } = await import("../../src/session/task-queue")
          expect(await TaskQueue.list()).toEqual([])
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("rejects direct dispatcher execution for write workflows", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "write-dispatch",
            name: "Write Dispatch",
            description: "Direct dispatcher execution must stay read-only.",
            permissions: { writePolicy: "serialized" },
            phases: [{ id: "edit", name: "Edit", kind: "sequential", prompt: "Edit a file." }],
          })
          const run = await WorkflowRun.create({ spec })

          await expect(
            WorkflowScheduler.start(run.id, {
              allowWriteWorkflows: true,
              enqueueChildren: false,
              dispatchExecutor: async () => ({ output: "should not run" }),
            }),
          ).rejects.toThrow(WorkflowDispatchWritePolicyError)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("emits declared verification artifacts but blocks without envelope evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "verified-dispatch",
            name: "Verified Dispatch",
            description: "Read-only direct dispatch that emits the required verification artifact.",
            artifacts: [{ id: "verification-summary", kind: "verification", exposeToMainContext: true }],
            verification: { mode: "required", requiredArtifactIds: ["verification-summary"] },
            phases: [
              {
                id: "verify",
                name: "Verify",
                kind: "verification",
                prompt: "Verify candidate findings.",
                outputs: ["verification-summary"],
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })

          const result = await WorkflowScheduler.start(run.id, {
            enqueueChildren: false,
            dispatchExecutor: async () => ({ output: "verified", tokensUsed: 3 }),
          })

          expect(result.status).toBe("blocked")
          expect(result.error).toContain("missing passing verification envelope evidence: verification-summary")
          expect(result.artifacts).toContainEqual(
            expect.objectContaining({
              kind: "verification",
              specArtifactID: "verification-summary",
            }),
          )
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("satisfies required synthesis gates with declared phase output artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "synthesis-dispatch",
            name: "Synthesis Dispatch",
            description: "Read-only direct dispatch that emits the required synthesis artifact.",
            artifacts: [{ id: "final-summary", kind: "summary", exposeToMainContext: true }],
            synthesis: { requiredArtifactIds: ["final-summary"] },
            phases: [
              {
                id: "summarize",
                name: "Summarize",
                kind: "synthesis",
                prompt: "Summarize findings.",
                outputs: ["final-summary"],
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })

          const result = await WorkflowScheduler.start(run.id, {
            enqueueChildren: false,
            dispatchExecutor: async () => ({ output: "final summary", tokensUsed: 5 }),
          })

          expect(result.status).toBe("completed")
          expect(result.artifacts.some((artifact) => artifact.specArtifactID === "final-summary")).toBe(true)
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("maps vote-with-critic workflow phases to majority dispatch semantics", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "critic-vote-dispatch",
            name: "Critic Vote Dispatch",
            description: "Read-only direct dispatch that treats vote-with-critic as majority consensus.",
            budget: {
              maxTotalTokens: 100,
              maxConcurrentAgents: 3,
              maxTotalAgents: 3,
              maxToolCalls: 30,
            },
            phases: [
              {
                id: "vote",
                name: "Vote",
                kind: "verification",
                prompt: "Vote on candidate findings.",
                inputs: ["a", "b", "c"],
                maxParallel: 3,
                mergeStrategy: "vote-with-critic",
              },
            ],
          })
          const run = await WorkflowRun.create({ spec })
          let calls = 0

          const result = await WorkflowScheduler.start(run.id, {
            enqueueChildren: false,
            dispatchExecutor: async () => {
              calls++
              if (calls <= 2) return { output: `accepted:${calls}`, tokensUsed: 2 }
              throw new Error("critic rejected")
            },
          })

          expect(result.status).toBe("completed")
          expect(result.phases[0]?.status).toBe("completed")
          expect(result.children).toHaveLength(3)
          expect(result.artifacts.find((artifact) => artifact.kind === "summary")?.payload).toMatchObject({
            mergeStrategy: "vote-with-critic",
            counts: { completed: 2 },
          })
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("stops direct dispatch when token budget is exceeded", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "budget-stop",
            name: "Budget Stop",
            description: "Fixture that must stop when direct dispatch exceeds its token budget.",
            budget: {
              maxTotalTokens: 10,
              maxConcurrentAgents: 1,
              maxTotalAgents: 1,
              maxToolCalls: 100,
            },
            phases: [{ id: "scan", name: "Scan", kind: "fanout", prompt: "Spend too many tokens." }],
          })
          const run = await WorkflowRun.create({ spec })

          const result = await WorkflowScheduler.start(run.id, {
            enqueueChildren: false,
            dispatchExecutor: async () => ({ output: "too expensive", tokensUsed: 20 }),
          })

          expect(result.status).toBe("failed")
          expect(result.error).toContain("Workflow budget exceeded")
          expect(result.phases[0]?.status).toBe("failed")
          expect(result.children[0]?.status).toBe("failed")
          expect(result.budgetUsage.totalTokens).toBe(20)
          expect(result.budgetLedger.map((entry) => entry.kind)).toEqual(["reserve", "consume", "exceeded"])
          expect(result.budgetLedger.at(-1)?.message).toContain("total tokens 20/10")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })

  test("stops direct dispatch when a child exceeds its input token slice", async () => {
    await using tmp = await tmpdir({ git: true })
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const spec = parseWorkflowSpecV1({
            schemaVersion: 1,
            id: "child-budget-stop",
            name: "Child Budget Stop",
            description: "Fixture that must stop when one direct dispatch child exceeds its input token cap.",
            budget: {
              maxTotalTokens: 1_000,
              maxInputTokensPerChild: 10,
              maxOutputTokensPerChild: 100,
              maxConcurrentAgents: 1,
              maxTotalAgents: 1,
              maxToolCalls: 100,
            },
            phases: [{ id: "scan", name: "Scan", kind: "fanout", prompt: "Spend too many input tokens." }],
          })
          const run = await WorkflowRun.create({ spec })

          const result = await WorkflowScheduler.start(run.id, {
            enqueueChildren: false,
            dispatchExecutor: async () => ({
              output: "too much context",
              tokensUsed: 25,
              inputTokens: 20,
              outputTokens: 5,
            }),
          })

          expect(result.status).toBe("failed")
          expect(result.error).toContain("child input tokens 20/10")
          expect(result.children[0]?.status).toBe("failed")
          expect(result.budgetUsage).toMatchObject({
            totalTokens: 25,
            inputTokens: 20,
            outputTokens: 5,
          })
          expect(result.budgetLedger.at(-1)?.message).toContain("child input tokens 20/10")
        },
      })
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})
