/**
 * Planning system types
 * Ported from ax-cli's planner/types.ts
 */

export type RiskLevel = "low" | "medium" | "high"
export type FallbackStrategy = "retry" | "skip" | "abort"
export type PhaseStatus = "pending" | "approved" | "queued" | "executing" | "completed" | "failed" | "skipped" | "cancelled"
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

export interface ExecutionOptions {
  autoApprove: boolean
  autoApproveLowRisk: boolean
  createCheckpoints: boolean
  maxParallelPhases: number
  phaseTimeoutMs: number
  onPhaseStart?: (phase: TaskPhase) => void
  onPhaseComplete?: (phase: TaskPhase, result: PhaseResult) => void
  onPhaseFailed?: (phase: TaskPhase, error: string) => void
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

export function createPlan(prompt: string, phases: TaskPhase[]): TaskPlan {
  return {
    id: `plan-${Date.now()}`,
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
  }
}

export function defaultOptions(): ExecutionOptions {
  return {
    autoApprove: false,
    autoApproveLowRisk: true,
    createCheckpoints: false,
    maxParallelPhases: 3,
    phaseTimeoutMs: 10 * 60 * 1000, // 10 minutes
  }
}
