import { describe, expect, test } from "vitest"
import {
  normalizeDebugEngineState,
  normalizeIsolationState,
  normalizeLspStatusState,
  normalizeMcpStatusState,
  normalizeRuntimeFlagState,
  normalizeWorkflowDashboardState,
  type WorkflowDashboardRun,
} from "../../../src/cli/cmd/tui/context/sync-runtime-store"

describe("tui sync runtime store", () => {
  test("normalizes legacy debug-engine payloads with missing optional fields", () => {
    expect(
      normalizeDebugEngineState({
        count: 2,
        plans: [
          {
            planId: "plan_1",
            kind: "refactor",
            risk: "low",
            summary: "small cleanup",
            affectedFileCount: 1,
            affectedSymbolCount: 2,
            timeCreated: 123,
          },
        ],
      }),
    ).toEqual({
      pendingPlans: 2,
      plans: [
        {
          planId: "plan_1",
          kind: "refactor",
          risk: "low",
          summary: "small cleanup",
          affectedFileCount: 1,
          affectedSymbolCount: 2,
          timeCreated: 123,
        },
      ],
      toolCount: 0,
      graph: {
        nodeCount: 0,
        edgeCount: 0,
        lastIndexedAt: null,
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      },
    })
  })

  test("preserves explicit debug-engine graph fields", () => {
    expect(
      normalizeDebugEngineState({
        count: 0,
        plans: [],
        toolCount: 4,
        graph: {
          nodeCount: 10,
          edgeCount: 20,
          lastIndexedAt: 456,
          state: "failed",
          completed: 3,
          total: 7,
          error: "index failed",
        },
      }),
    ).toEqual({
      pendingPlans: 0,
      plans: [],
      toolCount: 4,
      graph: {
        nodeCount: 10,
        edgeCount: 20,
        lastIndexedAt: 456,
        state: "failed",
        completed: 3,
        total: 7,
        error: "index failed",
      },
    })
  })

  test("normalizes invalid debug-engine payload fields to safe defaults", () => {
    expect(
      normalizeDebugEngineState({
        count: -2,
        plans: [{ planId: "bad" }],
        toolCount: -4,
        graph: {
          nodeCount: -10,
          edgeCount: {},
          lastIndexedAt: "456",
          state: "unknown",
          completed: -3,
          total: -7,
          error: 123,
        },
      }),
    ).toEqual({
      pendingPlans: 0,
      plans: [],
      toolCount: 0,
      graph: {
        nodeCount: 0,
        edgeCount: 0,
        lastIndexedAt: null,
        state: "idle",
        completed: 0,
        total: 0,
        error: null,
      },
    })
  })

  test("normalizes runtime boolean flag payloads", () => {
    expect(normalizeRuntimeFlagState({ enabled: true })).toBe(true)
    expect(normalizeRuntimeFlagState({ enabled: false })).toBe(false)
  })

  test("normalizes invalid runtime boolean flag payloads to false", () => {
    expect(normalizeRuntimeFlagState({ enabled: "true" })).toBe(false)
    expect(normalizeRuntimeFlagState(null)).toBe(false)
  })

  test("normalizes isolation payloads without changing allowed fields", () => {
    expect(normalizeIsolationState({ mode: "workspace-write", network: true })).toEqual({
      mode: "workspace-write",
      network: true,
    })
  })

  test("normalizes invalid isolation payloads to safe defaults", () => {
    expect(normalizeIsolationState({ mode: "sudo", network: "true" })).toEqual({
      mode: "workspace-write",
      network: false,
    })
    expect(normalizeIsolationState(null)).toEqual({
      mode: "workspace-write",
      network: false,
    })
  })

  test("normalizes runtime mcp and lsp status payload containers", () => {
    expect(normalizeMcpStatusState({ server: { status: "connected" } })).toEqual({
      server: { status: "connected" },
    })
    expect(normalizeMcpStatusState(null)).toEqual({})
    expect(normalizeMcpStatusState(["server"])).toEqual({})

    expect(normalizeLspStatusState([{ language: "ts" }])).toEqual([{ language: "ts" }])
    expect(normalizeLspStatusState(null)).toEqual([])
    expect(normalizeLspStatusState({ language: "ts" })).toEqual([])
  })

  test("normalizes workflow dashboard projections for supervision state", () => {
    expect(
      normalizeWorkflowDashboardState([
        workflowRun({ runID: "workflow_run_completed", status: "completed", elapsedMs: 1_000 }),
        workflowRun({
          runID: "workflow_run_blocked",
          status: "blocked",
          elapsedMs: 500,
          verificationEnvelopeCount: 1,
          evidenceRefCount: 2,
        }),
        workflowRun({ runID: "workflow_run_running", status: "running", elapsedMs: 2_000, exposedArtifactCount: 2 }),
      ]),
    ).toMatchObject({
      runs: [{ runID: "workflow_run_blocked" }, { runID: "workflow_run_running" }, { runID: "workflow_run_completed" }],
      activeCount: 2,
      blockedCount: 1,
      terminalCount: 1,
      verificationEnvelopeCount: 1,
      evidenceRefCount: 2,
      exposedArtifactCount: 2,
    })
  })

  test("normalizes invalid workflow dashboard payloads to an empty dashboard", () => {
    expect(normalizeWorkflowDashboardState("invalid")).toMatchObject({
      runs: [],
      activeCount: 0,
      blockedCount: 0,
      terminalCount: 0,
    })
    expect(normalizeWorkflowDashboardState({ runs: [{ runID: "bad", status: "running" }] })).toMatchObject({
      runs: [],
      activeCount: 0,
    })
  })
})

function workflowRun(
  input: Partial<WorkflowDashboardRun> & {
    runID: string
    status: WorkflowDashboardRun["status"]
  },
) {
  const { runID, status, ...overrides } = input
  return {
    runID,
    status,
    name: input.name ?? runID,
    elapsedMs: input.elapsedMs ?? 0,
    effort: "workflow",
    models: {},
    budgetUsage: {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      childAgents: 0,
      retries: 0,
    },
    budgetLimit: {
      maxTotalTokens: 10_000,
      maxInputTokensPerChild: 5_000,
      maxOutputTokensPerChild: 1_000,
      maxWallTimeMs: 600_000,
      maxConcurrentAgents: 3,
      maxTotalAgents: 25,
      maxToolCalls: 100,
      maxRetries: 1,
    },
    phaseCounts: { queued: 0, running: 0, blocked: 0, paused: 0, failed: 0, completed: 0, cancelled: 0 },
    childCounts: {
      queued: 0,
      running: 0,
      blockedPermission: 0,
      blockedQuestion: 0,
      paused: 0,
      failed: 0,
      completed: 0,
      cancelled: 0,
    },
    artifactCounts: { summary: 0, finding: 0, patch: 0, verification: 0, metric: 0, log: 0 },
    verificationEnvelopeCount: input.verificationEnvelopeCount ?? 0,
    evidenceRefCount: input.evidenceRefCount ?? 0,
    exposedArtifactCount: input.exposedArtifactCount ?? 0,
    ...overrides,
  } as WorkflowDashboardRun
}
