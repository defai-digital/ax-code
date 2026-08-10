/**
 * Pure model-vs-agent/tool-schema fit checks used by Desktop selection preflight
 * and any client that must block unfit local/small-context models before send (#379).
 */

/**
 * Selection-time estimate for the fixed system prompt + tool schemas on the
 * default build/agent path (matches observed runtime preflight budgets around
 * ~38.8k; see prompt-loop-compaction FIXED_CONTEXT_BUDGET_EXCEEDED). Rounded up
 * so borderline local models are blocked before first send (#379).
 */
export const DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE = 40_000

/**
 * Historical core-profile estimate. Not used for selection preflight: even
 * AX Engine sessions can hit the full-agent fixed budget depending on tool
 * profile / agent, and underestimating leaves unfit models selectable.
 */
export const DEFAULT_CORE_AGENT_FIXED_TOKENS_ESTIMATE = 12_000

export function usableInputTokens(input: {
  context?: number
  input?: number
  output?: number
}): number {
  if (typeof input.input === "number" && Number.isFinite(input.input) && input.input > 0) {
    return Math.floor(input.input)
  }
  const context = typeof input.context === "number" && Number.isFinite(input.context) ? input.context : 0
  if (context <= 0) return 0
  const output =
    typeof input.output === "number" && Number.isFinite(input.output) && input.output > 0
      ? input.output
      : Math.ceil(context * 0.1)
  return Math.max(0, Math.floor(context - Math.min(context, output)))
}

export function modelFitsAgentToolSetup(input: {
  usableTokens: number
  fixedTokensEstimate: number
  modelLabel?: string
}): { fits: true } | { fits: false; usableTokens: number; fixedTokensEstimate: number; message: string } {
  const usable = Math.max(0, Math.floor(input.usableTokens))
  const fixed = Math.max(0, Math.floor(input.fixedTokensEstimate))
  if (fixed < usable) return { fits: true }
  const label = input.modelLabel?.trim() || "This model"
  return {
    fits: false,
    usableTokens: usable,
    fixedTokensEstimate: fixed,
    message:
      `${label} cannot fit the current AX Code agent/tool setup. ` +
      `The fixed system prompt and tool schemas need about ${fixed} tokens, but only ${usable} input tokens are usable. ` +
      `Switch to a model with a larger context window, or use an agent/turn with fewer tools enabled.`,
  }
}

/**
 * Fixed-token budget used for selection preflight. Always the full-agent
 * estimate so Desktop/CLI pickers match the runtime preflight that blocks
 * unfit models on first send (issue #379: ax-engine Qwen ~14.7k usable vs
 * ~38.8k fixed). `providerID` is retained for callers/API stability.
 */
export function fixedTokensEstimateForProvider(_providerID?: string): number {
  return DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE
}
