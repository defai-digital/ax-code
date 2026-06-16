import { getModelCapabilities, supportsLongAgent } from "./model-capabilities"

export type TaskRouteClass = "cheap" | "premium" | "premiumCrossCheck"

export interface TaskRouteClassification {
  class: TaskRouteClass
  reason: string
}

export interface LongAgentProfile {
  contextPackingBudget: "narrow" | "wide"
  contextPackTokenBudget: number
  thinkingEnabled: boolean
  preserveThinkingEligible: boolean
  promptCacheEligible: boolean
  verificationLoopEnabled: boolean
  strictRepeatedFailureDetection: boolean
}

export function classifyTaskForModelRoute(input: {
  fileCount?: number
  hasToolHeavyDebug?: boolean
  isHighRiskRefactor?: boolean
  isReleaseCritical?: boolean
  isSecuritySensitive?: boolean
  promptTokenEstimate?: number
}): TaskRouteClassification {
  if (input.isHighRiskRefactor || input.isReleaseCritical || input.isSecuritySensitive) {
    return { class: "premiumCrossCheck", reason: "high-risk, release-critical, or security-sensitive change" }
  }
  if ((input.fileCount ?? 0) > 1 || input.hasToolHeavyDebug || (input.promptTokenEstimate ?? 0) > 2000) {
    return { class: "premium", reason: "multi-file, tool-heavy, or large-context task" }
  }
  return { class: "cheap", reason: "short single-file edit or simple query" }
}

/**
 * Get long-agent profile based on model capabilities.
 *
 * Uses the capability registry to determine the optimal profile:
 * - Models with long-agent support get the "wide" profile (128k context, thinking enabled)
 * - Other models get the "narrow" profile (8k context, thinking disabled)
 *
 * This replaces the previous model-specific hardcoding (e.g., `isQwen37MaxModel()`)
 * with a capability-based approach.
 *
 * @param modelId - The model identifier
 * @param providerId - Optional provider ID for provider-specific capabilities
 * @returns Long-agent profile optimized for the model
 */
export function longAgentProfileForModel(modelId: string, providerId?: string): LongAgentProfile {
  const caps = getModelCapabilities(modelId, providerId)

  if (supportsLongAgent(modelId, providerId)) {
    return {
      contextPackingBudget: "wide",
      contextPackTokenBudget: caps.contextWindow >= 128_000 ? 128_000 : 64_000,
      thinkingEnabled: caps.thinking === "supported" || caps.thinking === "experimental",
      preserveThinkingEligible: caps.preserveThinking === "supported" || caps.preserveThinking === "experimental",
      promptCacheEligible: caps.promptCache === "supported" || caps.promptCache === "experimental",
      verificationLoopEnabled: true,
      strictRepeatedFailureDetection: true,
    }
  }

  return {
    contextPackingBudget: "narrow",
    contextPackTokenBudget: 8_000,
    thinkingEnabled: false,
    preserveThinkingEligible: false,
    promptCacheEligible: false,
    verificationLoopEnabled: false,
    strictRepeatedFailureDetection: false,
  }
}
