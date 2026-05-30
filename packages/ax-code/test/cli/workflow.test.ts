import { describe, expect, test } from "bun:test"
import {
  formatWorkflowArtifactList,
  formatWorkflowEvalCaseList,
  formatWorkflowEvalCaseRunSummary,
  formatWorkflowRunDashboard,
  formatWorkflowRunDetail,
  formatWorkflowRunList,
  formatWorkflowRoutineList,
  formatWorkflowTemplateList,
  parseWorkflowInputArguments,
} from "../../src/cli/cmd/workflow"
import { getWorkflowEvalCase, type WorkflowEvalCaseRunSummary } from "../../src/workflow/eval-corpus"
import { getParsedWorkflowFixtureSpec } from "../../src/workflow/fixtures"
import type { WorkflowRunProjection } from "../../src/workflow/projection"
import type {
  WorkflowArtifactID,
  WorkflowArtifactRecord,
  WorkflowChildID,
  WorkflowPhaseID,
  WorkflowRunDetail,
  WorkflowRunID,
} from "../../src/workflow/state"
import type { WorkflowRun } from "../../src/workflow/run"
import type { WorkflowTemplate } from "../../src/workflow/template"
import type { ProjectID } from "../../src/project/schema"

const spec = getParsedWorkflowFixtureSpec("noopDryRun")
const runID = "workflow_run_01" as WorkflowRunID
const phaseID = "workflow_phase_01" as WorkflowPhaseID
const childID = "workflow_child_01" as WorkflowChildID
const artifactID = "workflow_artifact_01" as WorkflowArtifactID
const projectID = "project_01" as ProjectID

describe("workflow command helpers", () => {
  test("formats template list with tags", () => {
    const output = formatWorkflowTemplateList([
      {
        id: "builtin:noop-dry-run",
        source: "builtin",
        trust: "trusted",
        name: "Noop Dry Run",
        description: "Minimal workflow fixture.",
        tags: ["fixture", "dry-run"],
        revision: 1,
        specHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        spec,
      },
    ] satisfies WorkflowTemplate.Info[])

    expect(output).toContain("builtin:noop-dry-run")
    expect(output).toContain("Noop Dry Run")
    expect(output).toContain("tags: fixture, dry-run")
  })

  test("formats empty run list", () => {
    expect(formatWorkflowRunList([])).toBe("No workflow runs found.\n")
  })

  test("formats run list rows", () => {
    const output = formatWorkflowRunList([
      {
        id: runID,
        projectID,
        directory: "/repo",
        sourceTemplateID: "builtin:noop-dry-run",
        status: "running",
        currentPhaseID: phaseID,
        spec,
        inputValues: {},
        budget: spec.budget,
        budgetUsage: emptyUsage(),
        verificationEnvelopeIDs: [],
        time: { created: 1, updated: 2 },
      },
    ] satisfies WorkflowRun.Info[])

    expect(output).toContain("running")
    expect(output).toContain("workflow_run_01")
    expect(output).toContain("builtin:noop-dry-run")
  })

  test("formats compact dashboard rows", () => {
    const output = formatWorkflowRunDashboard([
      {
        runID,
        status: "blocked",
        name: "Verified Bug Sweep With A Very Long Name",
        sourceTemplateID: "builtin:verified-bug-sweep",
        currentPhaseID: phaseID,
        currentPhaseName: "Cross Check Candidate Findings",
        currentPhaseStatus: "blocked",
        elapsedMs: 2500,
        effort: "workflow",
        models: { worker: "cheap-model", verifier: "strong-model" },
        budgetUsage: { ...emptyUsage(), totalTokens: 2500, childAgents: 4 },
        budgetLimit: {
          maxTotalTokens: 10_000,
          maxInputTokensPerChild: 5_000,
          maxOutputTokensPerChild: 1_000,
          maxWallTimeMs: 600_000,
          maxConcurrentAgents: 3,
          maxTotalAgents: 25,
          maxToolCalls: 100,
          maxRetries: 2,
        },
        phaseCounts: {
          queued: 1,
          running: 0,
          blocked: 1,
          paused: 0,
          failed: 0,
          completed: 1,
          cancelled: 0,
        },
        childCounts: {
          queued: 2,
          running: 1,
          blockedPermission: 1,
          blockedQuestion: 0,
          paused: 0,
          failed: 0,
          completed: 1,
          cancelled: 0,
        },
        artifactCounts: {
          summary: 1,
          finding: 2,
          patch: 0,
          verification: 1,
          metric: 0,
          log: 0,
        },
        verificationEnvelopeCount: 1,
        evidenceRefCount: 3,
        exposedArtifactCount: 2,
        evaluation: workflowProjectionEvaluation({
          decision: "hold",
          metrics: {
            ...workflowProjectionEvaluation().metrics,
            status: "blocked",
            totalTokens: 2500,
            childAgents: 4,
          },
        }),
        blockedReason: "approval required before continuing the workflow",
      },
    ] satisfies WorkflowRunProjection[])

    expect(output).toContain("blocked")
    expect(output).toContain("workflow_run_01")
    expect(output).toContain("Verified Bug Sweep Wi...")
    expect(output).toContain("Cross Check Candida...")
    expect(output).toContain("worker=cheap-model")
    expect(output).toContain("2/2/4")
    expect(output).toContain("2500/10000")
    expect(output).toContain("3/1/4")
    expect(output).toContain("hold/-")
    expect(output).toContain("approval required before continui...")
  })

  test("formats routine list rows", () => {
    const output = formatWorkflowRoutineList([
      {
        route: "workflow/route-noop",
        templateID: "project:route-noop",
        templateName: "Route Noop",
        source: "project",
        trust: "trusted",
        enabled: true,
        mode: "api",
        securityGate: "local-only",
      },
      {
        route: "workflow/candidate",
        templateID: "project:candidate",
        templateName: "Candidate",
        source: "project",
        trust: "candidate",
        enabled: true,
        mode: "api",
        securityGate: "local-only",
      },
      {
        route: "workflow/scheduled",
        templateID: "project:scheduled",
        templateName: "Scheduled",
        source: "project",
        trust: "trusted",
        enabled: true,
        mode: "scheduled",
        schedule: "0 9 * * *",
        timezone: "America/Toronto",
        securityGate: "local-only",
      },
      {
        route: "workflow/webhook",
        templateID: "project:webhook",
        templateName: "Webhook",
        source: "project",
        trust: "candidate",
        enabled: false,
        mode: "webhook",
        webhookEvent: "github.issue.opened",
        securityGate: "required",
      },
    ])

    expect(output).toContain("workflow/route-noop")
    expect(output).toContain("project:route-noop")
    expect(output).toContain("enabled")
    expect(output).toContain("disabled")
    expect(output).toContain("0 9 * * *@America/Toronto")
    expect(output).toContain("github.issue.opened")
  })

  test("formats workflow eval case rows", () => {
    const output = formatWorkflowEvalCaseList([getWorkflowEvalCase("verified-bug-sweep-seeded")])

    expect(output).toContain("verified-bug-sweep-seeded")
    expect(output).toContain("builtin:verified-bug-sweep")
    expect(output).toContain("fixture: verified-bug-sweep-seeded")
    expect(output).toContain("confirmed=1")
    expect(output).toContain("rejected=1")
    expect(output).toContain("baseline: single-agent-seeded-review")
  })

  test("formats workflow eval case run summaries", () => {
    const output = formatWorkflowEvalCaseRunSummary({
      caseID: "verified-bug-sweep-seeded",
      templateID: "builtin:verified-bug-sweep",
      fixtureID: "verified-bug-sweep-seeded",
      decision: "hold",
      reasons: ["expected false-positive rejections are missing: text-content-xss-rejected"],
      missingSeedIDs: ["text-content-xss-rejected"],
      mismatchedSeedIDs: [],
      summary: {
        runID: "wfr_01",
        decision: "hold",
        reasons: ["required verification evidence is missing"],
        metrics: {
          status: "completed",
          elapsedMs: 1000,
          totalTokens: 8000,
          inputTokens: 6000,
          outputTokens: 2000,
          toolCalls: 16,
          childAgents: 6,
          retries: 0,
          estimatedCostUsd: 0.04,
          costPerConfirmedFindingUsd: 0.04,
          verifiedCompletionCount: 0,
          costPerVerifiedCompletionUsd: null,
          confirmedFindings: 1,
          likelyFindings: 1,
          rejectedFindings: 0,
          unverifiedFindings: 1,
          falsePositiveFindings: 0,
          artifactCount: 4,
          exposedArtifactCount: 1,
          verificationEnvelopeCount: 0,
          interventionCount: 0,
        },
        budgetStatus: "ok",
        budgetWarnings: [],
        budgetExceeded: [],
        verificationSatisfied: false,
      },
      metrics: {
        expectedConfirmedFindings: 1,
        expectedLikelyFindings: 1,
        expectedRejectedFindings: 1,
        expectedUnverifiedFindings: 1,
        observedSeedConfirmedFindings: 1,
        observedSeedLikelyFindings: 1,
        observedSeedRejectedFindings: 0,
        observedSeedUnverifiedFindings: 1,
        missingSeedFindings: 1,
        mismatchedSeedFindings: 0,
        duplicateSeedArtifacts: 0,
        unmatchedFindingArtifacts: 0,
        costPerConfirmedFindingUsd: 0.04,
        falsePositiveRejectionRate: 0,
        confirmedFindingRecall: 1,
        completionRate: 1,
        verificationPassRate: 0,
        budgetStopped: false,
        interventionCount: 0,
      },
    } satisfies WorkflowEvalCaseRunSummary)

    expect(output).toContain("decision: hold")
    expect(output).toContain("verification: missing")
    expect(output).toContain("seedFindings: confirmed 1/1, likely 1/1, rejected 0/1, unverified 1/1")
    expect(output).toContain("falsePositiveRejectionRate: 0%")
    expect(output).toContain("confirmedFindingRecall: 100%")
    expect(output).toContain("costPerConfirmedFindingUsd: $0.0400")
    expect(output).toContain("missingSeeds: text-content-xss-rejected")
    expect(output).toContain("expected false-positive rejections are missing")
  })

  test("formats workflow artifacts with optional payload drill-down", () => {
    const artifact = {
      id: artifactID,
      runID,
      phaseID,
      childID,
      specArtifactID: "candidate-findings",
      kind: "finding",
      retention: "session",
      exposeToMainContext: true,
      summary: "confirmed finding",
      payload: { status: "confirmed", file: "src/auth.ts" },
      redaction: { status: "redacted", summary: "paths normalized" },
      evidenceRefs: [{ kind: "verification", id: "ver_01" }],
      time: { created: 1, updated: 2 },
    } satisfies WorkflowArtifactRecord

    const compact = formatWorkflowArtifactList([{ ...artifact, payload: undefined }])
    expect(compact).toContain("workflow_artifact_01 finding")
    expect(compact).toContain("phase=workflow_phase_01")
    expect(compact).toContain("child=workflow_child_01")
    expect(compact).toContain("spec=candidate-findings")
    expect(compact).toContain("redaction=redacted")
    expect(compact).toContain("evidence: verification:ver_01")
    expect(compact).not.toContain("payload:")

    const detailed = formatWorkflowArtifactList([artifact])
    expect(detailed).toContain('payload: {"status":"confirmed","file":"src/auth.ts"}')
  })

  test("formats run detail counts", () => {
    const output = formatWorkflowRunDetail({
      id: runID,
      projectID,
      directory: "/repo",
      sourceTemplateID: "builtin:noop-dry-run",
      status: "running",
      currentPhaseID: phaseID,
      spec: {
        ...spec,
        budget: {
          ...(spec.budget ?? {}),
          maxConcurrentAgents: 3,
          maxTotalAgents: 25,
        },
        modelPolicy: {
          effort: "workflow",
          defaultModel: "default-model",
          cheapModel: "cheap-alias",
          strongModel: "strong-alias",
          workerModel: "cheap-model",
          synthesizerModel: "strong-model",
          allowedProviders: ["anthropic", "openai"],
          routing: [],
        },
        permissions: {
          writePolicy: "read-only",
          allowedTools: [],
          networkPolicy: "disabled",
          escalationPolicy: "ask",
        },
      },
      inputValues: {},
      budget: spec.budget,
      budgetUsage: { ...emptyUsage(), totalTokens: 123, childAgents: 2 },
      verificationEnvelopeIDs: ["ver_01"],
      time: { created: 1, updated: 2 },
      phases: [
        {
          id: phaseID,
          runID,
          specPhaseID: "noop",
          position: 0,
          name: "Noop",
          kind: "noop",
          status: "running",
          outputs: [],
          time: { created: 1, updated: 2 },
        },
      ],
      children: [
        {
          id: childID,
          runID,
          phaseID,
          status: "queued",
          agent: "worker",
          model: "cheap-model",
          artifactIDs: [],
          evidenceRefs: [],
          outputSummary: "queued for inspection",
          time: { created: 1, updated: 2 },
        },
      ],
      artifacts: [
        {
          id: artifactID,
          runID,
          kind: "summary",
          retention: "session",
          exposeToMainContext: true,
          summary: "phase summary",
          evidenceRefs: [],
          time: { created: 1, updated: 2 },
        },
      ],
      budgetLedger: [],
    } satisfies WorkflowRunDetail)

    expect(output).toContain("Run workflow_run_01")
    expect(output).toContain(
      "modelPolicy: effort=workflow, default=default-model, cheap=cheap-alias, strong=strong-alias, worker=cheap-model, synthesizer=strong-model, providers=anthropic|openai",
    )
    expect(output).toContain("executionPolicy: write=read-only, network=disabled, escalation=ask")
    expect(output).toContain("budgetUsage: 123 tokens, 2 child agents")
    expect(output).toContain("phases: running=1")
    expect(output).toContain("children: queued=1")
    expect(output).toContain("artifacts: summary=1")
    expect(output).toContain("verification: ver_01")
    expect(output).toContain("Children")
    expect(output).toContain("agent=worker")
    expect(output).toContain("Artifacts")
    expect(output).toContain("phase summary")
  })

  test("parses workflow start input assignments", () => {
    expect(
      parseWorkflowInputArguments([
        "issue-limit=5",
        "dry-run=true",
        'paths=["src/index.ts","src/workflow.ts"]',
        "label=triage",
        "empty=",
      ]),
    ).toEqual({
      "issue-limit": 5,
      "dry-run": true,
      paths: ["src/index.ts", "src/workflow.ts"],
      label: "triage",
      empty: "",
    })

    expect(parseWorkflowInputArguments(undefined)).toBeUndefined()
    expect(() => parseWorkflowInputArguments(["missing-separator"])).toThrow("key=value")
  })
})

function emptyUsage() {
  return {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
    childAgents: 0,
    retries: 0,
    estimatedCostUsd: 0,
  }
}

function workflowProjectionEvaluation(
  input: Partial<WorkflowRunProjection["evaluation"]> = {},
): WorkflowRunProjection["evaluation"] {
  return {
    runID,
    decision: "hold",
    reasons: ["workflow status is blocked"],
    metrics: {
      status: "blocked",
      elapsedMs: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      childAgents: 0,
      retries: 0,
      estimatedCostUsd: 0,
      costPerConfirmedFindingUsd: null,
      verifiedCompletionCount: 0,
      costPerVerifiedCompletionUsd: null,
      confirmedFindings: 0,
      likelyFindings: 0,
      rejectedFindings: 0,
      unverifiedFindings: 0,
      falsePositiveFindings: 0,
      artifactCount: 0,
      exposedArtifactCount: 0,
      verificationEnvelopeCount: 0,
      interventionCount: 0,
    },
    budgetStatus: "ok",
    budgetWarnings: [],
    budgetExceeded: [],
    verificationSatisfied: false,
    ...input,
  }
}
