import { describe, expect, test } from "vitest"
import {
  createRepairWorkflow,
  beginIteration,
  recordInspection,
  recordCompare,
  evaluateWorkflowCompletion,
  generateRepairSummary,
  currentIteration,
  hasMoreIterations,
} from "../../src/visual/repair"
import type { VisualRun, VisualFinding, VisualTarget } from "../../src/visual/run"
import { compareVisualRuns } from "../../src/visual/compare"

const target: VisualTarget = { type: "url", url: "http://localhost:3000", profile: "isolated" }

function makeRun(overrides: Partial<VisualRun> = {}): VisualRun {
  return {
    id: "run-1",
    sessionID: "ses_test",
    projectID: "proj_test",
    target: { type: "url", url: "http://localhost:3000", profile: "isolated" },
    mode: "browser",
    status: "passed",
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
    artifacts: [],
    findings: [],
    ...overrides,
  }
}

function makeFinding(overrides: Partial<VisualFinding> = {}): VisualFinding {
  return {
    id: "finding_1",
    severity: "warning",
    category: "layout",
    title: "Test finding",
    evidenceArtifactIDs: [],
    status: "open",
    ...overrides,
  }
}

describe("visual.repair", () => {
  test("createRepairWorkflow initializes idle state", () => {
    const wf = createRepairWorkflow({
      sessionID: "ses_test",
      projectID: "proj_test",
      target,
    })

    expect(wf.status).toBe("idle")
    expect(wf.currentIteration).toBe(0)
    expect(wf.maxIterations).toBe(5)
    expect(wf.viewports.length).toBe(3)
    expect(wf.accumulatedFindings.length).toBe(0)
  })

  test("createRepairWorkflow accepts custom viewports", () => {
    const wf = createRepairWorkflow({
      sessionID: "ses_test",
      projectID: "proj_test",
      target,
      viewports: "desktop,mobile",
    })

    expect(wf.viewports.length).toBe(2)
    expect(wf.viewports[0]?.label).toBe("desktop")
    expect(wf.viewports[1]?.label).toBe("mobile")
  })

  test("createRepairWorkflow accepts custom maxIterations", () => {
    const wf = createRepairWorkflow({
      sessionID: "ses_test",
      projectID: "proj_test",
      target,
      maxIterations: 3,
    })

    expect(wf.maxIterations).toBe(3)
  })

  test("beginIteration creates a new iteration", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    wf = beginIteration(wf)
    expect(wf.status).toBe("running")
    expect(wf.currentIteration).toBe(1)
    expect(wf.iterations.length).toBe(1)
    expect(wf.iterations[0]?.status).toBe("pending")
    expect(wf.baselineRunID).toBeDefined()
  })

  test("beginIteration respects maxIterations", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target, maxIterations: 1 })

    wf = beginIteration(wf)
    expect(wf.currentIteration).toBe(1)

    wf = beginIteration(wf)
    expect(wf.status).toBe("max-iterations")
    expect(wf.iterations.length).toBe(1)
  })

  test("recordInspection attaches run to current iteration", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    wf = beginIteration(wf)
    const run = makeRun({ findings: [makeFinding({ title: "Overflow", status: "open" })] })
    wf = recordInspection(wf, run)

    expect(wf.iterations[0]?.status).toBe("inspect")
    expect(wf.iterations[0]?.run?.findings.length).toBe(1)
    expect(wf.iterations[0]?.findingsSnapshot.length).toBe(1)
  })

  test("recordCompare merges findings", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    wf = beginIteration(wf)
    const beforeRun = makeRun({ id: "before", findings: [makeFinding({ title: "Overflow", status: "open" })] })
    wf = recordInspection(wf, beforeRun)

    const afterRun = makeRun({ id: "after", findings: [makeFinding({ title: "Overflow", status: "fixed" })] })
    const compareResult = compareVisualRuns(beforeRun, afterRun)
    wf = recordCompare(wf, compareResult)

    expect(wf.iterations[0]?.status).toBe("compare")
    expect(wf.accumulatedFindings.length).toBe(1)
    expect(wf.accumulatedFindings[0]?.status).toBe("fixed")
  })

  test("evaluateWorkflowCompletion detects resolved state", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    wf = beginIteration(wf)
    const beforeRun = makeRun({ id: "before", findings: [makeFinding({ title: "Issue", status: "open" })] })
    wf = recordInspection(wf, beforeRun)

    const afterRun = makeRun({ id: "after", findings: [] })
    const compareResult = compareVisualRuns(beforeRun, afterRun)
    wf = recordCompare(wf, compareResult)

    wf = evaluateWorkflowCompletion(wf)
    expect(wf.status).toBe("resolved")
  })

  test("evaluateWorkflowCompletion detects max-iterations", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target, maxIterations: 1 })

    wf = beginIteration(wf)
    const run = makeRun({ findings: [makeFinding({ title: "Persistent issue", status: "open" })] })
    wf = recordInspection(wf, run)
    wf = recordCompare(wf, compareVisualRuns(run, run))

    wf = evaluateWorkflowCompletion(wf)
    expect(wf.status).toBe("max-iterations")
  })

  test("evaluateWorkflowCompletion stays idle when never inspected", () => {
    const wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target, maxIterations: 2 })

    expect(hasMoreIterations(wf)).toBe(true)
    expect(evaluateWorkflowCompletion(wf).status).toBe("idle")
  })

  test("keeps running when inspection reports open findings", () => {
    const initial = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target, maxIterations: 2 })

    const inspected = recordInspection(beginIteration(initial), makeRun({ findings: [makeFinding()] }))
    const evaluated = evaluateWorkflowCompletion(inspected)

    expect(evaluated.status).toBe("running")
    expect(evaluated.accumulatedFindings.length).toBe(1)
    expect(hasMoreIterations(evaluated)).toBe(true)
  })

  test("generateRepairSummary produces complete report", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    wf = beginIteration(wf)
    const run = makeRun({
      findings: [
        makeFinding({ title: "Error A", severity: "error", status: "open" }),
        makeFinding({ id: "f2", title: "Warning B", severity: "warning", status: "open" }),
      ],
    })
    wf = recordInspection(wf, run)
    wf = recordCompare(wf, compareVisualRuns(run, run))

    const result = generateRepairSummary(wf)
    expect(result.iterationCount).toBe(1)
    expect(result.risk.level).toBe("medium")
    expect(result.riskText).toContain("MEDIUM")
    expect(result.summary.total).toBe(2)
  })

  test("currentIteration returns last iteration", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    expect(currentIteration(wf)).toBeUndefined()

    wf = beginIteration(wf)
    expect(currentIteration(wf)?.index).toBe(0)

    wf = beginIteration(wf)
    expect(currentIteration(wf)?.index).toBe(1)
  })

  test("hasMoreIterations returns true when not done", () => {
    const wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })
    expect(hasMoreIterations(wf)).toBe(true)
  })

  test("hasMoreIterations returns false when all resolved", () => {
    let wf = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target })

    wf = beginIteration(wf)
    const beforeRun = makeRun({ id: "before", findings: [makeFinding({ title: "Issue", status: "open" })] })
    wf = recordInspection(wf, beforeRun)
    const afterRun = makeRun({ id: "after", findings: [] })
    wf = recordCompare(wf, compareVisualRuns(beforeRun, afterRun))

    expect(hasMoreIterations(wf)).toBe(false)
  })

  test("resolves after inspection only when no findings remain open", () => {
    const initial = createRepairWorkflow({ sessionID: "ses_test", projectID: "proj_test", target, maxIterations: 2 })

    const inspected = recordInspection(beginIteration(initial), makeRun({ findings: [] }))
    const evaluated = evaluateWorkflowCompletion(inspected)

    expect(evaluated.status).toBe("resolved")
    expect(hasMoreIterations(evaluated)).toBe(false)
  })
})
