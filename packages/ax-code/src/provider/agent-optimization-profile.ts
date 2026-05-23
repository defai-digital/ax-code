export type TaskRouteClass = "cheap" | "premium" | "premiumCrossCheck"

export interface TaskRouteClassification {
  class: TaskRouteClass
  reason: string
}

export interface LongAgentProfile {
  contextPackingBudget: "narrow" | "wide"
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

export function qwen37MaxLongAgentProfile(): LongAgentProfile {
  return {
    contextPackingBudget: "wide",
    thinkingEnabled: true,
    preserveThinkingEligible: true,
    promptCacheEligible: true,
    verificationLoopEnabled: true,
    strictRepeatedFailureDetection: true,
  }
}

export function defaultLongAgentProfile(): LongAgentProfile {
  return {
    contextPackingBudget: "narrow",
    thinkingEnabled: false,
    preserveThinkingEligible: false,
    promptCacheEligible: false,
    verificationLoopEnabled: false,
    strictRepeatedFailureDetection: false,
  }
}

export function longAgentProfileForModel(modelId: string): LongAgentProfile {
  const lower = modelId.toLowerCase()
  if (lower.includes("qwen3.7-max") || lower.includes("qwen37-max")) {
    return qwen37MaxLongAgentProfile()
  }
  return defaultLongAgentProfile()
}
