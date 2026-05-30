import { describe, expect, test } from "bun:test"
import {
  formatWorkflowRunDashboard,
  formatWorkflowRunDetail,
  formatWorkflowRunList,
  formatWorkflowTemplateList,
} from "../../src/cli/cmd/workflow"
import { getParsedWorkflowFixtureSpec } from "../../src/workflow/fixtures"
import type { WorkflowRunProjection } from "../../src/workflow/projection"
import type {
  WorkflowArtifactID,
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
        exposedArtifactCount: 2,
        blockedReason: "approval required before continuing the workflow",
      },
    ] satisfies WorkflowRunProjection[])

    expect(output).toContain("blocked")
    expect(output).toContain("workflow_run_01")
    expect(output).toContain("Verified Bug Sweep Wi...")
    expect(output).toContain("Cross Check Candida...")
    expect(output).toContain("2/2/4")
    expect(output).toContain("2500/10000")
    expect(output).toContain("approval required before continui...")
  })

  test("formats run detail counts", () => {
    const output = formatWorkflowRunDetail({
      id: runID,
      projectID,
      directory: "/repo",
      sourceTemplateID: "builtin:noop-dry-run",
      status: "running",
      currentPhaseID: phaseID,
      spec,
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
