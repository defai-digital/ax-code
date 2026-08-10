/**
 * Pure model-vs-agent/tool-schema fit checks used by Desktop selection preflight
 * and any client that must block unfit local/small-context models before send (#379).
 */

/** Conservative default for the full hosted-agent tool surface + system prompt. */
export const DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE = 40_000

/** Core local/coding tool profile (bash/read/edit/write/skill-focused). */
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
 * Pick a fixed-token estimate based on provider class. AX Engine local models
 * use the compact core tool profile; everything else assumes the full agent surface.
 */
export function fixedTokensEstimateForProvider(providerID: string | undefined): number {
  if (providerID === "ax-engine") return DEFAULT_CORE_AGENT_FIXED_TOKENS_ESTIMATE
  return DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE
}
