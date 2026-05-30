import { describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import {
  InvalidWorkflowFixtureSpecs,
  WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS,
  WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS,
  WorkflowFixtureSpecs,
  WorkflowSpecV1,
  getParsedWorkflowFixtureSpec,
  isWorkflowRuntimeEnabled,
  parseWorkflowSpecV1,
} from "../../src/workflow"

describe("workflow spec v1", () => {
  test("parses the verified bug sweep fixture", () => {
    const spec = getParsedWorkflowFixtureSpec("verifiedBugSweep")

    expect(spec.id).toBe("verified-bug-sweep")
    expect(spec.budget.maxConcurrentAgents).toBe(8)
    expect(spec.budget.maxTotalAgents).toBe(64)
    expect(spec.permissions.writePolicy).toBe("read-only")
    expect(spec.phases.map((phase) => phase.id)).toEqual(["plan-sweep", "scan-files", "cross-check", "final-report"])
  })

  test("parses issue triage and noop fixtures", () => {
    expect(parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage).id).toBe("issue-triage")
    expect(parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun).id).toBe("noop-dry-run")
  })

  test("applies conservative defaults", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "minimal",
      name: "Minimal",
      description: "A minimal workflow spec.",
      phases: [
        {
          id: "noop",
          name: "Noop",
          kind: "noop",
        },
      ],
    })

    expect(spec.trigger).toEqual({ kind: "manual", source: "prompt" })
    expect(spec.budget.maxConcurrentAgents).toBe(WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS)
    expect(spec.budget.maxTotalAgents).toBe(WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS)
    expect(spec.permissions.writePolicy).toBe("read-only")
    expect(spec.modelPolicy.effort).toBe("normal")
  })

  test("rejects workflows without phases", () => {
    const parsed = WorkflowSpecV1.safeParse({
      schemaVersion: 1,
      id: "empty",
      name: "Empty",
      description: "Invalid empty workflow.",
      phases: [],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "phases")).toBe(true)
  })

  test("rejects unsafe scale budgets", () => {
    const parsed = WorkflowSpecV1.safeParse(InvalidWorkflowFixtureSpecs.overBudget)

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "budget.maxConcurrentAgents")).toBe(true)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "budget.maxTotalAgents")).toBe(true)
  })

  test("rejects phase parallelism above the workflow budget", () => {
    const parsed = WorkflowSpecV1.safeParse({
      schemaVersion: 1,
      id: "parallelism-mismatch",
      name: "Parallelism Mismatch",
      description: "Invalid phase budget.",
      budget: {
        maxConcurrentAgents: 2,
        maxTotalAgents: 4,
      },
      phases: [
        {
          id: "scan",
          name: "Scan",
          kind: "fanout",
          maxParallel: 3,
        },
      ],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "phases.0.maxParallel")).toBe(true)
  })

  test("requires dependencies to point at earlier phases", () => {
    const parsed = WorkflowSpecV1.safeParse({
      schemaVersion: 1,
      id: "bad-dependency",
      name: "Bad Dependency",
      description: "Invalid dependency ordering.",
      phases: [
        {
          id: "second",
          name: "Second",
          kind: "synthesis",
          dependsOn: ["first"],
        },
        {
          id: "first",
          name: "First",
          kind: "noop",
        },
      ],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "phases.0.dependsOn")).toBe(true)
  })

  test("requires phase outputs and verification requirements to reference declared artifacts", () => {
    const parsed = WorkflowSpecV1.safeParse({
      schemaVersion: 1,
      id: "missing-artifact",
      name: "Missing Artifact",
      description: "Invalid artifact references.",
      verification: {
        requiredArtifactIds: ["missing"],
      },
      phases: [
        {
          id: "scan",
          name: "Scan",
          kind: "fanout",
          outputs: ["missing"],
        },
      ],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "phases.0.outputs")).toBe(true)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "verification.requiredArtifactIds")).toBe(true)
  })

  test("keeps workflow runtime behind AX_CODE_WORKFLOW_RUNTIME", () => {
    const previous = process.env.AX_CODE_WORKFLOW_RUNTIME
    try {
      delete process.env.AX_CODE_WORKFLOW_RUNTIME
      expect(Flag.AX_CODE_WORKFLOW_RUNTIME).toBe(false)
      expect(isWorkflowRuntimeEnabled()).toBe(false)

      process.env.AX_CODE_WORKFLOW_RUNTIME = "1"
      expect(Flag.AX_CODE_WORKFLOW_RUNTIME).toBe(true)
      expect(isWorkflowRuntimeEnabled()).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.AX_CODE_WORKFLOW_RUNTIME
      else process.env.AX_CODE_WORKFLOW_RUNTIME = previous
    }
  })
})
