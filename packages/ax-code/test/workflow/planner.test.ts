import { describe, expect, test } from "vitest"
import {
  WorkflowDryRunInput,
  WorkflowFixtureSpecs,
  WorkflowPlanError,
  WorkflowScheduler,
  planWorkflowDryRun,
  parseWorkflowSpecV1,
} from "../../src/workflow"

describe("workflow dry-run planner", () => {
  test("parses string booleans in workflow start options from JSON clients", () => {
    const spec = parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun)

    const dryRun = WorkflowDryRunInput.parse({
      spec,
      allowScaleBeyondDefaults: "true",
      allowWriteWorkflows: "false",
      durableChildren: "0",
    })
    expect(dryRun.allowScaleBeyondDefaults).toBe(true)
    expect(dryRun.allowWriteWorkflows).toBe(false)
    expect(dryRun.durableChildren).toBe(false)

    const startOptions = WorkflowScheduler.StartOptions.parse({
      allowScaleBeyondDefaults: "1",
      allowWriteWorkflows: "false",
      durableChildren: "true",
      enqueueChildren: "0",
    })
    expect(startOptions).toEqual({
      allowScaleBeyondDefaults: true,
      allowWriteWorkflows: false,
      durableChildren: true,
      enqueueChildren: false,
    })
  })

  test("expands a noop workflow without starting children", () => {
    const plan = planWorkflowDryRun({
      spec: parseWorkflowSpecV1(WorkflowFixtureSpecs.noopDryRun),
    })

    expect(plan.summary.phaseCount).toBe(1)
    expect(plan.summary.estimatedChildAgents).toBe(1)
    expect(plan.summary.maxInputTokensPerChild).toBe(50_000)
    expect(plan.summary.maxOutputTokensPerChild).toBe(8_000)
    expect(plan.summary.maxRequestsPerMinute).toBe(12)
    expect(plan.summary.maxTokensPerMinute).toBe(200_000)
    expect(plan.phases[0]?.maxParallel).toBe(1)
    expect(plan.phases[0]?.pacing).toEqual({ maxRequestsPerMinute: 12, maxTokensPerMinute: 200_000 })
    expect(plan.phases[0]?.children[0]).toMatchObject({
      modelRole: "planner",
      durable: true,
      budgetSlice: {
        maxInputTokensPerChild: 50_000,
        maxOutputTokensPerChild: 8_000,
      },
      pacing: { maxRequestsPerMinute: 12, maxTokensPerMinute: 200_000 },
      writePolicy: "read-only",
      escalationPolicy: "ask",
      artifactRefs: [],
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
    expect(plan.phases[0]?.children[0]?.artifactRefs).toEqual([])
    expect(plan.phases[1]?.children[0]?.artifactRefs).toEqual(["issue-table"])
  })

  test("serializes write workflows when explicitly allowed", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "serialized-write-workflow",
      name: "Serialized Write Workflow",
      description: "Write fan-out must run one child at a time in the shared workspace.",
      permissions: {
        writePolicy: "serialized",
      },
      budget: {
        maxConcurrentAgents: 3,
        maxTotalAgents: 3,
      },
      phases: [
        {
          id: "edit-files",
          name: "Edit Files",
          kind: "fanout",
          inputs: ["a", "b", "c"],
          maxParallel: 3,
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec })).toThrow(/writePolicy serialized/)
    const plan = planWorkflowDryRun({ spec, allowWriteWorkflows: true })
    expect(plan.summary.writePolicy).toBe("serialized")
    expect(plan.summary.estimatedChildAgents).toBe(3)
    expect(plan.phases[0]?.maxParallel).toBe(1)
    expect(plan.phases[0]?.children[0]?.writePolicy).toBe("serialized")
  })

  test("allows worktree-required workflows when explicitly approved", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "isolated-write-workflow",
      name: "Isolated Write Workflow",
      description: "Worktree-required writes need per-child worktree execution before they can run.",
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
    const plan = planWorkflowDryRun({ spec, allowWriteWorkflows: true })
    expect(plan.summary.writePolicy).toBe("worktree-required")
    expect(plan.phases[0]?.children[0]?.writePolicy).toBe("worktree-required")
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

  test("inherits workflow pacing fields that a phase does not override", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "phase-pacing-inheritance",
      name: "Phase Pacing Inheritance",
      description: "Phase pacing overrides should not reset unspecified workflow pacing fields.",
      budget: {
        maxTotalTokens: 4_000,
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
          },
        },
      ],
    })

    const plan = planWorkflowDryRun({ spec, allowScaleBeyondDefaults: true })
    expect(plan.phases[0]?.pacing).toEqual({ maxRequestsPerMinute: 4, maxTokensPerMinute: 8_000 })
  })

  test("slices child token caps from workflow and phase budgets", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "child-token-caps",
      name: "Child Token Caps",
      description: "The planner carries child-level input and output token limits.",
      budget: {
        maxTotalTokens: 12_000,
        maxInputTokensPerChild: 3_000,
        maxOutputTokensPerChild: 1_000,
        maxConcurrentAgents: 2,
        maxTotalAgents: 2,
      },
      phases: [
        {
          id: "fanout",
          name: "Fanout",
          kind: "fanout",
          inputs: ["a", "b"],
          budget: {
            maxInputTokensPerChild: 2_000,
          },
        },
      ],
    })

    const plan = planWorkflowDryRun({ spec })
    expect(plan.phases[0]?.children[0]?.budgetSlice).toMatchObject({
      maxTotalTokens: 6_000,
      maxInputTokensPerChild: 2_000,
      maxOutputTokensPerChild: 1_000,
    })
  })

  test("routes phase models through default, cheap, and strong policy aliases", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "model-aliases",
      name: "Model Aliases",
      description: "Workflow model aliases should map to phase roles unless a role-specific model overrides them.",
      budget: {
        maxTotalTokens: 12_000,
        maxConcurrentAgents: 2,
        maxTotalAgents: 5,
      },
      modelPolicy: {
        defaultModel: "openai/gpt-5-mini",
        cheapModel: "openai/gpt-5-nano",
        strongModel: "anthropic/claude-sonnet-4-5",
      },
      phases: [
        {
          id: "plan",
          name: "Plan",
          kind: "sequential",
        },
        {
          id: "scan",
          name: "Scan",
          kind: "fanout",
          inputs: ["a", "b"],
        },
        {
          id: "verify",
          name: "Verify",
          kind: "verification",
        },
        {
          id: "report",
          name: "Report",
          kind: "synthesis",
          modelPolicy: {
            synthesizerModel: "anthropic/claude-opus-4-7",
          },
        },
      ],
    })

    const plan = planWorkflowDryRun({ spec })

    expect(plan.phases[0]?.children[0]?.model).toBe("openai/gpt-5-mini")
    expect(plan.phases[1]?.children[0]?.model).toBe("openai/gpt-5-nano")
    expect(plan.phases[2]?.children[0]?.model).toBe("openai/gpt-5-nano")
    expect(plan.phases[3]?.children[0]?.model).toBe("anthropic/claude-opus-4-7")
  })

  test("applies model routing rules before resolving role model aliases", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "model-routing-rules",
      name: "Model Routing Rules",
      description: "Workflow route rules should choose auditable phase model roles.",
      budget: {
        maxTotalTokens: 12_000,
        maxConcurrentAgents: 2,
        maxTotalAgents: 4,
      },
      modelPolicy: {
        defaultModel: "openai/gpt-5-mini",
        cheapModel: "openai/gpt-5-nano",
        strongModel: "anthropic/claude-sonnet-4-5",
        verifierModel: "openai/gpt-5-mini-verifier",
        routing: [
          {
            phaseKind: "fanout",
            use: "verifier",
          },
          {
            phaseKind: "synthesis",
            use: "worker",
          },
        ],
      },
      phases: [
        {
          id: "scan",
          name: "Scan",
          kind: "fanout",
          inputs: ["a", "b"],
        },
        {
          id: "triage",
          name: "Triage",
          kind: "sequential",
          modelPolicy: {
            routing: [
              {
                use: "synthesizer",
              },
            ],
          },
        },
        {
          id: "report",
          name: "Report",
          kind: "synthesis",
        },
      ],
    })

    const plan = planWorkflowDryRun({ spec })

    expect(plan.phases[0]?.children[0]).toMatchObject({
      modelRole: "verifier",
      model: "openai/gpt-5-mini-verifier",
    })
    expect(plan.phases[1]?.children[0]).toMatchObject({
      modelRole: "synthesizer",
      model: "anthropic/claude-sonnet-4-5",
    })
    expect(plan.phases[2]?.children[0]).toMatchObject({
      modelRole: "worker",
      model: "openai/gpt-5-nano",
    })
  })

  test("rejects routed models outside the provider allowlist", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "model-provider-allowlist",
      name: "Model Provider Allowlist",
      description: "Planner should reject model routes that leave the allowed provider boundary.",
      modelPolicy: {
        defaultModel: "openai/gpt-5-mini",
        strongModel: "anthropic/claude-sonnet-4-5",
        allowedProviders: ["openai"],
        routing: [
          {
            phaseKind: "synthesis",
            use: "synthesizer",
          },
        ],
      },
      phases: [
        {
          id: "report",
          name: "Report",
          kind: "synthesis",
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec })).toThrow(
      /phase report synthesizer model provider anthropic is not in allowedProviders openai/,
    )
  })

  test("requires provider-prefixed models when provider allowlists are declared", () => {
    const spec = parseWorkflowSpecV1({
      schemaVersion: 1,
      id: "model-provider-prefix",
      name: "Model Provider Prefix",
      description: "Planner cannot audit a provider allowlist against provider-less model aliases.",
      modelPolicy: {
        defaultModel: "workflow-default",
        allowedProviders: ["openai"],
      },
      phases: [
        {
          id: "plan",
          name: "Plan",
          kind: "sequential",
        },
      ],
    })

    expect(() => planWorkflowDryRun({ spec })).toThrow(
      /phase plan planner model workflow-default must include a provider prefix/,
    )
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
