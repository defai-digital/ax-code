import {
  dispatch,
  type DispatchExecutor,
  type DispatchResult,
  type DispatchSpec,
  type MergeStrategy,
} from "../dispatch"
import { workflowArtifactRedactionFromSpec } from "./artifact"
import type { WorkflowDryRunPhase } from "./planner"
import { WorkflowRun } from "./run"
import type { WorkflowPhase, WorkflowSpecV1 } from "./spec"
import type { WorkflowPhaseRecord, WorkflowRunID } from "./state"

export namespace WorkflowDispatchAdapter {
  export type ExecutePhaseInput = {
    runID: WorkflowRunID
    spec: WorkflowSpecV1
    phase: WorkflowPhaseRecord
    phaseSpec: WorkflowPhase
    phasePlan: WorkflowDryRunPhase
    executor: DispatchExecutor
    signal?: AbortSignal
  }

  export type ExecutePhaseResult = {
    phase: WorkflowPhaseRecord
    results: DispatchResult[]
  }

  export async function executePhase(input: ExecutePhaseInput): Promise<ExecutePhaseResult> {
    assertReadOnly(input.spec)

    const children: Awaited<ReturnType<typeof WorkflowRun.appendChild>>[] = []
    for (const childPlan of input.phasePlan.children) {
      const child = await WorkflowRun.appendChild({
        runID: input.runID,
        phaseID: input.phase.id,
        agent: childPlan.agent,
        model: childPlan.model,
        budgetSlice: childPlan.budgetSlice,
      })
      children.push(child)
      await WorkflowRun.appendBudgetUsage({
        runID: input.runID,
        phaseID: input.phase.id,
        childID: child.id,
        kind: "reserve",
        usageDelta: { childAgents: 1 },
      })
    }

    const specs: DispatchSpec[] = input.phasePlan.children.map((childPlan) => ({
      agent: childPlan.agent ?? childPlan.modelRole,
      prompt: childPlan.prompt ?? input.phaseSpec.prompt ?? input.phaseSpec.name,
    }))
    const childBySpec = new Map(specs.map((spec, index) => [spec, children[index]] as const))

    const results = await dispatch(
      specs,
      async (spec, signal) => {
        const child = childBySpec.get(spec)
        if (child) await WorkflowRun.setChildStatus({ id: child.id, status: "running" })
        return input.executor(spec, signal)
      },
      {
        maxParallel: input.phasePlan.maxParallel,
        mergeStrategy: dispatchMergeStrategy(input.phaseSpec.mergeStrategy),
        signal: input.signal,
      },
    )

    for (const [index, result] of results.entries()) {
      const child = children[index]
      if (!child) continue

      const artifact = await WorkflowRun.appendArtifact({
        runID: input.runID,
        phaseID: input.phase.id,
        childID: child.id,
        kind: "log",
        retention: "session",
        summary: summarizeChildResult(result),
        payload: {
          agent: result.agent,
          status: result.status,
          output: result.output,
          error: result.error,
          durationMs: result.durationMs,
          filesModified: result.filesModified,
          filesProposed: result.filesProposed,
          tokensUsed: result.tokensUsed,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      })
      await WorkflowRun.appendBudgetUsage({
        runID: input.runID,
        phaseID: input.phase.id,
        childID: child.id,
        kind: "consume",
        usageDelta: {
          totalTokens: result.tokensUsed,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        },
      })
      const budgetChecked = await WorkflowRun.getDetail(input.runID)
      if (budgetChecked.status === "failed") {
        const failedPhase = budgetChecked.phases.find((candidate) => candidate.id === input.phase.id) ?? input.phase
        return { phase: failedPhase, results }
      }
      await WorkflowRun.setChildStatus({
        id: child.id,
        status: childStatus(result),
        outputSummary: summarizeDispatchChildOutput(result),
        artifactIDs: [artifact.id],
        evidenceRefs: [{ kind: "artifact", id: artifact.id }],
        error: result.error,
      })
    }

    await WorkflowRun.appendArtifact({
      runID: input.runID,
      phaseID: input.phase.id,
      specArtifactID: input.phaseSpec.outputs[0],
      kind: phaseOutputArtifactKind(input.spec, input.phaseSpec.outputs[0]),
      retention: "session",
      exposeToMainContext: exposesPhaseSummary(input.spec, input.phaseSpec),
      summary: summarizePhase(input.phaseSpec, results),
      redaction: workflowArtifactRedactionFromSpec(input.spec, input.phaseSpec.outputs[0]),
      payload: {
        mergeStrategy: input.phaseSpec.mergeStrategy,
        counts: resultCounts(results),
        childResultArtifactPolicy: "raw output stored on child log artifacts",
      },
    })

    const phaseStatus = phaseStatusFromResults(input.phaseSpec.mergeStrategy, results)
    const phase = await WorkflowRun.setPhaseStatus({
      id: input.phase.id,
      status: phaseStatus,
      error: phaseStatus === "failed" ? failedSummary(results) : undefined,
    })

    return { phase, results }
  }
}

export class WorkflowDispatchWritePolicyError extends Error {
  constructor(writePolicy: string) {
    super(`Workflow dispatch adapter only supports read-only workflows; got writePolicy ${writePolicy}.`)
    this.name = "WorkflowDispatchWritePolicyError"
  }
}

export class WorkflowDispatchExecutorMissingError extends Error {
  constructor() {
    super("Workflow direct dispatch requires an injected DispatchExecutor.")
    this.name = "WorkflowDispatchExecutorMissingError"
  }
}

export class WorkflowDispatchUnsupportedMergeStrategyError extends Error {
  constructor(strategy: string) {
    super(`Workflow direct dispatch does not support mergeStrategy ${strategy}.`)
    this.name = "WorkflowDispatchUnsupportedMergeStrategyError"
  }
}

function assertReadOnly(spec: WorkflowSpecV1) {
  if (spec.permissions.writePolicy === "read-only") return
  throw new WorkflowDispatchWritePolicyError(spec.permissions.writePolicy)
}

function dispatchMergeStrategy(strategy: WorkflowPhase["mergeStrategy"]): MergeStrategy {
  if (strategy === "first-success" || strategy === "majority") return strategy
  if (isCriticMergeStrategy(strategy)) return "all"
  if (strategy === "custom-reducer") throw new WorkflowDispatchUnsupportedMergeStrategyError(strategy)
  return "all"
}

function childStatus(result: DispatchResult): WorkflowRun.ChildStatus {
  if (result.status === "completed") return "completed"
  if (result.status === "cancelled") return "cancelled"
  return "failed"
}

function phaseStatusFromResults(
  strategy: WorkflowPhase["mergeStrategy"],
  results: DispatchResult[],
): WorkflowRun.PhaseStatus {
  if (results.length === 0) return "completed"
  if (isCriticMergeStrategy(strategy)) return criticPhaseStatusFromResults(results)
  const completed = results.filter((result) => result.status === "completed").length
  if (strategy === "first-success" && completed > 0) return "completed"
  if (strategy === "majority" && completed > results.length / 2) return "completed"
  if (results.every((result) => result.status === "completed")) return "completed"
  if (results.every((result) => result.status === "cancelled")) return "cancelled"
  return "failed"
}

function criticPhaseStatusFromResults(results: DispatchResult[]): WorkflowRun.PhaseStatus {
  if (results.every((result) => result.status === "cancelled")) return "cancelled"
  const completed = results.filter((result) => result.status === "completed").length
  const critic = results.at(-1)
  if (critic?.status === "completed" && completed > results.length / 2) return "completed"
  return "failed"
}

function isCriticMergeStrategy(strategy: WorkflowPhase["mergeStrategy"]) {
  return strategy === "vote-with-critic" || strategy === "critic-confirmation"
}

function exposesPhaseSummary(spec: WorkflowSpecV1, phase: WorkflowPhase) {
  const exposed = new Set(
    spec.artifacts.filter((artifact) => artifact.exposeToMainContext).map((artifact) => artifact.id),
  )
  return phase.outputs.some((output) => exposed.has(output))
}

function phaseOutputArtifactKind(spec: WorkflowSpecV1, specArtifactID: string | undefined): WorkflowRun.ArtifactKind {
  if (!specArtifactID) return "summary"
  return spec.artifacts.find((artifact) => artifact.id === specArtifactID)?.kind ?? "summary"
}

function summarizeChildResult(result: DispatchResult) {
  const base = `${result.agent}: ${result.status}`
  const files = summarizeDispatchFiles(result)
  if (result.status === "completed") {
    return [base, `tokens=${result.tokensUsed}`, `durationMs=${result.durationMs}`, files].filter(Boolean).join("; ")
  }
  return `${base}; error=${result.error ?? "unknown"}`
}

const maxChildSummaryLength = 240

function summarizeDispatchChildOutput(result: DispatchResult) {
  const files = summarizeDispatchFiles(result)
  if (!files) return summarizeOutput(result.output)
  if (!result.output) return files

  const outputBudget = Math.max(40, maxChildSummaryLength - files.length - 2)
  return `${summarizeOutput(result.output, outputBudget)}; ${files}`
}

function summarizeDispatchFiles(result: DispatchResult) {
  return [
    summarizeFileList("files", result.filesModified),
    summarizeFileList("proposed", result.filesProposed),
  ]
    .filter(Boolean)
    .join("; ")
}

function summarizeFileList(label: string, files: readonly string[] | undefined) {
  if (!files || files.length === 0) return undefined
  const shown = files.slice(0, 3).map((file) => summarizePath(file)).join(", ")
  const suffix = files.length > 3 ? `, +${files.length - 3} more` : ""
  return `${label}=${files.length} (${shown}${suffix})`
}

function summarizePath(path: string) {
  if (path.length <= 80) return path
  return `...${path.slice(-77)}`
}

function summarizeOutput(output: string | undefined, maxLength = maxChildSummaryLength) {
  if (!output) return undefined
  return output.length > maxLength ? `${output.slice(0, maxLength - 3)}...` : output
}

function summarizePhase(phase: WorkflowPhase, results: DispatchResult[]) {
  const counts = resultCounts(results)
  return `${phase.name}: ${counts.completed} completed, ${counts.failed} failed, ${counts.timeout} timed out, ${counts.cancelled} cancelled.`
}

function resultCounts(results: DispatchResult[]) {
  return {
    completed: results.filter((result) => result.status === "completed").length,
    failed: results.filter((result) => result.status === "failed").length,
    timeout: results.filter((result) => result.status === "timeout").length,
    cancelled: results.filter((result) => result.status === "cancelled").length,
  }
}

function failedSummary(results: DispatchResult[]) {
  const failed = results.find((result) => result.status === "failed" || result.status === "timeout")
  return (
    failed?.error ??
    `Workflow phase did not satisfy merge strategy; ${resultCounts(results).completed} children completed.`
  )
}
