/**
 * Planning system for ax-code
 * Ported from ax-cli's planner module
 *
 * Decomposes complex tasks into dependency-ordered phases with:
 * - Automatic complexity detection
 * - Dependency resolution (Kahn's topological sort)
 * - Token/duration estimation
 * - Post-phase verification (TypeScript type checking)
 * - Retry with exponential backoff
 *
 * Usage:
 *   import { Planner } from "./planner"
 *   if (Planner.shouldPlan(request)) {
 *     const plan = Planner.createSimple(request, phases)
 *     const result = await Planner.execute(plan, executor)
 *   }
 */

import { Log } from "../util/log"
import * as Complexity from "./complexity"
import * as Dependency from "./dependency"
import * as Estimator from "./estimator"
import { verify } from "./verification"
import {
  createPhase,
  createPlan,
  defaultOptions,
  type TaskPhase,
  type TaskPlan,
  type PhaseResult,
  type PlanResult,
  type ExecutionOptions,
} from "./types"

export { type TaskPhase, type TaskPlan, type PhaseResult, type PlanResult, type ExecutionOptions } from "./types"
export { type DepthLevel } from "../context/analyzer"

export namespace Planner {
  const log = Log.create({ service: "planner" })

  /**
   * Check if a request is complex enough to warrant multi-phase planning
   */
  export function shouldPlan(request: string): boolean {
    return Complexity.isComplex(request)
  }

  /**
   * Get complexity score (0-100) for a request
   */
  export function complexityScore(request: string): number {
    return Complexity.score(request)
  }

  /**
   * Estimate minimum phases needed for a request
   */
  export function estimatePhases(request: string): number {
    return Complexity.minPhases(request)
  }

  /**
   * Create a plan from pre-defined phases
   */
  export function create(prompt: string, phases: Array<Partial<TaskPhase> & { name: string }>): TaskPlan {
    const built = phases.map((p, i) =>
      createPhase({
        id: p.id ?? `phase-${i + 1}`,
        index: i,
        ...p,
      }),
    )

    const plan = createPlan(prompt, built)
    plan.estimatedTotalTokens = Estimator.plan(plan)

    // Resolve dependencies and estimate duration
    const resolution = Dependency.resolve(built)
    if (resolution.success) {
      plan.estimatedDuration = Estimator.planDuration(plan, resolution.batches)
    }

    return plan
  }

  /**
   * Execute a plan phase by phase
   *
   * @param plan - The plan to execute
   * @param executor - Function that executes a single phase (your agent logic)
   * @param opts - Execution options
   */
  export async function execute(
    plan: TaskPlan,
    executor: (phase: TaskPhase, plan: TaskPlan) => Promise<PhaseResult>,
    opts: Partial<ExecutionOptions> = {},
  ): Promise<PlanResult> {
    const options = { ...defaultOptions(), ...opts }
    const startTime = Date.now()
    const results: PhaseResult[] = []
    const warnings: string[] = []

    // Resolve execution order
    const resolution = Dependency.resolve(plan.phases)
    if (!resolution.success) {
      return {
        planId: plan.id,
        success: false,
        phaseResults: [],
        totalDuration: 0,
        totalTokensUsed: 0,
        summary: `Dependency resolution failed: ${resolution.error}`,
        warnings: [resolution.error ?? "Unknown dependency error"],
      }
    }

    plan.status = "executing"
    log.info("plan execution started", { planId: plan.id, batches: resolution.batches.length })

    let aborted = false
    for (const batch of resolution.batches) {
      if (aborted) break
      if (batch.canRunInParallel && batch.phases.length > 1) {
        // Parallel execution
        for (let i = 0; i < batch.phases.length; i += options.maxParallelPhases) {
          const phases = batch.phases.slice(i, i + options.maxParallelPhases)
          const batchResults = await Promise.allSettled(
            phases.map((phase) => executePhase(plan, phase, executor, options)),
          )

          for (const [idx, result] of batchResults.entries()) {
            const phase = phases[idx]
            if (result.status === "fulfilled") {
              results.push(result.value)
              if (result.value.success) {
                plan.phasesCompleted++
                continue
              }
              plan.phasesFailed++
            } else {
              plan.phasesFailed++
              warnings.push(`Phase "${phase.name}" failed: ${result.reason}`)
            }

            if (phase.fallbackStrategy === "abort") {
              warnings.push(`Phase "${phase.name}" failed with abort strategy — stopping plan`)
              aborted = true
            } else if (phase.fallbackStrategy === "skip") {
              plan.phasesSkipped++
              warnings.push(`Phase "${phase.name}" failed — skipped`)
            }
          }
          if (aborted) break
        }
      } else {
        // Sequential execution
        for (const phase of batch.phases) {
          const result = await executePhase(plan, phase, executor, options)
          results.push(result)

          if (result.success) {
            plan.phasesCompleted++
          } else {
            plan.phasesFailed++

            // Check fallback strategy
            if (phase.fallbackStrategy === "abort") {
              warnings.push(`Phase "${phase.name}" failed with abort strategy — stopping plan`)
              aborted = true
              break
            }
            if (phase.fallbackStrategy === "skip") {
              plan.phasesSkipped++
              warnings.push(`Phase "${phase.name}" failed — skipped`)
            }
          }
        }
      }
    }

    plan.status = plan.phasesFailed > 0 ? "failed" : plan.phasesCompleted === 0 ? "failed" : "completed"
    plan.actualDuration = Date.now() - startTime
    plan.totalTokensUsed = results.reduce((sum, r) => sum + r.tokensUsed, 0)

    const summary = [
      `${plan.phasesCompleted}/${plan.phases.length} phases completed`,
      `Duration: ${Math.round(plan.actualDuration / 1000)}s`,
      `Tokens: ${plan.totalTokensUsed}`,
    ].join(", ")

    log.info("plan execution completed", {
      planId: plan.id,
      success: plan.phasesFailed === 0,
      completed: plan.phasesCompleted,
      failed: plan.phasesFailed,
    })

    return {
      planId: plan.id,
      success: plan.phasesFailed === 0,
      phaseResults: results,
      totalDuration: plan.actualDuration,
      totalTokensUsed: plan.totalTokensUsed,
      summary,
      warnings,
    }
  }

  async function executePhase(
    plan: TaskPlan,
    phase: TaskPhase,
    executor: (phase: TaskPhase, plan: TaskPlan) => Promise<PhaseResult>,
    options: ExecutionOptions,
  ): Promise<PhaseResult> {
    const start = Date.now()
    const timeout = options.phaseTimeoutMs

    log.info("phase started", { phaseId: phase.id, name: phase.name })
    options.onPhaseStart?.(phase)

    phase.status = "executing"
    phase.startedAt = Date.now()

    let lastResult: PhaseResult | undefined
    const maxAttempts = phase.maxRetries + 1
    const run = async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      return Promise.race([
        executor(phase, plan).finally(() => {
          if (timer) clearTimeout(timer)
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Phase timed out after ${timeout}ms`)), timeout)
        }),
      ])
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await run()
        lastResult = { ...result, wasRetry: attempt > 1, retryAttempt: attempt }

        if (result.success) {
          phase.status = "completed"
          phase.completedAt = Date.now()
          phase.duration = Date.now() - start
          phase.output = result.output
          phase.filesModified = result.filesModified
          phase.tokensUsed = result.tokensUsed

          options.onPhaseComplete?.(phase, lastResult)
          return lastResult
        }

        // Failed — check if we should retry
        if (attempt < maxAttempts && phase.fallbackStrategy === "retry") {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
          log.info("phase retry", { phaseId: phase.id, attempt, delay })
          await new Promise((r) => setTimeout(r, delay))
          phase.retryCount++
          continue
        }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        lastResult = {
          phaseId: phase.id,
          success: false,
          error,
          duration: Date.now() - start,
          tokensUsed: 0,
          filesModified: [],
          wasRetry: attempt > 1,
          retryAttempt: attempt,
        }

        if (attempt < maxAttempts && phase.fallbackStrategy === "retry") {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
          await new Promise((r) => setTimeout(r, delay))
          phase.retryCount++
          continue
        }
      }
    }

    // All attempts exhausted
    phase.status = "failed"
    phase.completedAt = Date.now()
    phase.duration = Date.now() - start
    phase.error = lastResult?.error ?? "All retry attempts exhausted"

    options.onPhaseFailed?.(phase, phase.error)

    return lastResult ?? {
      phaseId: phase.id,
      success: false,
      error: phase.error,
      duration: phase.duration,
      tokensUsed: 0,
      filesModified: [],
      wasRetry: false,
      retryAttempt: 0,
    }
  }

  /**
   * Run post-phase verification (TypeScript type checking)
   */
  export async function verifyPhase(phaseId: string, cwd: string) {
    return verify(phaseId, cwd)
  }
}
