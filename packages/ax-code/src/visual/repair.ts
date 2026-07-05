/**
 * Visual repair workflow orchestrator (ADR-047).
 *
 * Provides a structured repair loop: inspect → critique → patch →
 * re-run → compare. This orchestrator manages state across iterations
 * but delegates actual tool execution to the agent via tool calls.
 *
 * The agent drives the workflow by calling:
 * 1. `visual_inspect` — open URL, capture viewport matrix, collect evidence
 * 2. `visual_critique` — send screenshots to vision model for analysis
 * 3. Agent applies patches via edit/write tools
 * 4. `visual_inspect` again — re-run same target and viewports
 * 5. `visual_compare` — compare before/after runs
 * 6. Repeat until all findings resolved or max iterations reached
 */
import crypto from "crypto"
import type { VisualRun, VisualFinding, ViewportPreset, VisualTarget } from "./run"
import { compareVisualRuns, formatCompareSummary, type CompareResult } from "./compare"
import { mergeFindings, summarizeFindings, allFindingsResolved, type FindingsSummary } from "./findings"
import { computeResidualRisk, formatResidualRisk, type ResidualRiskReport } from "./risk-summary"
import { resolveViewports } from "./viewport"

/**
 * Maximum number of repair iterations before giving up.
 */
const DEFAULT_MAX_ITERATIONS = 5

export type RepairIteration = {
  index: number
  runID: string
  status: "pending" | "inspect" | "critique" | "patch" | "re-inspect" | "compare" | "done"
  run?: VisualRun
  compareResult?: CompareResult
  findingsSnapshot: VisualFinding[]
}

export type RepairWorkflowState = {
  id: string
  sessionID: string
  projectID: string
  target: VisualTarget
  viewports: ViewportPreset[]
  maxIterations: number
  currentIteration: number
  iterations: RepairIteration[]
  accumulatedFindings: VisualFinding[]
  status: "idle" | "running" | "resolved" | "max-iterations" | "error"
  baselineRunID?: string
}

const hasInspectionResult = (state: RepairWorkflowState): boolean => {
  return state.iterations.some((iteration) => iteration.run !== undefined)
}

const hasResolvedFindings = (state: RepairWorkflowState): boolean => {
  return hasInspectionResult(state) && allFindingsResolved(state.accumulatedFindings)
}

const findingKey = (finding: VisualFinding): string => `${finding.title}::${finding.category}`

/**
 * Create a new repair workflow state.
 */
export function createRepairWorkflow(input: {
  sessionID: string
  projectID: string
  target: VisualTarget
  viewports?: string | string[]
  maxIterations?: number
}): RepairWorkflowState {
  const id = `repair_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
  const viewports = resolveViewports(input.viewports)

  return {
    id,
    sessionID: input.sessionID,
    projectID: input.projectID,
    target: input.target,
    viewports,
    maxIterations: input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    currentIteration: 0,
    iterations: [],
    accumulatedFindings: [],
    status: "idle",
  }
}

/**
 * Begin a new iteration in the repair workflow.
 * Returns the iteration with a runID ready for inspection.
 */
export function beginIteration(state: RepairWorkflowState): RepairWorkflowState {
  if (state.currentIteration >= state.maxIterations) {
    return { ...state, status: "max-iterations" }
  }

  const runID = `${state.id}_iter${state.currentIteration}`
  const iteration: RepairIteration = {
    index: state.currentIteration,
    runID,
    status: "pending",
    findingsSnapshot: [],
  }

  return {
    ...state,
    status: "running",
    currentIteration: state.currentIteration + 1,
    iterations: [...state.iterations, iteration],
    baselineRunID: state.baselineRunID ?? runID,
  }
}

/**
 * Record the result of an inspection (visual run) for the current iteration.
 */
export function recordInspection(state: RepairWorkflowState, run: VisualRun): RepairWorkflowState {
  const iterations = state.iterations.map((iter, i) =>
    i === state.iterations.length - 1
      ? { ...iter, run, status: "inspect" as const, findingsSnapshot: [...run.findings] }
      : iter,
  )
  const accumulatedFindings = mergeFindings(state.accumulatedFindings, run.findings)
  return { ...state, iterations, accumulatedFindings }
}

/**
 * Record the compare result after re-inspection.
 */
export function recordCompare(state: RepairWorkflowState, compareResult: CompareResult): RepairWorkflowState {
  const iterations = state.iterations.map((iter, i) =>
    i === state.iterations.length - 1 ? { ...iter, compareResult, status: "compare" as const } : iter,
  )

  const resolvedIDs = new Set(compareResult.delta.resolved.map((finding) => finding.id))
  const resolvedKeys = new Set(compareResult.delta.resolved.map(findingKey))
  const accumulatedFindings = state.accumulatedFindings.map((finding) =>
    resolvedIDs.has(finding.id) || resolvedKeys.has(findingKey(finding))
      ? { ...finding, status: "fixed" as const }
      : finding,
  )

  const accumulatedKeys = new Set(accumulatedFindings.map(findingKey))
  for (const finding of compareResult.delta.introduced) {
    if (!accumulatedKeys.has(findingKey(finding))) {
      accumulatedFindings.push(finding)
      accumulatedKeys.add(findingKey(finding))
    }
  }

  return { ...state, iterations, accumulatedFindings }
}

/**
 * Check if the workflow should continue or has completed.
 */
export function evaluateWorkflowCompletion(state: RepairWorkflowState): RepairWorkflowState {
  if (hasResolvedFindings(state)) {
    return { ...state, status: "resolved" }
  }
  if (state.currentIteration >= state.maxIterations) {
    return { ...state, status: "max-iterations" }
  }
  return state
}

/**
 * Generate the final summary for a completed repair workflow.
 */
export function generateRepairSummary(state: RepairWorkflowState): {
  risk: ResidualRiskReport
  riskText: string
  summary: FindingsSummary
  iterationCount: number
  compareTexts: string[]
} {
  const risk = computeResidualRisk(state.accumulatedFindings)
  const summary = summarizeFindings(state.accumulatedFindings)
  const compareTexts = state.iterations
    .filter((iter) => iter.compareResult)
    .map((iter) => formatCompareSummary(iter.compareResult!))

  return {
    risk,
    riskText: formatResidualRisk(risk),
    summary,
    iterationCount: state.iterations.length,
    compareTexts,
  }
}

/**
 * Get the current iteration (the one being worked on).
 */
export function currentIteration(state: RepairWorkflowState): RepairIteration | undefined {
  return state.iterations[state.iterations.length - 1]
}

/**
 * Check if there are more iterations available.
 */
export function hasMoreIterations(state: RepairWorkflowState): boolean {
  return state.currentIteration < state.maxIterations && !hasResolvedFindings(state)
}
