import type { WorkflowBudget, WorkflowPhaseBudget } from "./spec"
import { EmptyWorkflowBudgetUsage, WorkflowUsageDelta, type WorkflowBudgetUsage } from "./state"

export type WorkflowBudgetEvaluation = {
  status: "ok" | "warning" | "exceeded"
  warnings: string[]
  exceeded: string[]
}

export type WorkflowBudgetEvaluationInput = {
  budget: WorkflowBudget
  usage: Partial<WorkflowBudgetUsage>
  elapsedMs?: number
  warningRatio?: number
}

export type WorkflowChildBudgetEvaluationInput = {
  budgetSlice: WorkflowPhaseBudget | undefined
  usage: Partial<WorkflowBudgetUsage>
  elapsedMs?: number
  warningRatio?: number
}

export function normalizeWorkflowBudgetUsage(input: Partial<WorkflowBudgetUsage> = {}): WorkflowBudgetUsage {
  return WorkflowUsageDelta.parse(input)
}

export function addWorkflowBudgetUsage(
  current: Partial<WorkflowBudgetUsage>,
  delta: Partial<WorkflowBudgetUsage>,
): WorkflowBudgetUsage {
  const left = normalizeWorkflowBudgetUsage(current)
  const right = normalizeWorkflowBudgetUsage(delta)
  return {
    totalTokens: left.totalTokens + right.totalTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    toolCalls: left.toolCalls + right.toolCalls,
    childAgents: left.childAgents + right.childAgents,
    retries: left.retries + right.retries,
    estimatedCostUsd: left.estimatedCostUsd + right.estimatedCostUsd,
  }
}

export function evaluateWorkflowBudget(input: WorkflowBudgetEvaluationInput): WorkflowBudgetEvaluation {
  const usage = normalizeWorkflowBudgetUsage(input.usage)
  const warningRatio = input.warningRatio ?? 0.8
  const warnings: string[] = []
  const exceeded: string[] = []

  checkLimit("total tokens", usage.totalTokens, input.budget.maxTotalTokens, warningRatio, warnings, exceeded)
  checkLimit("tool calls", usage.toolCalls, input.budget.maxToolCalls, warningRatio, warnings, exceeded)
  checkLimit("child agents", usage.childAgents, input.budget.maxTotalAgents, warningRatio, warnings, exceeded)
  checkLimit("retries", usage.retries, input.budget.maxRetries, warningRatio, warnings, exceeded)
  if (input.elapsedMs !== undefined) {
    checkLimit("wall time", input.elapsedMs, input.budget.maxWallTimeMs, warningRatio, warnings, exceeded)
  }

  return {
    status: exceeded.length > 0 ? "exceeded" : warnings.length > 0 ? "warning" : "ok",
    warnings,
    exceeded,
  }
}

export function evaluateWorkflowChildBudget(input: WorkflowChildBudgetEvaluationInput): WorkflowBudgetEvaluation {
  const usage = normalizeWorkflowBudgetUsage(input.usage)
  const warningRatio = input.warningRatio ?? 0.8
  const warnings: string[] = []
  const exceeded: string[] = []
  const budgetSlice = input.budgetSlice

  if (budgetSlice?.maxTotalTokens !== undefined) {
    checkLimit("child total tokens", usage.totalTokens, budgetSlice.maxTotalTokens, warningRatio, warnings, exceeded)
  }
  if (budgetSlice?.maxInputTokensPerChild !== undefined) {
    checkLimit(
      "child input tokens",
      usage.inputTokens,
      budgetSlice.maxInputTokensPerChild,
      warningRatio,
      warnings,
      exceeded,
    )
  }
  if (budgetSlice?.maxOutputTokensPerChild !== undefined) {
    checkLimit(
      "child output tokens",
      usage.outputTokens,
      budgetSlice.maxOutputTokensPerChild,
      warningRatio,
      warnings,
      exceeded,
    )
  }
  if (budgetSlice?.maxToolCalls !== undefined) {
    checkLimit("child tool calls", usage.toolCalls, budgetSlice.maxToolCalls, warningRatio, warnings, exceeded)
  }
  if (budgetSlice?.maxWallTimeMs !== undefined && input.elapsedMs !== undefined) {
    checkLimit("child wall time", input.elapsedMs, budgetSlice.maxWallTimeMs, warningRatio, warnings, exceeded)
  }

  return {
    status: exceeded.length > 0 ? "exceeded" : warnings.length > 0 ? "warning" : "ok",
    warnings,
    exceeded,
  }
}

export function assertWorkflowBudgetAvailable(input: WorkflowBudgetEvaluationInput): WorkflowBudgetEvaluation {
  const evaluation = evaluateWorkflowBudget(input)
  if (evaluation.exceeded.length > 0) {
    throw new WorkflowBudgetExceededError(evaluation.exceeded)
  }
  return evaluation
}

export function reserveWorkflowBudget(input: {
  budget: WorkflowBudget
  current?: Partial<WorkflowBudgetUsage>
  reserve: Partial<WorkflowBudgetUsage>
  elapsedMs?: number
}) {
  const current = normalizeWorkflowBudgetUsage(input.current ?? EmptyWorkflowBudgetUsage)
  const usage = addWorkflowBudgetUsage(current, input.reserve)
  const evaluation = assertWorkflowBudgetAvailable({
    budget: input.budget,
    usage,
    elapsedMs: input.elapsedMs,
  })
  return {
    kind: "reserve" as const,
    usageDelta: normalizeWorkflowBudgetUsage(input.reserve),
    nextUsage: usage,
    evaluation,
  }
}

export class WorkflowBudgetExceededError extends Error {
  constructor(readonly exceeded: string[]) {
    super(`Workflow budget exceeded: ${exceeded.join("; ")}`)
    this.name = "WorkflowBudgetExceededError"
  }
}

function checkLimit(
  label: string,
  used: number,
  limit: number,
  warningRatio: number,
  warnings: string[],
  exceeded: string[],
) {
  if (used > limit) {
    exceeded.push(`${label} ${used}/${limit}`)
    return
  }
  if (limit > 0 && used / limit >= warningRatio) {
    warnings.push(`${label} ${used}/${limit}`)
  }
}
