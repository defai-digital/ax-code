import { describe, expect, test } from "bun:test"
import { Flag } from "../../src/flag/flag"
import {
  InvalidWorkflowFixtureSpecs,
  WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS,
  WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE,
  WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE,
  WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS,
  WorkflowFixtureSpecs,
  WorkflowInputValidationError,
  WorkflowSpecV1,
  getParsedWorkflowFixtureSpec,
  isWorkflowRuntimeEnabled,
  parseWorkflowSpecV1,
  resolveWorkflowInputValues,
} from "../../src/workflow"

describe("workflow spec v1", () => {
  test("parses the verified bug sweep fixture", () => {
    const spec = getParsedWorkflowFixtureSpec("verifiedBugSweep")

    expect(spec.id).toBe("verified-bug-sweep")
    expect(spec.budget.maxConcurrentAgents).toBe(8)
    expect(spec.budget.maxTotalAgents).toBe(64)
    expect(spec.permissions.writePolicy).toBe("read-only")
    expect(spec.synthesis).toMatchObject({
      agent: "synthesizer",
      outputFormat: "findings",
      exposeToMainContext: true,
      requiredArtifactIds: ["bug-sweep-report"],
    })
    expect(spec.phases.map((phase) => phase.id)).toEqual(["plan-sweep", "scan-files", "cross-check", "final-report"])
  })

  test("parses issue triage and noop fixtures", () => {
    const issueTriage = parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage)
    expect(issueTriage.id).toBe("issue-triage")
    expect(issueTriage.inputs).toEqual([
      {
        id: "issue-limit",
        label: "Issue Limit",
        description: "Maximum number of issues to classify.",
        type: "number",
        required: false,
        sensitive: false,
        default: 10,
      },
    ])
    expect(issueTriage.routine).toMatchObject({
      enabled: false,
      mode: "api",
      apiRoute: "workflow/issue-triage",
      securityGate: "local-only",
    })
    expect(parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun).id).toBe("noop-dry-run")
  })

  test("resolves workflow input values with defaults", () => {
    const spec = parseWorkflowSpecV1(WorkflowFixtureSpecs.issueTriage)

    expect(resolveWorkflowInputValues(spec, {})).toEqual({ "issue-limit": 10 })
    expect(resolveWorkflowInputValues(spec, { "issue-limit": 25 })).toEqual({ "issue-limit": 25 })
  })

  test("rejects unknown, missing, and mistyped workflow input values", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "input-contract",
      name: "Input Contract",
      description: "Validates workflow run input values.",
      inputs: [
        { id: "target", type: "path", required: true },
        { id: "dry-run", type: "boolean" },
      ],
      phases: [{ id: "noop", name: "Noop", kind: "noop" }],
    })

    let error: unknown
    try {
      resolveWorkflowInputValues(spec, { target: 42, extra: true })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(WorkflowInputValidationError)
    expect((error as WorkflowInputValidationError).issues).toEqual([
      "unknown workflow input: extra",
      "workflow input target must be path",
    ])
    expect(() => resolveWorkflowInputValues(spec, {})).toThrow(WorkflowInputValidationError)
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
    expect(spec.pacing).toEqual({
      maxRequestsPerMinute: WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE,
      maxTokensPerMinute: WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE,
    })
    expect(spec.inputs).toEqual([])
    expect(spec.routine).toBeUndefined()
    expect(spec.synthesis).toEqual({
      outputFormat: "markdown",
      exposeToMainContext: true,
      requiredArtifactIds: [],
    })
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

  test("rejects unsafe pacing limits", () => {
    const parsed = WorkflowSpecV1.safeParse({
      schemaVersion: 1,
      id: "unsafe-pacing",
      name: "Unsafe Pacing",
      description: "Invalid provider pacing limits.",
      pacing: {
        maxRequestsPerMinute: 121,
        maxTokensPerMinute: 2_000_001,
      },
      phases: [{ id: "noop", name: "Noop", kind: "noop" }],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "pacing.maxRequestsPerMinute")).toBe(true)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "pacing.maxTokensPerMinute")).toBe(true)
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

  test("validates workflow input, routine, and synthesis contracts", () => {
    const parsed = WorkflowSpecV1.safeParse({
      schemaVersion: 1,
      id: "contract-invalid",
      name: "Contract Invalid",
      description: "Invalid workflow contract fields.",
      inputs: [
        { id: "target", type: "path" },
        { id: "target", type: "string" },
      ],
      routine: {
        enabled: true,
        mode: "webhook",
        securityGate: "required",
      },
      artifacts: [{ id: "declared", kind: "summary" }],
      synthesis: {
        requiredArtifactIds: ["missing"],
      },
      phases: [{ id: "noop", name: "Noop", kind: "noop" }],
    })

    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "inputs.1.id")).toBe(true)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "routine.enabled")).toBe(true)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "routine.webhookEvent")).toBe(true)
    expect(parsed.error?.issues.some((issue) => issue.path.join(".") === "synthesis.requiredArtifactIds")).toBe(true)
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
