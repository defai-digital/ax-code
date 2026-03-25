/**
 * Token and duration estimator for task plans
 * Ported from ax-cli's token-estimator.ts
 */

import type { TaskPhase, TaskPlan, ExecutionBatch, Complexity } from "./types"

const BASE_TOKENS_PER_PHASE = 2000
const TOKENS_PER_OBJECTIVE = 500
const COORDINATION_OVERHEAD = 200
const PARALLEL_OVERHEAD = 1.1
const TOKENS_PER_SECOND = 50

const TOOL_TOKEN_COSTS: Record<string, number> = {
  read: 200,
  write: 300,
  edit: 400,
  bash: 1000,
  grep: 300,
  glob: 200,
  list: 100,
  webfetch: 500,
  websearch: 400,
  lsp: 300,
  typecheck: 500,
  test: 2000,
  task: 100,
}

const RISK_MULTIPLIER: Record<string, number> = { low: 1.0, medium: 1.1, high: 1.3 }
const COMPLEXITY_MULTIPLIER: Record<Complexity, number> = { simple: 1.0, moderate: 1.5, complex: 2.5 }

const TOOL_DURATION_MS: Record<string, number> = {
  bash: 5000,
  test: 30000,
  typecheck: 10000,
  webfetch: 3000,
  websearch: 2000,
}

/**
 * Estimate tokens for a single phase
 */
export function phase(p: TaskPhase, complexity: Complexity = "moderate"): number {
  let tokens = BASE_TOKENS_PER_PHASE
  tokens += p.objectives.length * TOKENS_PER_OBJECTIVE * COMPLEXITY_MULTIPLIER[complexity]

  for (const tool of p.toolsRequired) {
    tokens += TOOL_TOKEN_COSTS[tool] ?? 300
  }

  tokens *= RISK_MULTIPLIER[p.riskLevel] ?? 1.0

  return Math.round(tokens)
}

/**
 * Estimate total tokens for a plan
 */
export function plan(p: TaskPlan): number {
  let total = 0
  for (const ph of p.phases) {
    total += phase(ph, p.complexity)
  }
  total += p.phases.length * COORDINATION_OVERHEAD
  return Math.round(total)
}

/**
 * Estimate tokens for a batch
 */
export function batch(b: ExecutionBatch, complexity: Complexity = "moderate"): number {
  let total = 0
  for (const p of b.phases) {
    total += phase(p, complexity)
  }
  if (b.canRunInParallel) total *= PARALLEL_OVERHEAD
  return Math.round(total)
}

/**
 * Estimate duration in milliseconds for a phase
 */
export function phaseDuration(p: TaskPhase, complexity: Complexity = "moderate"): number {
  const tokens = phase(p, complexity)
  let ms = (tokens / TOKENS_PER_SECOND) * 1000

  for (const tool of p.toolsRequired) {
    ms += TOOL_DURATION_MS[tool] ?? 1000
  }

  return Math.round(ms)
}

/**
 * Estimate total duration for a plan with batches
 */
export function planDuration(p: TaskPlan, batches: ExecutionBatch[]): number {
  let total = 0
  for (const b of batches) {
    if (b.canRunInParallel) {
      // Parallel: max of all phases
      total += Math.max(...b.phases.map((ph) => phaseDuration(ph, p.complexity)))
    } else {
      // Sequential: sum of all phases
      for (const ph of b.phases) {
        total += phaseDuration(ph, p.complexity)
      }
    }
  }
  return total
}

/**
 * Check if plan fits within context token limit
 */
export function fitsInContext(p: TaskPlan, limit: number): boolean {
  return plan(p) <= limit
}
