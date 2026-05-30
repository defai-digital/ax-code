import z from "zod"
import {
  WORKFLOW_DEFAULT_MAX_CONCURRENT_AGENTS,
  WORKFLOW_DEFAULT_MAX_INPUT_TOKENS_PER_CHILD,
  WORKFLOW_DEFAULT_MAX_OUTPUT_TOKENS_PER_CHILD,
  WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE,
  WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE,
  WORKFLOW_DEFAULT_MAX_TOTAL_AGENTS,
  WorkflowSpecV1,
  type WorkflowBudget,
  type WorkflowPacing,
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
    maxInputTokensPerChild: number
    maxOutputTokensPerChild: number
    maxToolCalls: number
    maxRequestsPerMinute: number
    maxTokensPerMinute: number
    writePolicy: WorkflowSpec["permissions"]["writePolicy"]
    escalationPolicy: WorkflowSpec["permissions"]["escalationPolicy"]
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
  pacing: WorkflowPacing
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
    maxInputTokensPerChild: number
    maxOutputTokensPerChild: number
    maxToolCalls: number
  }
  pacing: WorkflowPacing
  allowedTools: string[]
  writePolicy: WorkflowSpec["permissions"]["writePolicy"]
  networkPolicy: WorkflowSpec["permissions"]["networkPolicy"]
  escalationPolicy: WorkflowSpec["permissions"]["escalationPolicy"]
  artifactRefs: string[]
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
  assertPacingSafety(parsed, childCounts, tokenSlice)
  const warnings: string[] = []
  const phases = parsed.spec.phases.map((phase, phaseIndex): WorkflowDryRunPhase => {
    const estimatedChildren = childCounts[phaseIndex]!
    const maxParallel = effectiveMaxParallel(phase, parsed.spec, estimatedChildren)
    const pacing = effectivePacing(phase, parsed.spec)
    const route = modelRouteForPhase(phase, parsed.spec)
    return {
      specPhaseID: phase.id,
      name: phase.name,
      kind: phase.kind,
      maxParallel,
      pacing,
      estimatedChildren,
      children: Array.from({ length: estimatedChildren }, (_, index) => ({
        index,
        agent: phase.agent,
        prompt: phase.prompt,
        modelRole: route.role,
        model: route.model,
        budgetSlice: {
          maxTotalTokens: tokenSlice,
          maxInputTokensPerChild: effectiveChildInputTokenLimit(phase, parsed.spec.budget),
          maxOutputTokensPerChild: effectiveChildOutputTokenLimit(phase, parsed.spec.budget),
          maxToolCalls: toolCallSlice,
        },
        pacing,
        allowedTools: parsed.spec.permissions.allowedTools,
        writePolicy: parsed.spec.permissions.writePolicy,
        networkPolicy: parsed.spec.permissions.networkPolicy,
        escalationPolicy: parsed.spec.permissions.escalationPolicy,
        artifactRefs: phase.outputs,
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
      maxInputTokensPerChild: parsed.spec.budget.maxInputTokensPerChild,
      maxOutputTokensPerChild: parsed.spec.budget.maxOutputTokensPerChild,
      maxToolCalls: parsed.spec.budget.maxToolCalls,
      maxRequestsPerMinute: parsed.spec.pacing.maxRequestsPerMinute,
      maxTokensPerMinute: parsed.spec.pacing.maxTokensPerMinute,
      writePolicy: parsed.spec.permissions.writePolicy,
      escalationPolicy: parsed.spec.permissions.escalationPolicy,
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
    if (input.spec.budget.maxInputTokensPerChild > WORKFLOW_DEFAULT_MAX_INPUT_TOKENS_PER_CHILD) {
      issues.push(
        `maxInputTokensPerChild ${input.spec.budget.maxInputTokensPerChild} exceeds safe default ${WORKFLOW_DEFAULT_MAX_INPUT_TOKENS_PER_CHILD}`,
      )
    }
    if (input.spec.budget.maxOutputTokensPerChild > WORKFLOW_DEFAULT_MAX_OUTPUT_TOKENS_PER_CHILD) {
      issues.push(
        `maxOutputTokensPerChild ${input.spec.budget.maxOutputTokensPerChild} exceeds safe default ${WORKFLOW_DEFAULT_MAX_OUTPUT_TOKENS_PER_CHILD}`,
      )
    }
    if (input.spec.pacing.maxRequestsPerMinute > WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE) {
      issues.push(
        `maxRequestsPerMinute ${input.spec.pacing.maxRequestsPerMinute} exceeds safe default ${WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE}`,
      )
    }
    if (input.spec.pacing.maxTokensPerMinute > WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE) {
      issues.push(
        `maxTokensPerMinute ${input.spec.pacing.maxTokensPerMinute} exceeds safe default ${WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE}`,
      )
    }
    for (const phase of input.spec.phases) {
      if (
        phase.pacing?.maxRequestsPerMinute !== undefined &&
        phase.pacing.maxRequestsPerMinute > WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE
      ) {
        issues.push(
          `phase ${phase.id} maxRequestsPerMinute ${phase.pacing.maxRequestsPerMinute} exceeds safe default ${WORKFLOW_DEFAULT_MAX_REQUESTS_PER_MINUTE}`,
        )
      }
      if (
        phase.pacing?.maxTokensPerMinute !== undefined &&
        phase.pacing.maxTokensPerMinute > WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE
      ) {
        issues.push(
          `phase ${phase.id} maxTokensPerMinute ${phase.pacing.maxTokensPerMinute} exceeds safe default ${WORKFLOW_DEFAULT_MAX_TOKENS_PER_MINUTE}`,
        )
      }
    }
  }

  if (!input.allowWriteWorkflows && input.spec.permissions.writePolicy !== "read-only") {
    issues.push(`writePolicy ${input.spec.permissions.writePolicy} requires explicit write workflow approval`)
  }
  if (input.spec.permissions.writePolicy === "worktree-required") {
    issues.push("writePolicy worktree-required requires workflow child worktree isolation before execution")
  }

  if (issues.length > 0) throw new WorkflowPlanError(issues)
}

function assertPacingSafety(input: z.infer<typeof WorkflowDryRunInput>, childCounts: number[], tokenSlice: number) {
  const issues: string[] = []
  for (const [index, phase] of input.spec.phases.entries()) {
    const estimatedChildren = childCounts[index] ?? 1
    const maxParallel = effectiveMaxParallel(phase, input.spec, estimatedChildren)
    const pacing = effectivePacing(phase, input.spec)
    if (maxParallel > pacing.maxRequestsPerMinute) {
      issues.push(
        `phase ${phase.id} request burst ${maxParallel}/${pacing.maxRequestsPerMinute} exceeds maxRequestsPerMinute`,
      )
    }
    const tokenBurst = maxParallel * tokenSlice
    if (tokenBurst > pacing.maxTokensPerMinute) {
      issues.push(`phase ${phase.id} token burst ${tokenBurst}/${pacing.maxTokensPerMinute} exceeds maxTokensPerMinute`)
    }
  }
  if (issues.length > 0) throw new WorkflowPlanError(issues)
}

function estimatePhaseChildren(phase: WorkflowPhase, budget: WorkflowBudget) {
  if (phase.kind === "fanout")
    return Math.max(1, phase.inputs.length || phase.maxParallel || budget.maxConcurrentAgents)
  if (phase.kind === "verification" && phase.maxParallel) return Math.max(1, phase.inputs.length || phase.maxParallel)
  return 1
}

function effectiveMaxParallel(phase: WorkflowPhase, spec: WorkflowSpec, estimatedChildren: number) {
  if (phase.kind !== "fanout" && phase.kind !== "verification") return 1
  if (spec.permissions.writePolicy === "serialized") return 1
  return Math.min(
    phase.maxParallel ?? spec.budget.maxConcurrentAgents,
    spec.budget.maxConcurrentAgents,
    estimatedChildren,
  )
}

function effectivePacing(phase: WorkflowPhase, spec: WorkflowSpec): WorkflowPacing {
  return {
    ...spec.pacing,
    ...phase.pacing,
  }
}

function effectiveChildInputTokenLimit(phase: WorkflowPhase, budget: WorkflowBudget) {
  return phase.budget?.maxInputTokensPerChild ?? budget.maxInputTokensPerChild
}

function effectiveChildOutputTokenLimit(phase: WorkflowPhase, budget: WorkflowBudget) {
  return phase.budget?.maxOutputTokensPerChild ?? budget.maxOutputTokensPerChild
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
    model: roleModel(policy, key, role),
  }
}

function roleModel(
  policy: WorkflowSpec["modelPolicy"],
  key: "plannerModel" | "workerModel" | "verifierModel" | "synthesizerModel",
  role: WorkflowDryRunChild["modelRole"],
) {
  const explicit = policy[key]
  if (typeof explicit === "string") return explicit
  if ((role === "worker" || role === "verifier") && typeof policy.cheapModel === "string") return policy.cheapModel
  if (role === "synthesizer" && typeof policy.strongModel === "string") return policy.strongModel
  return typeof policy.defaultModel === "string" ? policy.defaultModel : undefined
}
