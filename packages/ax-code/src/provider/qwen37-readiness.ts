export type FeatureSupport = "supported" | "experimental" | "blocked"

export interface Qwen37MaxReadinessMatrix {
  thinking: FeatureSupport
  preserveThinking: FeatureSupport
  toolCalling: FeatureSupport
  structuredOutput: FeatureSupport
  promptCache: FeatureSupport
  webOrBuiltInTools: FeatureSupport
}

export type Qwen37MaxRouteClassification = "alibaba" | "together" | "gateway" | "unknown"

const ALIBABA_PROVIDER_IDS = new Set([
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
])

export function classifyQwen37MaxRoute(providerId: string): Qwen37MaxRouteClassification {
  if (ALIBABA_PROVIDER_IDS.has(providerId)) return "alibaba"
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
  // Providers spell the same model differently: "qwen3.7-max" (Alibaba,
  // most gateways), "Qwen/Qwen3.7-Max" (Together), "qwen-3-7-max" (Venice).
  // Normalize separators away so every spelling is recognized.
  const normalized = modelId.toLowerCase().replace(/[._-]/g, "")
  return normalized.includes("qwen37max")
}
