import { afterEach, describe, expect, test } from "bun:test"
import type { DispatchExecutor } from "../../src/dispatch"
import { Instance } from "../../src/project/instance"
import {
  WorkflowFixtureSpecs,
  WorkflowRun,
  WorkflowScheduler,
  parseWorkflowSpecV1,
} from "../../src/workflow"
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
          expect(result.budgetUsage.childAgents).toBe(9)
          expect(result.budgetUsage.totalTokens).toBe(153)

          const childLogs = result.artifacts.filter((artifact) => artifact.kind === "log")
          expect(childLogs).toHaveLength(9)
          expect(childLogs[0]?.payload).toMatchObject({ status: "completed", tokensUsed: 17 })
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

  test("satisfies required verification gates with declared phase output artifacts", async () => {
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

          expect(result.status).toBe("completed")
          expect(result.artifacts.some((artifact) => artifact.specArtifactID === "verification-summary")).toBe(true)
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
})
