import type { ProviderModel, ProviderWithModelList } from "@/types/providerModels"

// Mirror packages/ax-code/src/session/model-agent-fit.ts — Desktop cannot
// import the CLI package tree at runtime, so the pure fit logic is duplicated
// here with the same thresholds (kept in lockstep by unit tests on both sides).
// ~40k matches runtime default build/agent fixed budget (~38.8k observed in #379).
const DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE = 40_000

export function usableInputTokensFromModelLimit(limit: {
  context?: number
  input?: number
  output?: number
} | null | undefined): number {
  if (!limit || typeof limit !== "object") return 0
  if (typeof limit.input === "number" && Number.isFinite(limit.input) && limit.input > 0) {
    return Math.floor(limit.input)
  }
  const context = typeof limit.context === "number" && Number.isFinite(limit.context) ? limit.context : 0
  if (context <= 0) return 0
  const output =
    typeof limit.output === "number" && Number.isFinite(limit.output) && limit.output > 0
      ? limit.output
      : Math.ceil(context * 0.1)
  return Math.max(0, Math.floor(context - Math.min(context, output)))
}

/** Full-agent fixed budget for every provider, including ax-engine (#379). */
export function fixedTokensEstimateForProvider(_providerID?: string): number {
  return DEFAULT_FULL_AGENT_FIXED_TOKENS_ESTIMATE
}

/**
 * Selection-time agent/tool setup fit (#379). Returns a human-readable block
 * reason when the model cannot fit the default fixed prompt+tool schema.
 */
export function getModelAgentToolFitBlockReason(
  model: Record<string, unknown> | null | undefined,
  providerID?: string,
): string {
  if (!model || typeof model !== "object") return ""
  const limit =
    model.limit && typeof model.limit === "object"
      ? (model.limit as { context?: number; input?: number; output?: number })
      : undefined
  const usable = usableInputTokensFromModelLimit(limit)
  if (usable <= 0) return ""
  const fixed = fixedTokensEstimateForProvider(
    providerID ?? (typeof model.providerID === "string" ? model.providerID : undefined),
  )
  if (fixed < usable) return ""
  const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : "This model"
  return (
    `${name} cannot fit the current AX Code agent/tool setup ` +
    `(needs ~${fixed} tokens, only ${usable} usable). Pick a larger-context model.`
  )
}

export const getProviderModelDisabledReason = (
  model: Record<string, unknown> | null | undefined,
  providerID?: string,
): string => {
  const capabilities = model?.capabilities
  const output =
    capabilities && typeof capabilities === "object" && "output" in capabilities
      ? (capabilities as { output?: unknown }).output
      : undefined
  if (output && typeof output === "object" && (output as { text?: unknown }).text === false) {
    return "This model cannot return text responses required by AX Code."
  }

  const options = model?.options
  if (options && typeof options === "object") {
    const reason = (options as Record<string, unknown>).memoryBlockReason
    if (typeof reason === "string" && reason.trim().length > 0) return reason.trim()
  }

  const fitReason = getModelAgentToolFitBlockReason(model, providerID)
  if (fitReason) return fitReason

  return ""
}

export const isProviderModelSelectable = (
  model: Record<string, unknown> | null | undefined,
  providerID?: string,
): boolean => getProviderModelDisabledReason(model, providerID).length === 0
export const findSelectableProviderModel = (
  providers: ProviderWithModelList[],
  providerId: string,
  modelId: string,
): ProviderModel | undefined => {
  const provider = providers.find((item) => item.id === providerId)
  if (!provider) return undefined

  const model = provider.models.find((item) => item.id === modelId)
  if (!model || !isProviderModelSelectable(model, providerId)) return undefined

  return model
}

export const hasSelectableProviderModel = (
  providers: ProviderWithModelList[],
  providerId: string,
  modelId: string,
): boolean => Boolean(findSelectableProviderModel(providers, providerId, modelId))