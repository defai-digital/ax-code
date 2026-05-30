import z from "zod"
import {
  WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS,
  WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS,
  WorkflowSpecV1,
  type WorkflowBudget,
  type WorkflowPhase,
  type WorkflowSpecV1 as WorkflowSpec,
} from "./spec"
import { assertWorkflowBudgetAvailable } from "./budget"

export type WorkflowDryRunPlan = {
  spec: WorkflowSpec
  summary: {
    phaseCount: number
    estimatedChildAgents: number
    maxConcurrentAgents: number
    maxTotalTokens: number
    maxToolCalls: number
    writePolicy: WorkflowSpec["permissions"]["writePolicy"]
    verificationMode: WorkflowSpec["verification"]["mode"]
  }
  phases: WorkflowDryRunPhase[]
  warnings: string[]
}

export type WorkflowDryRunPhase = {
  specPhaseID: string
  name: string
  kind: WorkflowPhase["kind"]
  maxParallel: number
  estimatedChildren: number
  children: WorkflowDryRunChild[]
}

export type WorkflowDryRunChild = {
  index: number
  agent?: string
  prompt?: string
  modelRole: "planner" | "worker" | "verifier" | "synthesizer"
  model?: string
  budgetSlice: {
    maxTotalTokens: number
    maxToolCalls: number
  }
  allowedTools: string[]
  writePolicy: WorkflowSpec["permissions"]["writePolicy"]
  networkPolicy: WorkflowSpec["permissions"]["networkPolicy"]
  durable: boolean
}

export const WorkflowDryRunInput = z.object({
  spec: WorkflowSpecV1,
  allowScaleBeyondDefaults: z.boolean().default(false),
  allowWriteWorkflows: z.boolean().default(false),
  durableChildren: z.boolean().default(true),
})
export type WorkflowDryRunInput = z.input<typeof WorkflowDryRunInput>

export function planWorkflowDryRun(input: WorkflowDryRunInput): WorkflowDryRunPlan {
  const parsed = WorkflowDryRunInput.parse(input)
  assertPlannerSafety(parsed)

  const childCounts = parsed.spec.phases.map((phase) => estimatePhaseChildren(phase, parsed.spec.budget))
  const estimatedChildAgents = childCounts.reduce((total, count) => total + count, 0)
  assertWorkflowBudgetAvailable({
    budget: parsed.spec.budget,
    usage: { childAgents: estimatedChildAgents },
  })

  const tokenSlice = Math.max(1, Math.floor(parsed.spec.budget.maxTotalTokens / Math.max(1, estimatedChildAgents)))
  const toolCallSlice = Math.max(1, Math.floor(parsed.spec.budget.maxToolCalls / Math.max(1, estimatedChildAgents)))
  const warnings: string[] = []
  const phases = parsed.spec.phases.map((phase, phaseIndex): WorkflowDryRunPhase => {
    const estimatedChildren = childCounts[phaseIndex]!
    const maxParallel = effectiveMaxParallel(phase, parsed.spec.budget, estimatedChildren)
    const route = modelRouteForPhase(phase, parsed.spec)
    return {
      specPhaseID: phase.id,
      name: phase.name,
      kind: phase.kind,
      maxParallel,
      estimatedChildren,
      children: Array.from({ length: estimatedChildren }, (_, index) => ({
        index,
        agent: phase.agent,
        prompt: phase.prompt,
        modelRole: route.role,
        model: route.model,
        budgetSlice: {
          maxTotalTokens: tokenSlice,
          maxToolCalls: toolCallSlice,
        },
        allowedTools: parsed.spec.permissions.allowedTools,
        writePolicy: parsed.spec.permissions.writePolicy,
        networkPolicy: parsed.spec.permissions.networkPolicy,
        durable: parsed.durableChildren,
      })),
    }
  })

  if (estimatedChildAgents >= parsed.spec.budget.maxTotalAgents * 0.8) {
    warnings.push(`estimated child agents ${estimatedChildAgents}/${parsed.spec.budget.maxTotalAgents}`)
  }

  return {
    spec: parsed.spec,
    summary: {
      phaseCount: parsed.spec.phases.length,
      estimatedChildAgents,
      maxConcurrentAgents: parsed.spec.budget.maxConcurrentAgents,
      maxTotalTokens: parsed.spec.budget.maxTotalTokens,
      maxToolCalls: parsed.spec.budget.maxToolCalls,
      writePolicy: parsed.spec.permissions.writePolicy,
      verificationMode: parsed.spec.verification.mode,
    },
    phases,
    warnings,
  }
}

export class WorkflowPlanError extends Error {
  constructor(readonly issues: string[]) {
    super(`Workflow plan rejected: ${issues.join("; ")}`)
    this.name = "WorkflowPlanError"
  }
}

function assertPlannerSafety(input: z.infer<typeof WorkflowDryRunInput>) {
  const issues: string[] = []
  if (!input.allowScaleBeyondDefaults) {
    if (input.spec.budget.maxConcurrentAgents > WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS) {
      issues.push(
        `maxConcurrentAgents ${input.spec.budget.maxConcurrentAgents} exceeds safe default ${WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS}`,
      )
    }
    if (input.spec.budget.maxTotalAgents > WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS) {
      issues.push(
        `maxTotalAgents ${input.spec.budget.maxTotalAgents} exceeds safe default ${WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS}`,
      )
    }
  }

  if (!input.allowWriteWorkflows && input.spec.permissions.writePolicy !== "read-only") {
    issues.push(`writePolicy ${input.spec.permissions.writePolicy} requires explicit write workflow approval`)
  }

  if (issues.length > 0) throw new WorkflowPlanError(issues)
}

function estimatePhaseChildren(phase: WorkflowPhase, budget: WorkflowBudget) {
  if (phase.kind === "fanout")
    return Math.max(1, phase.inputs.length || phase.maxParallel || budget.maxConcurrentAgents)
  if (phase.kind === "verification" && phase.maxParallel) return Math.max(1, phase.inputs.length || phase.maxParallel)
  return 1
}

function effectiveMaxParallel(phase: WorkflowPhase, budget: WorkflowBudget, estimatedChildren: number) {
  if (phase.kind !== "fanout" && phase.kind !== "verification") return 1
  return Math.min(phase.maxParallel ?? budget.maxConcurrentAgents, budget.maxConcurrentAgents, estimatedChildren)
}

function modelRouteForPhase(phase: WorkflowPhase, spec: WorkflowSpec) {
  const policy = { ...spec.modelPolicy, ...phase.modelPolicy }
  const role: WorkflowDryRunChild["modelRole"] =
    phase.kind === "fanout"
      ? "worker"
      : phase.kind === "verification"
        ? "verifier"
        : phase.kind === "synthesis"
          ? "synthesizer"
          : "planner"
  const key = `${role}Model` as const
  return {
    role,
    model: typeof policy[key] === "string" ? policy[key] : undefined,
  }
}
