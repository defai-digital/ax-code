export type FeatureSupport = "supported" | "experimental" | "blocked"

export interface Qwen37MaxReadinessMatrix {
  thinking: FeatureSupport
  preserveThinking: FeatureSupport
  toolCalling: FeatureSupport
  structuredOutput: FeatureSupport
  promptCache: FeatureSupport
  webOrBuiltInTools: FeatureSupport
}

export type Qwen37MaxRouteClassification = "alibaba" | "openrouter" | "together" | "gateway" | "unknown"

const ALIBABA_PROVIDER_IDS = new Set([
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
])

export function classifyQwen37MaxRoute(providerId: string): Qwen37MaxRouteClassification {
  if (ALIBABA_PROVIDER_IDS.has(providerId)) return "alibaba"
  if (providerId === "openrouter") return "openrouter"
  if (providerId === "togetherai") return "together"
  if (providerId === "llmgateway" || providerId === "vercel") return "gateway"
  return "unknown"
}

const READINESS_BY_ROUTE: Record<Qwen37MaxRouteClassification, Qwen37MaxReadinessMatrix> = {
  alibaba: {
    thinking: "supported",
    preserveThinking: "supported",
    toolCalling: "supported",
    structuredOutput: "supported",
    promptCache: "supported",
    webOrBuiltInTools: "supported",
  },
  openrouter: {
    thinking: "supported",
    preserveThinking: "experimental",
    toolCalling: "supported",
    structuredOutput: "supported",
    // OR docs did not list qwen3.7-max in the Alibaba explicit-cache model list at ADR-013 review time
    promptCache: "experimental",
    webOrBuiltInTools: "blocked",
  },
  together: {
    thinking: "supported",
    preserveThinking: "experimental",
    toolCalling: "supported",
    structuredOutput: "supported",
    promptCache: "experimental",
    webOrBuiltInTools: "blocked",
  },
  gateway: {
    thinking: "experimental",
    preserveThinking: "experimental",
    toolCalling: "experimental",
    structuredOutput: "experimental",
    promptCache: "blocked",
    webOrBuiltInTools: "blocked",
  },
  unknown: {
    thinking: "blocked",
    preserveThinking: "blocked",
    toolCalling: "blocked",
    structuredOutput: "blocked",
    promptCache: "blocked",
    webOrBuiltInTools: "blocked",
  },
}

export function qwen37MaxReadiness(providerId: string): Qwen37MaxReadinessMatrix {
  return READINESS_BY_ROUTE[classifyQwen37MaxRoute(providerId)]
}

export function isQwen37MaxModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return lower.includes("qwen3.7-max") || lower.includes("qwen37-max")
}
