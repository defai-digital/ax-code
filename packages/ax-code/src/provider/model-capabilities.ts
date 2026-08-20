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

import { normalizeProviderModelId } from "./model-id"
import {
  isQwen37MaxModel as isQwen37MaxReadinessModel,
  isQwen37PlusModel as isQwen37PlusReadinessModel,
  QWEN37_ALIBABA_PROVIDER_IDS,
  qwen37MaxReadiness,
  qwen37PlusReadiness,
} from "./qwen37-readiness"
import { DEDICATED_PRIVATE_GPU_PROVIDER_IDS } from "./private-gpu/presets"

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
// Build a Qwen 3.7 Max/Plus registration from the qwen37-readiness.ts route
// matrices so the registry's per-route feature flags can never drift from
// them — previously both files hand-maintained the same values and had
// already diverged on the unknown-route row. Patterns, context windows, and
// rate-limit tiers stay here; the matrices own feature readiness per route.
// `routeProviderId` selects the readiness row for the entry's route class
// (each entry is scoped to exactly one route).
function qwen37Registration(input: {
  pattern: RegExp
  providerIds?: string[]
  routeProviderId: string
  tier: "max" | "plus"
  contextWindow: number
  rateLimitTier: RateLimitTier
}): ModelRegistration {
  const matrix =
    input.tier === "max" ? qwen37MaxReadiness(input.routeProviderId) : qwen37PlusReadiness(input.routeProviderId)
  return {
    pattern: input.pattern,
    providerIds: input.providerIds,
    capabilities: {
      contextWindow: input.contextWindow,
      ...matrix,
      rateLimitTier: input.rateLimitTier,
    },
  }
}

// First-party MiniMax providers from the models.dev snapshot: minimax.io and
// minimaxi.com plus their token/coding plans.
const MINIMAX_FIRST_PARTY_PROVIDER_IDS = ["minimax", "minimax-coding-plan", "minimax-cn", "minimax-cn-coding-plan"]

// Reasoning-capable MiniMax M2/M2.x/M3 shape. preserveThinking/promptCache
// are experimental until probe-verified (see registry comment below).
function minimaxCapabilities(contextWindow: number): ModelCapabilities {
  return {
    contextWindow,
    thinking: "supported",
    preserveThinking: "experimental",
    promptCache: "experimental",
    toolCalling: "supported",
    structuredOutput: "supported",
    webOrBuiltInTools: "blocked",
    rateLimitTier: "standard",
  }
}

const MODEL_REGISTRY: ModelRegistration[] = [
  // Qwen 3.7+ Max - Alibaba Cloud (official routes)
  // models-snapshot.json declares limit.context: 991k–1M for this model.
  // The registry value must reflect the true context window so that
  // long-agent profiles and context-packing budgets activate correctly.
  //
  // The pattern matches 3.7–3.9 on Alibaba's first-party routes so a new
  // flagship minor (3.8 Max) inherits the family capabilities instead of
  // silently collapsing to DEFAULT_CAPABILITIES (32k, non-reasoning) —
  // which would disable Super-Long's model-default and the long-agent
  // profile for the exact models they exist for. This mirrors the GLM
  // family-wide `/glm[.\-_]?5/` pattern (ADR-040). Deliberately NOT
  // family-wide below 3.7: qwen 3.6-max-preview ships different
  // capabilities. Gateway/aggregator entries stay 3.7-pinned because
  // their support genuinely varies per model.
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?[789][\.\-_]?max/i,
    providerIds: [...QWEN37_ALIBABA_PROVIDER_IDS],
    routeProviderId: "alibaba-coding-plan",
    tier: "max",
    contextWindow: 1_000_000,
    rateLimitTier: "extended",
  }),

  // Qwen 3.7 Max - Together AI
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    providerIds: ["togetherai"],
    routeProviderId: "togetherai",
    tier: "max",
    contextWindow: 1_000_000,
    rateLimitTier: "standard",
  }),

  // Qwen 3.7 Max - Gateway routes (Vercel, LLM Gateway)
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    providerIds: ["llmgateway", "vercel"],
    routeProviderId: "llmgateway",
    tier: "max",
    contextWindow: 1_000_000,
    rateLimitTier: "standard",
  }),

  // Qwen 3.7 Max - Other providers (fallback)
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?max/i,
    routeProviderId: "unknown-provider",
    tier: "max",
    contextWindow: 1_000_000,
    rateLimitTier: "standard",
  }),

  // Qwen 3.7+ Plus - Alibaba Cloud (official routes)
  // Same 1M context window as Max; reasoning supported. webOrBuiltInTools
  // is "blocked" because enable_search evidence is Max-only in the snapshot.
  // 3.7–3.9 for the same forward-compat reason as the Max entry above.
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?[789][\.\-_]?plus/i,
    providerIds: [...QWEN37_ALIBABA_PROVIDER_IDS],
    routeProviderId: "alibaba-coding-plan",
    tier: "plus",
    contextWindow: 1_000_000,
    rateLimitTier: "extended",
  }),

  // Qwen 3.7 Plus - Together AI
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    providerIds: ["togetherai"],
    routeProviderId: "togetherai",
    tier: "plus",
    contextWindow: 1_000_000,
    rateLimitTier: "standard",
  }),

  // Qwen 3.7 Plus - Gateway routes (Vercel, LLM Gateway)
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    providerIds: ["llmgateway", "vercel"],
    routeProviderId: "llmgateway",
    tier: "plus",
    contextWindow: 1_000_000,
    rateLimitTier: "standard",
  }),

  // Qwen 3.7 Plus - Other providers (fallback)
  qwen37Registration({
    pattern: /qwen[\.\-_]?3[\.\-_]?7[\.\-_]?plus/i,
    routeProviderId: "unknown-provider",
    tier: "plus",
    contextWindow: 1_000_000,
    rateLimitTier: "standard",
  }),

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

  // GLM-4.7-Flash — Z.AI / Zhipu free PAYG SKU (200k context, toggleable thinking).
  // Must stay ahead of any broader glm-4 match; GLM 4.x is otherwise hidden.
  {
    pattern: /glm[\.\-_]?4[\.\-_]?7[\.\-_]?flash(?!x)/i,
    providerIds: ["zai", "zai-coding-plan", "zhipuai", "zhipuai-coding-plan"],
    capabilities: {
      contextWindow: 200_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // GLM-4.7 — Z.AI / Zhipu PAYG and coding-plan SKU (204.8k context,
  // toggleable thinking).
  // Must stay after the glm-4.7-flash entry so the flash pattern matches first.
  {
    pattern: /glm[\.\-_]?4[\.\-_]?7(?!-?flash)(?:$|[^a-z0-9])/i,
    providerIds: ["zai", "zai-coding-plan", "zhipuai", "zhipuai-coding-plan"],
    capabilities: {
      contextWindow: 204_800,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
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

  // Ornith 1.0 35B — managed AX Engine build. Explicit IDs for the well-known
  // variants (fast path) followed by a regex catch-all for future AXQuant
  // builds and aliased deployments. Prefix caching is runtime-managed by
  // AX Engine and remains experimental here.
  {
    pattern: "ornith-35b",
    providerIds: ["ax-engine"],
    capabilities: {
      contextWindow: 262_144,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
    },
  },
  {
    pattern: "AX-Ornith-1.0-35B-MLX-AXQ-6bit",
    providerIds: ["ax-engine"],
    capabilities: {
      contextWindow: 262_144,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
    },
  },
  {
    pattern: /ornith(?:[\.\-_]?1[\.\-_]?0)?[\.\-_]?35b/i,
    providerIds: ["ax-engine"],
    capabilities: {
      contextWindow: 262_144,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
    },
  },

  // Ornith 1.0 397B-FP8 — Alibaba PAI-EAS dedicated GPU deployment. Shares
  // the same 262K context architecture as the local 35B AXQ build. Explicit
  // IDs for the canonical variant followed by a regex catch-all. Listed
  // separately from the generic private-GPU catch-all so the reported
  // context window reflects the actual model capacity rather than the
  // open-ended 1M placeholder used for undiscovered vLLM/SGLang endpoints.
  {
    pattern: "Ornith-1.0-397B-FP8",
    providerIds: ["alibaba-pai"],
    capabilities: {
      contextWindow: 262_144,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
    },
  },
  {
    pattern: /ornith(?:[\.\-_]?1[\.\-_]?0)?[\.\-_]?397b/i,
    providerIds: ["alibaba-pai"],
    capabilities: {
      contextWindow: 262_144,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
    },
  },

  // Dedicated private GPU endpoints (vLLM / SGLang / TGI). Discovered
  // max_model_len can be 1M+; treat the whole family as large-context and
  // unpaced so unknown model IDs do not collapse to DEFAULT_CAPABILITIES.
  // The provider list is owned by private-gpu/presets.ts so this entry and
  // transform.ts's private-GPU shaping cannot drift apart.
  {
    pattern: /.*/,
    providerIds: [...DEDICATED_PRIVATE_GPU_PROVIDER_IDS],
    capabilities: {
      contextWindow: 1_048_576,
      thinking: "supported",
      preserveThinking: "supported",
      promptCache: "supported",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "unlimited",
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

  // MiniMax M2 / M2.x / M3 — first-party routes (minimax.io / minimaxi.com and
  // their token plans). Snapshot limits: M2 196 608 ctx / 128k out, M2.x
  // (M2.1/M2.5/M2.7 and highspeed variants) 204 800 / 131k, M3 1M / 128k.
  // transform.ts already ships first-class MiniMax support (mm:think folding,
  // M2 sampling, M3 reasoning variants), so without these entries the models
  // collapsed to DEFAULT_CAPABILITIES (32k, non-reasoning) and lost long-agent
  // / Super-Long on the official routes. M1 is deliberately NOT matched:
  // snapshot rows list reasoning:false for it. preserveThinking/promptCache
  // stay experimental (cross-turn carry-over and cache support unverified),
  // mirroring the GLM 5.x honesty level (ADR-040). Ordering within the family:
  // m3 first, then the versioned m2.x pattern, then base m2 (its pattern is a
  // prefix of the other two).
  {
    pattern: /minimax[\.\-_]?m3/i,
    providerIds: MINIMAX_FIRST_PARTY_PROVIDER_IDS,
    capabilities: minimaxCapabilities(1_000_000),
  },
  {
    pattern: /minimax[\.\-_]?m2[\.\-_]?\d/i,
    providerIds: MINIMAX_FIRST_PARTY_PROVIDER_IDS,
    capabilities: minimaxCapabilities(204_800),
  },
  {
    pattern: /minimax[\.\-_]?m2/i,
    providerIds: MINIMAX_FIRST_PARTY_PROVIDER_IDS,
    capabilities: minimaxCapabilities(196_608),
  },

  // MiniMax — gateway / reseller fallback (mirrors the GLM 5.x gateway
  // fallback). Placed at the very END of the registry so the dedicated
  // private-GPU and Ollama catch-alls above keep winning on their providers
  // (alibaba-pai stays 1M/unlimited; ollama stays 32k local).
  {
    pattern: /minimax[\.\-_]?m3/i,
    capabilities: minimaxCapabilities(1_000_000),
  },
  {
    pattern: /minimax[\.\-_]?m2[\.\-_]?\d/i,
    capabilities: minimaxCapabilities(204_800),
  },
  {
    pattern: /minimax[\.\-_]?m2/i,
    capabilities: minimaxCapabilities(196_608),
  },

  // Kimi K2.7 Code — gateway fallback (Together / Baseten / DeepInfra / Nebius
  // serve it alongside the first-party Kimi Cloud Plan). Moonshot documents a
  // 256K context window plus interleaved reasoning and multi-step tool calls;
  // without this entry the model collapsed to DEFAULT_CAPABILITIES (32k,
  // thinking blocked), disabling long-agent optimization on GPU vendors.
  // Gateway prompt-cache behavior is route-dependent, so keep it experimental.
  {
    pattern: /kimi[\.\-_]?k2[\.\-_]?7/i,
    capabilities: {
      contextWindow: 262_144,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // DeepSeek V4 — gateway fallback (DeepInfra / Together / Baseten / NVIDIA /
  // Nebius plus the first-party deepseek provider). DeepSeek documents a 1M
  // context window, hybrid thinking, tool calls, JSON output, and automatic
  // first-party context caching. Cache behavior on gateways remains experimental.
  {
    pattern: /deepseek[\.\-_]?v4/i,
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

  // Nebius also exposes a deliberately constrained 8K fast route. It must win
  // before the family fallback or long-agent mode would incorrectly allocate a
  // 128K context pack to it.
  {
    pattern: /deepseek[\.\-_]?v3[\.\-_]?2.*fast/i,
    providerIds: ["nebius"],
    capabilities: {
      contextWindow: 8_000,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },

  // DeepSeek V3.2 — gateway fallback. The upstream model configuration declares
  // a 163,840-token window, and DeepSeek documents hybrid thinking with tool
  // calls. Gateway prompt-cache behavior remains experimental.
  {
    pattern: /deepseek[\.\-_]?v3[\.\-_]?2/i,
    capabilities: {
      contextWindow: 163_840,
      thinking: "supported",
      preserveThinking: "experimental",
      promptCache: "experimental",
      toolCalling: "supported",
      structuredOutput: "supported",
      webOrBuiltInTools: "blocked",
      rateLimitTier: "standard",
    },
  },
]

/**
 * Check if a model ID matches a pattern.
 *
 * For string patterns, both IDs are normalized (separators removed, lowercased).
 * For RegExp patterns, the pattern is tested against both the original and normalized ID.
 */
function matchesPattern(modelId: string, pattern: string | RegExp): boolean {
  if (typeof pattern === "string") {
    return normalizeProviderModelId(modelId) === normalizeProviderModelId(pattern)
  }
  // Test both original and normalized to handle variations
  return pattern.test(modelId) || pattern.test(normalizeProviderModelId(modelId))
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
 * Identity predicate (not a capability lookup): transform.ts uses it to pick
 * model-specific output-token and thinking-budget ceilings, which the
 * capability registry does not express. The detection logic lives in
 * qwen37-readiness.ts; this wrapper keeps the historical import path stable.
 *
 * @param modelId - The model identifier
 * @returns true if the model is Qwen 3.7 Max
 */
export function isQwen37MaxModel(modelId: string): boolean {
  return isQwen37MaxReadinessModel(modelId)
}

/**
 * Check if a model is Qwen 3.7 Plus.
 *
 * Identity predicate (not a capability lookup) — see isQwen37MaxModel.
 *
 * @param modelId - The model identifier
 * @returns true if the model is Qwen 3.7 Plus
 */
export function isQwen37PlusModel(modelId: string): boolean {
  return isQwen37PlusReadinessModel(modelId)
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
