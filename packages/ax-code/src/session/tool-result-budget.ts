/**
 * Aggregate byte budget for the tool results of one model step (ADR-211).
 *
 * Per-tool truncation (`tool/truncate.ts`) caps each result individually, but
 * nothing bounded the SUM of one step's parallel results; ten results could
 * put 500 KB into a single request and overflow small-context models. This
 * module holds the pure planning half: given the emitted sizes of a step's
 * results and a budget, it decides which results spill to disk (largest
 * first) until the projected total fits. Errors are never spilled and a
 * result is never reduced below the preview floor. Call ids and ordering are
 * the caller's concern — the plan only names indices.
 */

export namespace ToolResultBudget {
  /** Fraction of the model context window granted to one step's tool results. */
  export const CONTEXT_FRACTION = 0.35
  /** Rough bytes-per-token conversion for the context-window estimate. */
  export const BYTES_PER_TOKEN = 4
  /** Floor for the derived budget (ADR-211 D2). */
  export const MIN_BUDGET_BYTES = 32 * 1024
  /** Ceiling for the derived budget (ADR-211 D2). */
  export const MAX_BUDGET_BYTES = 400 * 1024
  /** Spilled results keep at least this much preview text (ADR-211 D3). */
  export const PREVIEW_FLOOR_BYTES = 2 * 1024
  /**
   * Headroom added to the preview floor when projecting a spilled result's
   * emitted size: the truncation note appended by `Truncate.output` is not
   * part of the preview bytes but does reach the request.
   */
  const SPILL_NOTE_ALLOWANCE_BYTES = 256

  export interface ResultSize {
    /** Emitted byte length of one tool result (already per-tool truncated results count by their emitted size). */
    bytes: number
    /** Error results are never spilled (ADR-211 D3). */
    error?: boolean
  }

  export interface Plan {
    /** Indices of `results` to spill, in spill order (largest first, ties by index). */
    spill: number[]
    /** Projected total bytes after applying the plan. */
    projectedBytes: number
    /** True when even spilling every eligible candidate cannot reach the budget. */
    overBudget: boolean
  }

  /**
   * Resolve the per-step budget in bytes. An explicit positive override
   * (`tool_output.step_budget_bytes`) wins; otherwise the budget is
   * CONTEXT_FRACTION of the model context window expressed as
   * bytes (~tokens * 4), clamped to [MIN_BUDGET_BYTES, MAX_BUDGET_BYTES].
   * The override is clamped to the preview floor because results can never
   * shrink below it.
   */
  export function resolveBudgetBytes(input: { contextTokens?: number; overrideBytes?: number }): number {
    const override = input.overrideBytes
    if (override !== undefined && Number.isFinite(override) && override > 0) {
      return Math.max(Math.floor(override), PREVIEW_FLOOR_BYTES)
    }
    const windowBytes = (input.contextTokens ?? 0) * BYTES_PER_TOKEN
    return Math.min(MAX_BUDGET_BYTES, Math.max(MIN_BUDGET_BYTES, Math.round(windowBytes * CONTEXT_FRACTION)))
  }

  /**
   * Plan which results spill so the projected total fits the budget.
   * Selection is largest-first among non-error results larger than the
   * preview floor; ties break by index so the plan is deterministic.
   */
  export function plan(input: { results: ResultSize[]; budgetBytes: number; previewFloorBytes?: number }): Plan {
    const floor = Math.max(1, Math.floor(input.previewFloorBytes ?? PREVIEW_FLOOR_BYTES))
    let projected = input.results.reduce((sum, result) => sum + Math.max(0, result.bytes), 0)
    if (projected <= input.budgetBytes) return { spill: [], projectedBytes: projected, overBudget: false }

    const candidates = input.results
      .map((result, index) => ({ index, bytes: result.bytes, error: result.error === true }))
      .filter((result) => !result.error && result.bytes > floor)
      .sort((a, b) => b.bytes - a.bytes || a.index - b.index)

    const spill: number[] = []
    for (const candidate of candidates) {
      if (projected <= input.budgetBytes) break
      projected -= candidate.bytes - (floor + SPILL_NOTE_ALLOWANCE_BYTES)
      spill.push(candidate.index)
    }
    return { spill, projectedBytes: projected, overBudget: projected > input.budgetBytes }
  }
}
