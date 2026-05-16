/**
 * Planning system types
 * Ported from ax-cli's planner/types.ts
 */

export type RiskLevel = "low" | "medium" | "high"
export type FallbackStrategy = "retry" | "skip" | "abort" | "replan"
export type PhaseStatus =
  | "pending"
  | "approved"
  | "queued"
  | "executing"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
export type PlanStatus = "created" | "approved" | "executing" | "paused" | "completed" | "failed" | "abandoned"
export type Complexity = "simple" | "moderate" | "complex"

export interface TaskPhase {
  id: string
  index: number
  name: string
  description: string
  objectives: string[]
  toolsRequired: string[]
  dependencies: string[]
  canRunInParallel: boolean
  riskLevel: RiskLevel
  requiresApproval: boolean
  fallbackStrategy: FallbackStrategy
  maxRetries: number
  status: PhaseStatus
  startedAt?: number
  completedAt?: number
  duration?: number
  retryCount: number
  output?: string
  error?: string
  tokensUsed?: number
  filesModified?: string[]
}

export interface TaskPlan {
  id: string
  version: number
  originalPrompt: string
  reasoning: string
  complexity: Complexity
  phases: TaskPhase[]
  currentPhaseIndex: number
  status: PlanStatus
  createdAt: number
  updatedAt: number
  estimatedTotalTokens: number
  estimatedDuration: number
  totalTokensUsed: number
  actualDuration: number
  phasesCompleted: number
  phasesFailed: number
  phasesSkipped: number
  /**
   * Soft requirements derived from clarification answers or upstream context.
   * Executors should respect these; nothing in the planner enforces them.
   */
  constraints?: string[]
}

export interface PhaseResult {
  phaseId: string
  success: boolean
  output?: string
  error?: string
  duration: number
  tokensUsed: number
  filesModified: string[]
  wasRetry: boolean
  retryAttempt: number
}

export interface PlanResult {
  planId: string
  success: boolean
  phaseResults: PhaseResult[]
  totalDuration: number
  totalTokensUsed: number
  summary: string
  warnings: string[]
}

export interface ExecutionBatch {
  phases: TaskPhase[]
  canRunInParallel: boolean
  estimatedTokens: number
}

/** Input passed to the replan callback when a phase with `fallbackStrategy: "replan"` fails. */
export interface ReplanInput {
  failed: TaskPhase
  plan: TaskPlan
  error: string
  /** 1-based depth of replan invocations on this branch. Capped by `maxReplanDepth`. */
  depth: number
}

/**
 * Replanner. Returns replacement phases (run sequentially after the failure)
 * or null/empty to fall back to "abort" semantics.
 *
 * The returned partials are converted to full `TaskPhase`s by the planner
 * (auto-assigned ids and indexes) and appended to `plan.phases` so the final
 * `PlanResult` reflects them.
 */
export type Replanner = (input: ReplanInput) => Promise<Array<Partial<TaskPhase> & { name: string }> | null>

/**
 * Reviewer return shape for `phaseReviewer`. Returning `block: true` causes
 * the planner to treat the phase as failed (so its `fallbackStrategy` —
 * usually `replan` or `abort` — fires) even if the executor reported
 * success. The optional `error` text is propagated to the replanner as the
 * failure reason.
 */
export interface PhaseReviewResult {
  block: boolean
  error?: string
}

export interface ExecutionOptions {
  autoApprove: boolean
  autoApproveLowRisk: boolean
  createCheckpoints: boolean
  maxParallelPhases: number
  phaseTimeoutMs: number
  /** Maximum depth for chained replans (a replan phase that itself replans). Default 3. */
  maxReplanDepth: number
  onPhaseStart?: (phase: TaskPhase) => void
  onPhaseComplete?: (phase: TaskPhase, result: PhaseResult) => void
  onPhaseFailed?: (phase: TaskPhase, error: string) => void
  onReplan?: Replanner
  /**
   * Optional phase-boundary reviewer (e.g. the autonomous-mode critic).
   * Runs after a successful executor return. If it returns `block: true`,
   * the phase is marked failed and the configured fallback strategy fires.
   */
  phaseReviewer?: (phase: TaskPhase, result: PhaseResult, plan: TaskPlan) => Promise<PhaseReviewResult>
}

export function createPhase(input: Partial<TaskPhase> & { id: string; index: number; name: string }): TaskPhase {
  return {
    description: "",
    objectives: [],
    toolsRequired: [],
    dependencies: [],
    canRunInParallel: false,
    riskLevel: "low",
    requiresApproval: false,
    fallbackStrategy: "retry",
    maxRetries: 3,
    status: "pending",
    retryCount: 0,
    ...input,
  }
}

export interface CreatePlanOptions {
  constraints?: string[]
}

export function createPlan(prompt: string, phases: TaskPhase[], opts: CreatePlanOptions = {}): TaskPlan {
  const constraints = opts.constraints?.map((c) => c.trim()).filter(Boolean)
  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    version: 1,
    originalPrompt: prompt,
    reasoning: "",
    complexity: phases.length <= 2 ? "simple" : phases.length <= 4 ? "moderate" : "complex",
    phases,
    currentPhaseIndex: -1,
    status: "created",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    estimatedTotalTokens: 0,
    estimatedDuration: 0,
    totalTokensUsed: 0,
    actualDuration: 0,
    phasesCompleted: 0,
    phasesFailed: 0,
    phasesSkipped: 0,
    ...(constraints && constraints.length > 0 ? { constraints } : {}),
  }
}

export function defaultOptions(): ExecutionOptions {
  return {
    autoApprove: false,
    autoApproveLowRisk: true,
    createCheckpoints: false,
    maxParallelPhases: 3,
    phaseTimeoutMs: 10 * 60 * 1000, // 10 minutes
    maxReplanDepth: 3,
  }
}
