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
import * as ReplanLLM from "./replan-llm"
import { verify } from "./verification"
import {
  createPhase,
  createPlan,
  defaultOptions,
  type CreatePlanOptions,
  type TaskPhase,
  type TaskPlan,
  type PhaseResult,
  type PlanResult,
  type ExecutionOptions,
} from "./types"

export {
  type TaskPhase,
  type TaskPlan,
  type PhaseResult,
  type PlanResult,
  type ExecutionOptions,
  type Replanner,
  type ReplanInput,
  type CreatePlanOptions,
  type FallbackStrategy,
} from "./types"
export {
  type ReplanGenerator,
  type ReplanContext,
  type ReplanPhase,
  type LlmReplannerWrapOptions,
  type ProviderReplanOptions,
  type Approver,
  type ApprovalInput,
} from "./replan-llm"
export { type DepthLevel } from "../context/analyzer"

export namespace Planner {
  const log = Log.create({ service: "planner" })

  export type ComplexityHint = Complexity.ComplexityHint

  /**
   * Check if a request is complex enough to warrant multi-phase planning.
   *
   * `hint` lets callers (typically the router) supply a pre-computed
   * complexity signal, avoiding a second classification pass.
   */
  export function shouldPlan(request: string, hint?: ComplexityHint): boolean {
    return Complexity.isComplex(request, hint)
  }

  /**
   * Get complexity score (0-100) for a request, optionally biased by an
   * upstream `hint`.
   */
  export function complexityScore(request: string, hint?: ComplexityHint): number {
    return Complexity.score(request, hint)
  }

  /**
   * Estimate minimum phases needed for a request
   */
  export function estimatePhases(request: string): number {
    return Complexity.minPhases(request)
  }

  /**
   * Create a plan from pre-defined phases.
   *
   * `opts.constraints` carries soft requirements (typically from clarification
   * answers — see `Question.toConstraints`) that executors should respect when
   * implementing each phase.
   */
  export function create(
    prompt: string,
    phases: Array<Partial<TaskPhase> & { name: string }>,
    opts: CreatePlanOptions = {},
  ): TaskPlan {
    const built = phases.map((p, i) =>
      createPhase({
        id: p.id ?? `phase-${i + 1}`,
        index: i,
        ...p,
      }),
    )

    const plan = createPlan(prompt, built, opts)
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
            let error = ""
            let succeeded = false
            if (result.status === "fulfilled") {
              results.push(result.value)
              if (result.value.success) {
                plan.phasesCompleted++
                succeeded = true
              } else {
                plan.phasesFailed++
                error = result.value.error ?? "phase reported failure"
              }
            } else {
              plan.phasesFailed++
              error = String(result.reason)
              warnings.push(`Phase "${phase.name}" failed: ${result.reason}`)
            }

            if (succeeded) continue

            // If a previous phase in this batch already aborted the plan,
            // skip the fallback work for the remaining phases — replan in
            // particular calls onReplan (often an LLM round-trip), and
            // there's no point spending tokens on a plan that's stopping.
            if (aborted) continue

            if (phase.fallbackStrategy === "replan") {
              const outcome = await runReplan(plan, phase, executor, options, error, 1, results, warnings)
              if (outcome.aborted) {
                aborted = true
              }
            } else if (phase.fallbackStrategy === "abort") {
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
            if (phase.fallbackStrategy === "replan") {
              const outcome = await runReplan(
                plan,
                phase,
                executor,
                options,
                result.error ?? "phase reported failure",
                1,
                results,
                warnings,
              )
              if (outcome.aborted) {
                aborted = true
                break
              }
            } else if (phase.fallbackStrategy === "abort") {
              warnings.push(`Phase "${phase.name}" failed with abort strategy — stopping plan`)
              aborted = true
              break
            } else if (phase.fallbackStrategy === "skip") {
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

  /**
   * Handle a "replan" fallback for a failed phase.
   *
   * Calls `options.onReplan`. If it returns phases, runs each sequentially
   * with the same executor, applying that phase's own fallback strategy
   * (recursively bounded by `maxReplanDepth`). Returns whether the plan
   * should abort.
   */
  async function runReplan(
    plan: TaskPlan,
    failed: TaskPhase,
    executor: (phase: TaskPhase, plan: TaskPlan) => Promise<PhaseResult>,
    options: ExecutionOptions,
    error: string,
    depth: number,
    results: PhaseResult[],
    warnings: string[],
  ): Promise<{ aborted: boolean }> {
    if (!options.onReplan) {
      warnings.push(`Phase "${failed.name}" used "replan" but no onReplan callback was provided — aborting`)
      return { aborted: true }
    }
    if (depth > options.maxReplanDepth) {
      warnings.push(`Phase "${failed.name}": replan depth ${depth} exceeds maxReplanDepth — aborting`)
      return { aborted: true }
    }

    const replacement = await options.onReplan({ failed, plan, error, depth })
    if (!replacement || replacement.length === 0) {
      warnings.push(`Phase "${failed.name}": replan returned no phases — aborting`)
      return { aborted: true }
    }

    const startIdx = plan.phases.length
    const built = replacement.map((p, i) =>
      createPhase({
        id: p.id ?? `${failed.id}-replan-${depth}-${i + 1}`,
        index: startIdx + i,
        ...p,
      }),
    )
    plan.phases.push(...built)

    for (const next of built) {
      const r = await executePhase(plan, next, executor, options)
      results.push(r)
      if (r.success) {
        plan.phasesCompleted++
        continue
      }
      plan.phasesFailed++
      if (next.fallbackStrategy === "replan") {
        const inner = await runReplan(
          plan,
          next,
          executor,
          options,
          r.error ?? "phase reported failure",
          depth + 1,
          results,
          warnings,
        )
        if (inner.aborted) return { aborted: true }
      } else if (next.fallbackStrategy === "abort") {
        warnings.push(`Replan phase "${next.name}" failed with abort strategy — stopping plan`)
        return { aborted: true }
      } else if (next.fallbackStrategy === "skip") {
        plan.phasesSkipped++
        warnings.push(`Replan phase "${next.name}" failed — skipped`)
      }
    }
    return { aborted: false }
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
      // Capture the timer so it can be cleared once the executor
      // settles. Without this, a successful early resolve leaves the
      // setTimeout pending until it fires (`phaseTimeoutMs`, default
      // 10 minutes) — `Promise.race` does not cancel the loser. In
      // short-lived CLI processes this delays exit by the timeout.
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Phase timed out after ${timeout}ms`)), timeout)
      })
      try {
        return await Promise.race([executor(phase, plan), timeoutPromise])
      } finally {
        if (timer) clearTimeout(timer)
      }
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await run()
        lastResult = { ...result, wasRetry: attempt > 1, retryAttempt: attempt }

        if (result.success) {
          // Optional phase-boundary reviewer (PRD v4.2.0 P1-3). When the
          // critic blocks, demote the result to a failure so the
          // configured fallback strategy (usually `replan`) fires and
          // the planner gets a chance to recover.
          if (options.phaseReviewer) {
            try {
              const review = await options.phaseReviewer(phase, lastResult, plan)
              if (review.block) {
                lastResult = { ...lastResult, success: false, error: review.error ?? "phase blocked by reviewer" }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.warn("phase reviewer threw, ignoring", { phaseId: phase.id, error: msg })
            }
          }
        }

        if (lastResult.success) {
          phase.status = "completed"
          phase.completedAt = Date.now()
          phase.duration = Date.now() - start
          phase.output = lastResult.output
          phase.filesModified = lastResult.filesModified
          phase.tokensUsed = lastResult.tokensUsed

          options.onPhaseComplete?.(phase, lastResult)
          return lastResult
        }
        // Reviewer-blocked or executor-failed: fall through to retry logic.

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

    return (
      lastResult ?? {
        phaseId: phase.id,
        success: false,
        error: phase.error,
        duration: phase.duration,
        tokensUsed: 0,
        filesModified: [],
        wasRetry: false,
        retryAttempt: 0,
      }
    )
  }

  /**
   * Run post-phase verification (TypeScript type checking)
   */
  export async function verifyPhase(phaseId: string, cwd: string) {
    return verify(phaseId, cwd)
  }

  /**
   * Wrap a generator into a `Replanner`. Empty / throwing generators are
   * mapped to null so the executor falls back to abort gracefully.
   */
  export function llmReplanner(generator: ReplanLLM.ReplanGenerator, opts?: ReplanLLM.LlmReplannerWrapOptions) {
    return ReplanLLM.llmReplanner(generator, opts)
  }

  /**
   * Provider-backed `ReplanGenerator`. Use this when you want a turnkey
   * LLM replanner: `Planner.llmReplanner(Planner.providerReplanGenerator())`.
   *
   * By default it uses the architect model from
   * `experimental.planner_architect_model` if configured, otherwise the
   * default executor model. Pass `{ useArchitectModel: false }` to opt out.
   */
  export function providerReplanGenerator(opts?: ReplanLLM.ProviderReplanOptions) {
    return ReplanLLM.providerReplanGenerator(opts)
  }

  /**
   * Resolve the configured architect model, or null if none is set.
   * Useful for callers that build their own plan-generation prompt and
   * want the same architect/editor split as the replanner.
   */
  export async function architectModel() {
    return ReplanLLM.configuredArchitectModel()
  }

  /**
   * Wrap a generator so its output passes through an approver before
   * execution. Approver returning null or [] aborts gracefully; returning
   * a (possibly filtered/edited) array runs those phases.
   */
  export function withApproval(generator: ReplanLLM.ReplanGenerator, approve: ReplanLLM.Approver) {
    return ReplanLLM.withApproval(generator, approve)
  }

  export type ReplanGenerator = ReplanLLM.ReplanGenerator
  export type ReplanContext = ReplanLLM.ReplanContext
  export type ReplanPhase = ReplanLLM.ReplanPhase
  export type Approver = ReplanLLM.Approver
  export type ApprovalInput = ReplanLLM.ApprovalInput
}
