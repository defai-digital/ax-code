/**
 * Self-correction engine for ax-code
 * Ported from ax-cli's self-correction system
 *
 * Detects tool execution failures, generates reflection prompts,
 * and manages retry budgets to help the agent recover automatically.
 *
 * Integration: Called from session/processor.ts on tool errors.
 * The reflection prompt is injected as a synthetic message before
 * the next LLM turn, guiding the model to fix its approach.
 */

import { detect, type FailureSignal } from "./detector"
import { build, quick } from "./reflection"
import { Log } from "../../util/log"

export { type FailureSignal } from "./detector"

export namespace SelfCorrection {
  const log = Log.create({ service: "self-correction" })

  interface Budget {
    remaining: number
    max: number
    failures: FailureSignal[]
  }

  // Budget tracking per failure signature (tool + error pattern)
  const budgets = new Map<string, Budget>()

  function key(tool: string, error: string): string {
    // Normalize error to group similar failures
    const normalized = error.replace(/[0-9]+/g, "N").replace(/\/[^\s]+/g, "/PATH").slice(0, 100)
    return `${tool}:${normalized}`
  }

  /**
   * Analyze a tool error and determine if self-correction should be attempted
   * Returns a reflection prompt to inject, or null if no correction is possible
   */
  export function analyze(
    toolName: string,
    error: string,
  ): { signal: FailureSignal; prompt: string } | null {
    const k = key(toolName, error)
    const budget = budgets.get(k) ?? { remaining: -1, max: 0, failures: [] }

    // Detect failure type and get recovery strategy
    const attempt = budget.failures.length + 1
    const signal = detect(toolName, error, attempt)

    // Initialize budget on first failure
    if (budget.remaining === -1) {
      budget.max = signal.maxRetries
      budget.remaining = signal.maxRetries
    }

    // Record this failure
    budget.failures.push(signal)
    budgets.set(k, budget)

    // Check if we should attempt correction
    if (!signal.recoverable) {
      log.info("failure not recoverable", { tool: toolName, strategy: signal.strategy, attempt })
      return null
    }

    if (budget.remaining <= 0) {
      log.info("retry budget exhausted", { tool: toolName, attempt, max: budget.max })
      return null
    }

    // Consume budget
    budget.remaining--

    log.info("self-correction triggered", {
      tool: toolName,
      strategy: signal.strategy,
      attempt,
      remaining: budget.remaining,
    })

    // Generate reflection prompt
    const prompt = attempt <= 2 ? quick(signal) : build(signal)

    return { signal, prompt }
  }

  /**
   * Record a successful tool execution to reset the budget for that tool
   * Called when a tool succeeds after previous failures
   */
  export function recordSuccess(toolName: string) {
    // Clear all budgets for this tool (success means the issue is resolved)
    for (const [k] of budgets) {
      if (k.startsWith(`${toolName}:`)) {
        budgets.delete(k)
      }
    }
  }

  /**
   * Reset all correction state (e.g., at session start)
   */
  export function reset() {
    budgets.clear()
  }

  /**
   * Get correction statistics
   */
  export function stats() {
    let total = 0
    let corrected = 0

    for (const budget of budgets.values()) {
      total += budget.failures.length
      if (budget.max > budget.remaining) corrected += budget.max - budget.remaining
    }

    return {
      totalFailures: total,
      correctionsAttempted: corrected,
      activeBudgets: budgets.size,
    }
  }
}
