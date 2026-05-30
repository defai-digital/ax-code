import { describe, expect, test } from "bun:test"
import { WorkflowFixtureSpecs, WorkflowPlanError, planWorkflowDryRun, parseWorkflowSpecV1 } from "../../src/workflow"

describe("workflow dry-run planner", () => {
  test("expands a noop workflow without starting children", () => {
    const plan = planWorkflowDryRun({
      spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun),
    })

    expect(plan.summary.phaseCount).toBe(1)
    expect(plan.summary.estimatedChildAgents).toBe(1)
    expect(plan.phases[0]?.maxParallel).toBe(1)
    expect(plan.phases[0]?.children[0]).toMatchObject({
      modelRole: "planner",
      durable: true,
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
})
