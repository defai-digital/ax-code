import { describe, expect, test } from "vitest"
import {
  renderWorkflowDashboardHeader,
  renderWorkflowStatusSidebarLine,
  visibleWorkflowSidebarRuns,
} from "../../../src/cli/cmd/tui/routes/session/workflow-status"
import type { WorkflowDashboardRun, WorkflowDashboardState } from "../../../src/cli/cmd/tui/context/sync-runtime-store"

type WorkflowRunInput = Omit<Partial<WorkflowDashboardRun>, "budgetUsage"> & {
  runID: string
  status: WorkflowDashboardRun["status"]
  budgetUsage?: Partial<WorkflowDashboardRun["budgetUsage"]>
}

describe("tui workflow status sidebar", () => {
  test("shows active workflow runs before recent terminal runs", () => {
    const state = workflowState([
      workflowRun({ runID: "workflow_run_done", status: "completed" }),
      workflowRun({ runID: "workflow_run_blocked", status: "blocked", blockedReason: "approval required" }),
      workflowRun({ runID: "workflow_run_running", status: "running" }),
    ])

    expect(visibleWorkflowSidebarRuns(state).map((run) => run.runID)).toEqual([
      "workflow_run_blocked",
      "workflow_run_running",
    ])
    expect(renderWorkflowDashboardHeader(state)).toBe("Workflows (2 active, 1 blocked)")
  })

  test("renders phase, child, budget, evidence, and blocker state compactly", () => {
    const line = renderWorkflowStatusSidebarLine(
      workflowRun({
        runID: "workflow_run_01",
        status: "blocked",
        name: "Verified Bug Sweep With A Very Long Name",
        currentPhaseName: "Cross Check Candidate Findings",
        blockedReason: "approval required before continuing this workflow",
        childCounts: {
          queued: 2,
          running: 1,
          blockedPermission: 1,
          blockedQuestion: 0,
          paused: 0,
          failed: 0,
          completed: 5,
          cancelled: 0,
        },
        artifactCounts: { summary: 1, finding: 2, patch: 0, verification: 1, metric: 0, log: 0 },
        verificationEnvelopeCount: 1,
        evidenceRefCount: 2,
        effort: "max-workflow",
        models: {
          worker: "cheap-local",
          synthesizer: "strong-cloud",
        },
        budgetUsage: { totalTokens: 2500 },
      }),
    )

    expect(line).toContain("blocked Verified Bug Sweep With...")
    expect(line).toContain("Cross Check Candida...")
    expect(line).toContain("agents 4/9")
    expect(line).toContain("2500/10000 tok")
    expect(line).toContain("effort max-workflow")
    expect(line).toContain("model cheap-local->strong-c...")
    expect(line).toContain("evidence 2")
    expect(line).toContain("approval required before continuing t...")
  })
})

function workflowState(runs: WorkflowDashboardRun[]): WorkflowDashboardState {
  return {
    runs,
    activeCount: runs.filter((run) => ["queued", "running", "blocked", "paused"].includes(run.status)).length,
    blockedCount: runs.filter((run) => run.status === "blocked").length,
    terminalCount: runs.filter((run) => ["completed", "failed", "cancelled"].includes(run.status)).length,
    verificationEnvelopeCount: runs.reduce((sum, run) => sum + run.verificationEnvelopeCount, 0),
    evidenceRefCount: runs.reduce((sum, run) => sum + run.evidenceRefCount, 0),
    exposedArtifactCount: runs.reduce((sum, run) => sum + run.exposedArtifactCount, 0),
  }
}

function workflowRun(input: WorkflowRunInput) {
  return {
    runID: input.runID,
    status: input.status,
    name: input.name ?? input.runID,
    elapsedMs: input.elapsedMs ?? 0,
    effort: input.effort ?? "workflow",
    models: input.models ?? {},
    budgetUsage: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      childAgents: 0,
      retries: 0,
      ...input.budgetUsage,
    },
    budgetLimit: input.budgetLimit ?? {
      maxTotalTokens: 10_000,
      maxInputTokensPerChild: 5_000,
      maxOutputTokensPerChild: 1_000,
      maxWallTimeMs: 600_000,
      maxConcurrentAgents: 3,
      maxTotalAgents: 25,
      maxToolCalls: 100,
      maxRetries: 1,
    },
    phaseCounts: input.phaseCounts ?? {
      queued: 0,
      running: 0,
      blocked: 0,
      paused: 0,
      failed: 0,
      completed: 0,
      cancelled: 0,
    },
    childCounts: input.childCounts ?? {
      queued: 0,
      running: 0,
      blockedPermission: 0,
      blockedQuestion: 0,
      paused: 0,
      failed: 0,
      completed: 0,
      cancelled: 0,
    },
    artifactCounts: input.artifactCounts ?? {
      summary: 0,
      finding: 0,
      patch: 0,
      verification: 0,
      metric: 0,
      log: 0,
    },
    verificationEnvelopeCount: input.verificationEnvelopeCount ?? 0,
    evidenceRefCount: input.evidenceRefCount ?? 0,
    exposedArtifactCount: input.exposedArtifactCount ?? 0,
    evaluation: input.evaluation ?? workflowEvaluation(input),
    blockedReason: input.blockedReason,
    currentPhaseName: input.currentPhaseName,
  } satisfies WorkflowDashboardRun
}

function workflowEvaluation(input: WorkflowRunInput): WorkflowDashboardRun["evaluation"] {
  return {
    runID: input.runID,
    decision: input.status === "completed" ? "promote" : "hold",
    reasons: input.status === "completed" ? [] : [`workflow status is ${input.status}`],
    metrics: {
      status: input.status,
      elapsedMs: input.elapsedMs ?? 0,
      totalTokens: input.budgetUsage?.totalTokens ?? 0,
      inputTokens: input.budgetUsage?.inputTokens ?? 0,
      outputTokens: input.budgetUsage?.outputTokens ?? 0,
      toolCalls: input.budgetUsage?.toolCalls ?? 0,
      childAgents: input.budgetUsage?.childAgents ?? 0,
      retries: input.budgetUsage?.retries ?? 0,
      tokensPerConfirmedFinding: null,
      verifiedCompletionCount: input.status === "completed" ? 1 : 0,
      confirmedFindings: 0,
      likelyFindings: 0,
      rejectedFindings: 0,
      unverifiedFindings: 0,
      falsePositiveFindings: 0,
      artifactCount: 0,
      exposedArtifactCount: 0,
      verificationEnvelopeCount: input.verificationEnvelopeCount ?? 0,
      interventionCount: input.status === "blocked" || input.status === "failed" ? 1 : 0,
    },
    budgetStatus: "ok",
    budgetWarnings: [],
    budgetExceeded: [],
    verificationSatisfied: input.status === "completed",
  }
}
