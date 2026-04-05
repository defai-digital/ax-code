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

  // Budget tracking is scoped per-session. Previously this was a global
  // Map<string, Budget> that accumulated forever: failures from older
  // sessions exhausted budgets for new ones, and a success in session B
  // could wipe session A's budget. Scoping per session means state is
  // bounded and can be freed when a session ends.
  const sessionBudgets = new Map<string, Map<string, Budget>>()

  function forSession(sessionID: string): Map<string, Budget> {
    let m = sessionBudgets.get(sessionID)
    if (!m) {
      m = new Map()
      sessionBudgets.set(sessionID, m)
    }
    return m
  }

  function key(tool: string, error: string): string {
    // Normalize error to group similar failures
    const normalized = error.replace(/[0-9]+/g, "N").replace(/\/[^\s]+/g, "/PATH").slice(0, 100)
    return `${tool}:${normalized}`
  }

  /**
   * Analyze a tool error and determine if self-correction should be attempted.
   * Returns a reflection prompt to inject, or null if no correction is
   * possible. State is scoped to the provided sessionID.
   */
  export function analyze(
    sessionID: string,
    toolName: string,
    error: string,
  ): { signal: FailureSignal; prompt: string } | null {
    const budgets = forSession(sessionID)
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
      log.info("failure not recoverable", { sessionID, tool: toolName, strategy: signal.strategy, attempt })
      return null
    }

    if (budget.remaining <= 0) {
      log.info("retry budget exhausted", { sessionID, tool: toolName, attempt, max: budget.max })
      return null
    }

    // Consume budget
    budget.remaining--

    log.info("self-correction triggered", {
      sessionID,
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
   * in a specific session. Called when a tool succeeds after failures.
   */
  export function recordSuccess(sessionID: string, toolName: string) {
    const budgets = sessionBudgets.get(sessionID)
    if (!budgets) return
    for (const [k] of budgets) {
      if (k.startsWith(`${toolName}:`)) budgets.delete(k)
    }
  }

  /**
   * Reset correction state for a specific session (called on session end
   * or fresh start). Pass no argument to clear all sessions.
   */
  export function reset(sessionID?: string) {
    if (sessionID === undefined) {
      sessionBudgets.clear()
      return
    }
    sessionBudgets.delete(sessionID)
  }

  /**
   * Get correction statistics for a specific session, or aggregate across
   * all sessions when no sessionID is supplied.
   */
  export function stats(sessionID?: string) {
    const sources =
      sessionID === undefined ? Array.from(sessionBudgets.values()) : [sessionBudgets.get(sessionID) ?? new Map()]
    let total = 0
    let corrected = 0
    let active = 0
    for (const budgets of sources) {
      active += budgets.size
      for (const budget of budgets.values()) {
        total += budget.failures.length
        if (budget.max > budget.remaining) corrected += budget.max - budget.remaining
      }
    }
    return {
      totalFailures: total,
      correctionsAttempted: corrected,
      activeBudgets: active,
    }
  }
}
