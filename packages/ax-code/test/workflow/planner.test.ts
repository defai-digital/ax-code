import { describe, expect, test } from "bun:test"
import { WorkflowFixtureSpecs, WorkflowPlanError, planWorkflowDryRun, parseWorkflowSpecV1 } from "../../src/workflow"

describe("workflow dry-run planner", () => {
  test("expands a noop workflow without starting children", () => {
    const plan = planWorkflowDryRun({
      spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun),
    })

    expect(plan.summary.phaseCount).toBe(1)
    expect(plan.summary.estimatedChildAgents).toBe(1)
    expect(plan.summary.maxRequestsPerMinute).toBe(12)
    expect(plan.summary.maxTokensPerMinute).toBe(200_000)
    expect(plan.phases[0]?.maxParallel).toBe(1)
    expect(plan.phases[0]?.pacing).toEqual({ maxRequestsPerMinute: 12, maxTokensPerMinute: 200_000 })
    expect(plan.phases[0]?.children[0]).toMatchObject({
      modelRole: "planner",
      durable: true,
      pacing: { maxRequestsPerMinute: 12, maxTokensPerMinute: 200_000 },
      writePolicy: "read-only",
    })
  })

  test("rejects scale beyond conservative defaults unless explicitly allowed", () => {
    const spec = parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage)

    expect(() => planWorkflowDryRun({ spec })).toThrow(WorkflowPlanError)

    const plan = planWorkflowDryRun({
      spec,
      allowScaleBeyondDefaults: true,
    })
    expect(plan.summary.maxConcurrentAgents).toBe(8)
    expect(plan.summary.estimatedChildAgents).toBe(9)
    expect(plan.phases[0]?.estimatedChildren).toBe(8)
  })

  test("rejects write workflows unless explicitly allowed", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "write-workflow",
      name: "Write Workflow",
      description: "Invalid without explicit write approval.",
      permissions: {
        writePolicy: "worktree-required",
      },
      phases: [
        {
          id: "edit",
          name: "Edit",
          kind: "sequential",
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec })).toThrow(/writePolicy worktree-required/)
    expect(planWorkflowDryRun({ spec, allowWriteWorkflows: true }).summary.writePolicy).toBe("worktree-required")
  })

  test("rejects plans that estimate more children than the workflow budget allows", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "too-many-children",
      name: "Too Many Children",
      description: "The fan-out estimate exceeds maxTotalAgents.",
      budget: {
        maxConcurrentAgents: 2,
        maxTotalAgents: 2,
      },
      phases: [
        {
          id: "fanout",
          name: "Fanout",
          kind: "fanout",
          inputs: ["a", "b", "c"],
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec })).toThrow(/child agents 3\/2/)
  })

  test("rejects phase bursts above declared provider pacing", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "pacing-burst",
      name: "Pacing Burst",
      description: "The fan-out phase exceeds declared provider pacing.",
      budget: {
        maxTotalTokens: 12_000,
        maxConcurrentAgents: 4,
        maxTotalAgents: 4,
      },
      pacing: {
        maxRequestsPerMinute: 2,
        maxTokensPerMinute: 8_000,
      },
      phases: [
        {
          id: "fanout",
          name: "Fanout",
          kind: "fanout",
          inputs: ["a", "b", "c", "d"],
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec, allowScaleBeyondDefaults: true })).toThrow(/request burst 4\/2/)
  })

  test("allows phase-specific pacing overrides when they cover the burst", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "phase-pacing",
      name: "Phase Pacing",
      description: "A phase override covers the planned fan-out burst.",
      budget: {
        maxTotalTokens: 12_000,
        maxConcurrentAgents: 4,
        maxTotalAgents: 4,
      },
      pacing: {
        maxRequestsPerMinute: 2,
        maxTokensPerMinute: 8_000,
      },
      phases: [
        {
          id: "fanout",
          name: "Fanout",
          kind: "fanout",
          inputs: ["a", "b", "c", "d"],
          pacing: {
            maxRequestsPerMinute: 4,
            maxTokensPerMinute: 12_000,
          },
        },
      ],
    })

    const plan = planWorkflowDryRun({ spec, allowScaleBeyondDefaults: true })
    expect(plan.phases[0]?.pacing).toEqual({ maxRequestsPerMinute: 4, maxTokensPerMinute: 12_000 })
    expect(plan.phases[0]?.children[0]?.pacing).toEqual({ maxRequestsPerMinute: 4, maxTokensPerMinute: 12_000 })
  })

  test("rejects phase pacing above safe defaults without scale opt-in", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "phase-pacing-over-default",
      name: "Phase Pacing Over Default",
      description: "Phase-level provider pacing still needs scale approval.",
      phases: [
        {
          id: "fanout",
          name: "Fanout",
          kind: "fanout",
          pacing: {
            maxRequestsPerMinute: 20,
          },
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec })).toThrow(/phase fanout maxRequestsPerMinute 20 exceeds safe default/)
    expect(planWorkflowDryRun({ spec, allowScaleBeyondDefaults: true }).phases[0]?.pacing.maxRequestsPerMinute).toBe(20)
  })
})
