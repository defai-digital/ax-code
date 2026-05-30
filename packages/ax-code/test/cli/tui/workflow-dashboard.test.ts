import { describe, expect, test } from "bun:test"
import {
  formatWorkflowDuration,
  statusCategory,
  workflowArtifactDetailItems,
  workflowArtifactIDFromDetailValue,
  workflowDashboardItems,
  workflowRunControlItems,
  workflowRunDetailItems,
  type WorkflowDashboardRun,
  type WorkflowRunDetail,
} from "../../../src/cli/cmd/tui/routes/session/workflow-dashboard"
import {
  renderWorkflowDashboardHeader,
  renderWorkflowStatusSidebarLine,
  visibleWorkflowSidebarRuns,
} from "../../../src/cli/cmd/tui/routes/session/workflow-status"

describe("tui workflow dashboard view model", () => {
  test("renders an empty workflow dashboard state", () => {
    const items = workflowDashboardItems([])

    expect(items).toEqual([
      {
        title: "No workflow runs found",
        value: "workflow.empty",
        description: "Workflow runtime is enabled, but this project has no durable workflow runs yet.",
        category: "Overview",
        disabled: true,
      },
    ])
  })

  test("summarizes active workflow runs with child, budget, evidence, and blocker state", () => {
    const items = workflowDashboardItems([
      workflowDashboardRun({
        status: "blocked",
        childCounts: {
          queued: 2,
          running: 1,
          blockedPermission: 1,
          blockedQuestion: 0,
          paused: 0,
          failed: 0,
          completed: 3,
          cancelled: 0,
        },
        blockedReason: "waiting for permission",
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.category).toBe("Needs attention")
    expect(items[0]?.title).toContain("[blocked]")
    expect(items[0]?.description).toContain("children: 2 active, 2 queued, 6 total")
    expect(items[0]?.description).toContain("tokens: 1200/5000")
    expect(items[0]?.footer).toContain("blocker: waiting for permission")
    expect(items[0]?.footer).toContain("2 verification")
    expect(items[0]?.footer).toContain("4 artifacts")
  })

  test("renders workflow detail rows for phases, children, artifacts, and budget evidence", () => {
    const items = workflowRunDetailItems(workflowRunDetail())

    expect(items.find((item) => item.value === "workflow.detail.overview")?.description).toContain("current phase")
    expect(items.find((item) => item.value === "workflow.detail.evidence")?.description).toContain(
      "2 verification envelopes",
    )
    expect(items.some((item) => item.category === "Phases" && item.title.includes("Cross-check"))).toBe(true)
    expect(items.some((item) => item.category === "Children" && item.description?.includes("artifacts: 1"))).toBe(true)
    expect(items.some((item) => item.category === "Artifacts" && item.footer === "final evidence")).toBe(true)
    expect(items.find((item) => item.value === "workflow.detail.artifact.artifact_1")?.disabled).toBeUndefined()
    expect(items.some((item) => item.category === "Budget" && item.description?.includes("3 tool calls"))).toBe(true)
  })

  test("exposes run controls by workflow run status", () => {
    expect(workflowRunControlItems(workflowRunDetail({ status: "running" })).map((item) => item.action)).toEqual([
      "pause",
      "cancel",
    ])
    expect(workflowRunControlItems(workflowRunDetail({ status: "paused" })).map((item) => item.action)).toEqual([
      "resume",
      "cancel",
    ])
    expect(workflowRunControlItems(workflowRunDetail({ status: "failed" })).map((item) => item.action)).toEqual([
      "retry",
    ])
    expect(workflowRunControlItems(workflowRunDetail({ status: "completed" }))).toEqual([])
  })

  test("renders artifact drill-down rows with payload and evidence references", () => {
    const [artifact] = workflowRunDetail().artifacts
    const items = workflowArtifactDetailItems({
      ...artifact!,
      phaseID: "phase_2",
      childID: "child_1",
      payload: { confirmed: 1, rejected: 2 },
      evidenceRefs: [{ kind: "verification", id: "ve_1" }],
      redaction: { status: "redacted", summary: "secret paths removed" },
    })

    expect(workflowArtifactIDFromDetailValue("workflow.detail.artifact.artifact_1")).toBe("artifact_1")
    expect(workflowArtifactIDFromDetailValue("workflow.detail.phase.phase_1")).toBeUndefined()
    expect(items.find((item) => item.value === "workflow.artifact.scope")?.description).toContain("phase: phase_2")
    expect(items.find((item) => item.value === "workflow.artifact.payload")?.description).toContain('"confirmed":1')
    expect(items.some((item) => item.value === "workflow.artifact.evidence.verification.ve_1")).toBe(true)
  })

  test("formats duration and status categories", () => {
    expect(formatWorkflowDuration(999)).toBe("0s")
    expect(formatWorkflowDuration(65_000)).toBe("1m 05s")
    expect(formatWorkflowDuration(3_900_000)).toBe("1h 05m")
    expect(statusCategory("running")).toBe("Active")
    expect(statusCategory("completed")).toBe("Completed")
  })

  test("renders compact sidebar workflow status from dashboard state", () => {
    const state = {
      runs: [
        workflowDashboardRun({ runID: "workflow_run_done", status: "completed", elapsedMs: 1_000 }),
        workflowDashboardRun({
          runID: "workflow_run_blocked",
          status: "blocked",
          blockedReason: "needs permission",
          verificationEnvelopeCount: 1,
        }),
      ],
      activeCount: 1,
      blockedCount: 1,
      terminalCount: 1,
      verificationEnvelopeCount: 1,
      exposedArtifactCount: 0,
    } as Parameters<typeof visibleWorkflowSidebarRuns>[0]

    expect(visibleWorkflowSidebarRuns(state).map((run) => run.runID)).toEqual(["workflow_run_blocked"])
    expect(renderWorkflowDashboardHeader(state)).toBe("Workflows (1 active, 1 blocked, 1 verified)")
    expect(renderWorkflowStatusSidebarLine(state.runs[1]!)).toContain("blocked Verified bug sweep")
    expect(renderWorkflowStatusSidebarLine(state.runs[1]!)).toContain("needs permission")
  })
})

function workflowDashboardRun(input: Partial<WorkflowDashboardRun> = {}): WorkflowDashboardRun {
  return {
    runID: "wfr_1",
    status: "running",
    name: "Verified bug sweep",
    sourceTemplateID: "builtin:verified-bug-sweep",
    currentPhaseID: "phase_2",
    currentPhaseName: "Cross-check findings",
    currentPhaseStatus: "running",
    elapsedMs: 65_000,
    effort: "workflow",
    models: {},
    budgetUsage: {
      totalTokens: 1200,
      inputTokens: 900,
      outputTokens: 300,
      toolCalls: 8,
      childAgents: 6,
      retries: 1,
      estimatedCostUsd: 0,
    },
    budgetLimit: {
      maxTotalTokens: 5000,
      maxWallTimeMs: 600_000,
      maxConcurrentAgents: 3,
      maxTotalAgents: 25,
      maxToolCalls: 120,
      maxRetries: 2,
    },
    phaseCounts: {
      queued: 1,
      running: 1,
      blocked: 0,
      paused: 0,
      failed: 0,
      completed: 2,
      cancelled: 0,
    },
    childCounts: {
      queued: 0,
      running: 1,
      blockedPermission: 0,
      blockedQuestion: 0,
      paused: 0,
      failed: 0,
      completed: 5,
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
    verificationEnvelopeCount: 2,
    exposedArtifactCount: 1,
    ...input,
  }
}

function workflowRunDetail(input: Partial<WorkflowRunDetail> = {}): WorkflowRunDetail {
  return {
    id: "wfr_1",
    projectID: "proj_1",
    directory: "/repo",
    sourceTemplateID: "builtin:verified-bug-sweep",
    status: "completed",
    currentPhaseID: "phase_2",
    spec: {
      schemaVersion: 1,
      id: "verified-bug-sweep",
      name: "Verified bug sweep",
      description: "Find and verify bugs",
      phases: [],
      budget: {
        maxTotalTokens: 5000,
        maxTotalAgents: 25,
        maxToolCalls: 120,
      },
    },
    inputValues: {},
    budget: {
      maxTotalTokens: 5000,
      maxTotalAgents: 25,
      maxToolCalls: 120,
    },
    budgetUsage: {
      totalTokens: 2200,
      childAgents: 4,
      toolCalls: 12,
    },
    verificationEnvelopeIDs: ["ve_1", "ve_2"],
    time: {
      created: 1,
      updated: 2,
      started: 1,
      completed: 2,
    },
    phases: [
      {
        id: "phase_1",
        runID: "wfr_1",
        specPhaseID: "discover",
        position: 0,
        name: "Discover files",
        kind: "fanout",
        status: "completed",
        outputs: [],
        time: { created: 1, updated: 2 },
      },
      {
        id: "phase_2",
        runID: "wfr_1",
        specPhaseID: "cross-check",
        position: 1,
        name: "Cross-check findings",
        kind: "verification",
        status: "completed",
        outputs: [],
        time: { created: 1, updated: 2 },
      },
    ],
    children: [
      {
        id: "child_1",
        runID: "wfr_1",
        phaseID: "phase_2",
        status: "completed",
        agent: "review",
        artifactIDs: ["artifact_1"],
        evidenceRefs: [],
        outputSummary: "confirmed one issue",
        time: { created: 1, updated: 2 },
      },
    ],
    artifacts: [
      {
        id: "artifact_1",
        runID: "wfr_1",
        kind: "summary",
        retention: "session",
        exposeToMainContext: true,
        summary: "final evidence",
        evidenceRefs: [],
        time: { created: 1, updated: 2 },
      },
    ],
    budgetLedger: [
      {
        id: "budget_1",
        runID: "wfr_1",
        kind: "consume",
        usageDelta: {
          totalTokens: 100,
          childAgents: 1,
          toolCalls: 3,
          retries: 0,
        },
        message: "phase accounting",
        time: { created: 1, updated: 2 },
      },
    ],
    ...input,
  } as WorkflowRunDetail
}
