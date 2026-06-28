/**
 * Model Capability Registry
 *
 * Declarative registry for model capabilities, replacing scattered model-specific
 * checks (e.g., `isQwen37MaxModel()`) with a unified capability-based system.
 *
 * This enables:
 * - Capability-based profile selection (not model-specific hardcoding)
 * - Easy addition of new models
 * - Consistent capability queries across the codebase
 *
 * @module model-capabilities
 */

/**
 * Rate limit tier for pacing policy selection.
 * - `unlimited`: No rate limiting (local/self-hosted models)
 * - `extended`: Higher limits (4 req/min, 10s delay) - e.g., Alibaba Cloud
 * - `standard`: Default limits (6 req/min, 5s delay) - e.g., OpenAI, Anthropic
 */
export type RateLimitTier = "unlimited" | "extended" | "standard"

/**
 * Feature support level for a capability.
 * - `supported`: Fully supported and stable
 * - `experimental`: Supported but may have issues or change
 * - `blocked`: Not supported or disabled
 */
export type FeatureSupport = "supported" | "experimental" | "blocked"

/**
 * Model capabilities declaration.
 *
 * Each field represents a specific capability that can be queried by the
 * autonomous mode, long-run policy, and optimization profiles.
 */
export interface ModelCapabilities {
  /**
   * Maximum context window size in tokens.
   * Used for context packing budget calculations.
   */
  contextWindow: number

  /**
   * Whether the model supports extended thinking/reasoning mode.
   * When true, thinking can be enabled for complex tasks.
   */
  thinking: FeatureSupport

  /**
   * Whether thinking state can be preserved across conversation turns.
   * Requires `thinking` to be at least "experimental".
   */
  preserveThinking: FeatureSupport

  /**
   * Whether prompt caching is supported.
   * Reduces latency and cost for repeated prompts.
   */
  promptCache: FeatureSupport

  /**
   * Whether tool calling is supported.
   * Required for agent mode with tool execution.
   */
  toolCalling: FeatureSupport

  /**
   * Whether structured output (JSON mode) is supported.
   * Enables reliable parsing of model responses.
   */
  structuredOutput: FeatureSupport

  /**
   * Whether web search or built-in tools are available.
   * Some providers offer integrated search capabilities.
   */
  webOrBuiltInTools: FeatureSupport

  /**
   * Rate limit tier for pacing policy selection.
   * Determines request throttling behavior.
   */
  rateLimitTier: RateLimitTier
}

/**
 * Model registration entry with pattern matching and provider filtering.
 */
export interface ModelRegistration {
  /**
   * Pattern to match model IDs.
   * Can be a string (exact match) or RegExp (pattern match).
   *
   * Examples:
   * - `"qwen-3-7-max"` (exact match)
   * - `/qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i` (pattern match with variations)
   */
  pattern: string | RegExp

  /**
   * Optional list of provider IDs this registration applies to.
   * If omitted or empty, applies to all providers.
   *
   * Examples:
   * - `["alibaba-coding-plan", "alibaba-token-plan"]` (specific providers)
   * - `[]` (all providers)
   */
  providerIds?: string[]

  /**
   * Declared capabilities for this model.
   */
  capabilities: ModelCapabilities
}

/**
 * Default capabilities for unknown models.
 * Conservative settings that work for most models.
 */
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  contextWindow: 32_000,
  thinking: "blocked",
  preserveThinking: "blocked",
  promptCache: "blocked",
  toolCalling: "supported",
  structuredOutput: "supported",
  webOrBuiltInTools: "blocked",
  rateLimitTier: "standard",
}

/**
 * Model capability registry.
 *
 * Order matters: first matching registration wins.
 * More specific registrations (with providerIds) should come before general ones.
 */
const MODEL_REGISTRY: ModelRegistration[] = [
  // Qwen 3.7 Max - Alibaba Cloud (official routes)
  // models-snapshot.json declares limit.context: 991k–1M for this model.
  // The registry value must reflect the true context window so that
  // long-agent profiles and context-packing budgets activate correctly.
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    providerIds: ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "supported",
      rateLimitTier: "extended",
    },
  },

  // Qwen 3.7 Max - Together AI
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    providerIds: ["togetherai"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Qwen 3.7 Max - Gateway routes (Vercel, LLM Gateway)
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    providerIds: ["llmgateway", "vercel"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "experimental",
      preserveThinking: "experimental",
      promptCache: "blocked",
      toolCalling: "experimental",
      structuredOutput: "experimental",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Qwen 3.7 Max - Other providers (fallback)
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Qwen 3.7 Plus - Alibaba Cloud (official routes)
  // Same 1M context window as Max; reasoning supported. webOrBuiltInTools
  // is "blocked" because enable_search evidence is Max-only in the snapshot.
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    providerIds: ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "extended",
    },
  },

  // Qwen 3.7 Plus - Together AI
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    providerIds: ["togetherai"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Qwen 3.7 Plus - Gateway routes (Vercel, LLM Gateway)
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    providerIds: ["llmgateway", "vercel"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "experimental",
      preserveThinking: "experimental",
      promptCache: "blocked",
      toolCalling: "experimental",
      structuredOutput: "experimental",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Qwen 3.7 Plus - Other providers (fallback)
  {
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Claude 3.7 Sonnet - Anthropic
  {
    pattern: /claude[\.\-_]?3[\.\-_]?7[\.\-_]?sonnet/i,
    providerIds: ["anthropic"],
    capabilities: {
      contextWindow: 200_000,
      thinking: "supported",
      preserveThinking: "blocked",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Claude 3.5 Sonnet - Anthropic
  {
    pattern: /claude[\.\-_]?3[\.\-_]?5[\.\-_]?sonnet/i,
    providerIds: ["anthropic"],
    capabilities: {
      contextWindow: 200_000,
      thinking: "blocked",
      preserveThinking: "blocked",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // GPT-5 - OpenAI
  {
    pattern: /gpt[\.\-_]?5/i,
    providerIds: ["openai"],
    capabilities: {
      contextWindow: 128_000,
      thinking: "supported",
      preserveThinking: "blocked",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // GPT-4o - OpenAI
  {
    pattern: /gpt[\.\-_]?4o/i,
    providerIds: ["openai"],
    capabilities: {
      contextWindow: 128_000,
      thinking: "blocked",
      preserveThinking: "blocked",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "supported",
      rateLimitTier: "standard",
    },
  },

  // GLM 5.x — Z.AI / Zhipu (official routes)
  // models-snapshot.json declares GLM-5.2 as a 1M-context reasoning model
  // (reasoning + effort high/xhigh, tool_call, structured_output). Without
  // this entry the capability registry collapsed it to DEFAULT_CAPABILITIES
  // (32k, non-reasoning), so the long-agent profile and Super-Long
  // model-default treated a 1M reasoning model as an 8k non-reasoning one.
  // preserveThinking/promptCache are `experimental` because z.ai's cross-turn
  // reasoning carry-over and explicit cache support are not probe-verified;
  // the profile treats experimental as enabled, so the long-agent code path
  // activates. See ADR-040.
  {
    pattern: /glm[\.\-_]?5/i,
    providerIds: ["zai", "zai-coding-plan", "zhipuai", "zhipuai-coding-plan"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // GLM 5.x — gateway / reseller fallback.
  // When the provider is unknown, still recognize GLM 5.x as a large-context
  // reasoning model rather than collapsing to the 32k default. Selectability
  // (which SKUs are offered) is governed separately by model-support.ts, so a
  // registry match here only affects capability bookkeeping.
  {
    pattern: /glm[\.\-_]?5/i,
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // Gemini 2.5 Pro - Google
  {
    pattern: /gemini[\.\-_]?2[\.\-_]?5[\.\-_]?pro/i,
    providerIds: ["google"],
    capabilities: {
      contextWindow: 1_000_000,
      thinking: "supported",
      preserveThinking: "blocked",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "supported",
      rateLimitTier: "standard",
    },
  },

  // Ollama models (local inference)
  {
    pattern: /.*/,
    providerIds: ["ollama"],
    capabilities: {
      contextWindow: 32_000,
      thinking: "blocked",
      preserveThinking: "blocked",
      promptCache: "blocked",
      // Local inference models have inconsistent tool-calling and structured
      // output support. Mark as experimental so agent workflows don't silently
      // depend on capabilities that may fail at runtime.
      toolCalling: "experimental",
      structuredOutput: "experimental",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
    },
  },
]

/**
 * Normalize model ID for matching.
 * Removes common separators and converts to lowercase.
 */
function normalizeModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/[._-]/g, "")
}

/**
 * Check if a model ID matches a pattern.
 *
 * For string patterns, both IDs are normalized (separators removed, lowercased).
 * For RegExp patterns, the pattern is tested against both the original and normalized ID.
 */
function matchesPattern(modelId: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return normalizeModelId(modelId) === normalizeModelId(pattern)
  }
  // Test both original and normalized to handle variations
  return pattern.test(modelId) || pattern.test(normalizeModelId(modelId))
}

/**
 * Check if a provider ID matches the provider filter.
 */
function matchesProvider(providerId: string | undefined, providerIds?: string[]): boolean {
  // If no provider filter, matches all providers
  if (!providerIds || providerIds.length === 0) {
    return true
  }
  // If no provider ID specified, doesn't match filtered registrations
  if (!providerId) {
    return false
  }
  return providerIds.includes(providerId)
}

/**
 * Get model capabilities for a given model ID and optional provider ID.
 *
 * Searches the registry for the first matching registration.
 * Returns default capabilities if no match is found.
 *
 * @param modelId - The model identifier (e.g., "qwen-3-7-max", "claude-3-7-sonnet")
 * @param providerId - Optional provider ID for provider-specific capabilities
 * @returns Model capabilities declaration
 *
 * @example
 * ```typescript
 * const caps = getModelCapabilities("qwen-3-7-max", "alibaba-coding-plan")
 * if (caps.thinking === "supported") {
 *   // Enable thinking mode
 * }
 * ```
 */
export function getModelCapabilities(modelId: string, providerId?: string): ModelCapabilities {
  for (const registration of MODEL_REGISTRY) {
    if (matchesPattern(modelId, registration.pattern) && matchesProvider(providerId, registration.providerIds)) {
      return { ...registration.capabilities }
    }
  }
  return { ...DEFAULT_CAPABILITIES }
}

/**
 * Check if a model supports long-agent optimization.
 *
 * Long-agent optimization requires:
 * - Large context window (>= 64k tokens)
 * - Thinking support (for complex reasoning)
 * - Prompt caching (for efficiency)
 *
 * @param modelId - The model identifier
 * @param providerId - Optional provider ID
 * @returns true if the model supports long-agent optimization
 *
 * @example
 * ```typescript
 * if (supportsLongAgent(modelId, providerId)) {
 *   // Apply long-agent profile
 * }
 * ```
 */
export function supportsLongAgent(modelId: string, providerId?: string): boolean {
  const caps = getModelCapabilities(modelId, providerId)
  return (
    caps.contextWindow >= 64_000 &&
    (caps.thinking === "supported" || caps.thinking === "experimental") &&
    (caps.promptCache === "supported" || caps.promptCache === "experimental")
  )
}

/**
 * Get the recommended context packing budget for a model.
 *
 * Based on the model's context window size:
 * - >= 128k: "wide" budget (128k tokens)
 * - >= 64k: "medium" budget (64k tokens)
 * - < 64k: "narrow" budget (8k tokens)
 *
 * @param modelId - The model identifier
 * @param providerId - Optional provider ID
 * @returns Recommended context packing budget in tokens
 */
export function getContextPackBudget(modelId: string, providerId?: string): number {
  const caps = getModelCapabilities(modelId, providerId)
  if (caps.contextWindow >= 128_000) {
    return 128_000
  }
  if (caps.contextWindow >= 64_000) {
    return 64_000
  }
  return 8_000
}

/**
 * Check if a model is Qwen 3.7 Max.
 *
 * @deprecated Use `getModelCapabilities()` instead. This function is provided
 * for backward compatibility during the migration period.
 *
 * @param modelId - The model identifier
 * @returns true if the model is Qwen 3.7 Max
 */
export function isQwen37MaxModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized.includes("qwen37max")
}

/**
 * Check if a model is Qwen 3.7 Plus.
 *
 * @deprecated Use `getModelCapabilities()` instead. This function is provided
 * for backward compatibility during the migration period.
 *
 * @param modelId - The model identifier
 * @returns true if the model is Qwen 3.7 Plus
 */
export function isQwen37PlusModel(modelId: string): boolean {
  const normalized = normalizeModelId(modelId)
  return normalized.includes("qwen37plus")
}

/**
 * Check if a model is Qwen 3.7 Max or Plus.
 * Useful for shared logic that applies to both tiers (e.g. output token caps).
 *
 * @param modelId - The model identifier
 * @returns true if the model is Qwen 3.7 Max or Plus
 */
export function isQwen37MaxOrPlusModel(modelId: string): boolean {
  return isQwen37MaxModel(modelId) || isQwen37PlusModel(modelId)
}

/**
 * List all registered models.
 *
 * Useful for documentation and debugging.
 *
 * @returns Array of model registrations
 */
export function listRegisteredModels(): ModelRegistration[] {
  return [...MODEL_REGISTRY]
}
