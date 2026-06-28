export type FeatureSupport = "supported" | "experimental" | "blocked"

export interface Qwen37ReadinessMatrix {
  thinking: FeatureSupport
  preserveThinking: FeatureSupport
  toolCalling: FeatureSupport
  structuredOutput: FeatureSupport
  promptCache: FeatureSupport
  webOrBuiltInTools: FeatureSupport
}

/** @deprecated Use {@link Qwen37ReadinessMatrix} instead. */
export type Qwen37MaxReadinessMatrix = Qwen37ReadinessMatrix

export type Qwen37RouteClassification = "alibaba" | "together" | "gateway" | "unknown"

/** @deprecated Use {@link Qwen37RouteClassification} instead. */
export type Qwen37MaxRouteClassification = Qwen37RouteClassification

const ALIBABA_PROVIDER_IDS = new Set([
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
])

export function classifyQwen37Route(providerId: string): Qwen37RouteClassification {
  if (ALIBABA_PROVIDER_IDS.has(providerId)) return "alibaba"
  if (providerId === "togetherai") return "together"
  if (providerId === "llmgateway" || providerId === "vercel") return "gateway"
  return "unknown"
}

/** @deprecated Use {@link classifyQwen37Route} instead. */
export const classifyQwen37MaxRoute = classifyQwen37Route

// ── Qwen 3.7 Max readiness ──────────────────────────────────────────────────
// Max supports DashScope enable_search on Alibaba routes (web/built-in tools).

const MAX_READINESS_BY_ROUTE: Record<Qwen37RouteClassification, Qwen37ReadinessMatrix> = {
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

export function qwen37MaxReadiness(providerId: string): Qwen37ReadinessMatrix {
  return MAX_READINESS_BY_ROUTE[classifyQwen37Route(providerId)]
}

// ── Qwen 3.7 Plus readiness ─────────────────────────────────────────────────
// Plus differs from Max: webOrBuiltInTools is "blocked" on Alibaba routes
// because enable_search evidence in the models-snapshot is Max-only.

const PLUS_READINESS_BY_ROUTE: Record<Qwen37RouteClassification, Qwen37ReadinessMatrix> = {
  alibaba: {
    thinking: "supported",
    preserveThinking: "supported",
    toolCalling: "supported",
    structuredOutput: "supported",
    promptCache: "supported",
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

export function qwen37PlusReadiness(providerId: string): Qwen37ReadinessMatrix {
  return PLUS_READINESS_BY_ROUTE[classifyQwen37Route(providerId)]
}

// ── Model ID detection ────────────────────────────────────────────────────────

export function isQwen37MaxModel(modelId: string): boolean {
  // Providers spell the same model differently: "qwen3.7-max" (Alibaba,
  // most gateways), "Qwen/Qwen3.7-Max" (Together), "qwen-3-7-max" (Venice).
  // Normalize separators away so every spelling is recognized.
  const normalized = modelId.toLowerCase().replace(/[._-]/g, "")
  return normalized.includes("qwen37max")
}

export function isQwen37PlusModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase().replace(/[._-]/g, "")
  return normalized.includes("qwen37plus")
}
