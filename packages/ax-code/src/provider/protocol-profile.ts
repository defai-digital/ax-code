import { modelIdFinalSegment } from "./model-id"
import { isDedicatedPrivateGpuProviderID } from "./private-gpu/presets"

type ProtocolModel = {
  providerID: string
  api: { id: string; url?: string; npm?: string }
  family?: string
  options?: Record<string, unknown>
}

// `glm5` is GLM 5.3 and every later 5.x release (5.4, 5.5, ...): one request
// contract (`reasoning_effort` low/high/max, server default max).
export type ChatReasoningFamily = "qwen3.8" | "glm5" | "deepseek-v4" | "minimax-m3" | "minimax-m2.7"
const families: readonly string[] = ["qwen3.8", "glm5", "deepseek-v4", "minimax-m3", "minimax-m2.7"]
// Config written before the family covered all of GLM 5.x.
const LEGACY_FAMILY_ALIASES: Record<string, ChatReasoningFamily> = { "glm5.3": "glm5" }

export function isKimiProtocol(model: ProtocolModel): boolean {
  if (["kimi-for-coding", "kimi-cloud-plan", "moonshotai", "moonshotai-cn"].includes(model.providerID)) return true
  if ([model.api.id, model.family].some((id) => /kimi|moonshot/i.test(id ?? ""))) return true
  try {
    const host = new URL(model.api.url ?? "").hostname
    return ["api.kimi.com", "api.moonshot.ai", "api.moonshot.cn", "api.moonshotai.cn"].includes(host)
  } catch {
    return false
  }
}

// GLM 5.3 is the first 5.x release with the current contract; 5.2 and older
// keep their own handling. FlashX (and its -legal SKU) shares the Flash
// settings; gateways may append a -free/-flex tier or a :tag / @version suffix,
// and may spell the minor with a hyphen or `p` (`glm-5-3`, `glm-5p3`).
const GLM5_SEGMENT = /^glm-5(?:[.-]|p)(\d{1,2})(?!\d)(?:-flash(?:x(?:-legal)?)?)?(?:-(?:free|flex))?(?:[:@].*)?$/
const GLM5_FIRST_MINOR = 3

/** Final model-id segment names a GLM 5.x SKU (5.3 or later) with the current reasoning contract. */
export function isGlm5ModelSegment(segment: string): boolean {
  const match = GLM5_SEGMENT.exec(segment.toLowerCase())
  return match !== null && Number(match[1]) >= GLM5_FIRST_MINOR
}

// MiniMax M3 family: M3, M3.1, M3.1-Flash, and later M3.x releases. M3 lets
// thinking be disabled; from M3.1 on thinking is always on and the API
// rejects `thinking: { type: "disabled" }` (verified on M3.1-Flash).
// Gateways also spell the minor `m3-1` / `m3p1`, and MiniMax's coding plan
// lists a `-Preview` SKU; quantized deployment suffixes (`-FP8`) stay out.
const MINIMAX_M3_SEGMENT = /^minimax-m3(?:(?:[.-]|p)\d{1,2}(?!\d))?(?:-flash)?(?:-preview)?$/

/** Final model-id segment names a MiniMax M3-family SKU. */
export function isMiniMaxM3ModelSegment(segment: string): boolean {
  return MINIMAX_M3_SEGMENT.test(segment.toLowerCase())
}

/**
 * M3.1 and later M3.x: thinking cannot be turned off. Matches inside the final
 * segment so deployment suffixes (`MiniMax-M3.1-Flash-FP8`) are covered, and
 * accepts the gateway spellings `minimax-m3-1-flash` and `minimax-m3p1-flash`.
 * The minor is at most two digits so a date-like tag (`-0601`) is not read as one.
 */
export function isMiniMaxThinkingForcedOn(modelId: string): boolean {
  const match = /(?:^|[^a-z0-9])minimax-m3(?:[.-]|p)(\d{1,2})(?!\d)/.exec(modelIdFinalSegment(modelId).toLowerCase())
  return match !== null && Number(match[1]) >= 1
}

/**
 * OpenRouter serves GLM 5.x behind its own `reasoning: { effort }` object
 * instead of Z.AI's `reasoning_effort`, so it is not part of the glm5 chat
 * family but still needs AX Code's GLM effort defaults.
 */
export function isOpenRouterGlm5(model: ProtocolModel): boolean {
  let host = ""
  try {
    host = new URL(model.api.url ?? "").hostname
  } catch {}
  const openrouter =
    model.providerID === "openrouter" || host === "openrouter.ai" || model.api.npm === "@openrouter/ai-sdk-provider"
  return openrouter && isGlm5ModelSegment(modelIdFinalSegment(model.api.id))
}

function reasoningFamily(model: ProtocolModel): ChatReasoningFamily | undefined {
  const explicit = model.options?.protocolProfile
  if (typeof explicit === "string" && LEGACY_FAMILY_ALIASES[explicit]) return LEGACY_FAMILY_ALIASES[explicit]
  if (typeof explicit === "string" && families.includes(explicit)) return explicit as ChatReasoningFamily
  if (explicit === "openai-compatible" || explicit === "dashscope") return undefined
  if (model.api.npm !== "@ai-sdk/openai-compatible" || model.options?.nativeReasoning === false) return undefined
  if (isDedicatedPrivateGpuProviderID(model.providerID)) return undefined
  if (
    [
      "ax-engine",
      "groq",
      "openrouter",
      "nvidia",
      "lilac",
      "ollama",
      "lmstudio",
      "mtplx",
      "omlx",
      "ax-studio",
      "local-llm",
    ].includes(model.providerID)
  )
    return undefined
  let host = ""
  try {
    host = new URL(model.api.url ?? "").hostname
    if (["openrouter.ai", "api.groq.com", "integrate.api.nvidia.com"].includes(host)) return undefined
  } catch {}
  const id = model.api.id.toLowerCase()
  const segment = modelIdFinalSegment(id)
  if (/^qwen3\.8-(?:max|flash)$/.test(segment)) return "qwen3.8"
  if (
    model.providerID.startsWith("alibaba-coding-plan") ||
    model.providerID.startsWith("alibaba-token-plan") ||
    ["alibaba", "alibaba-cn"].includes(model.providerID) ||
    host === "dashscope.aliyuncs.com" ||
    host.endsWith(".maas.aliyuncs.com") ||
    (host.startsWith("dashscope-") && host.endsWith(".aliyuncs.com"))
  )
    return undefined
  if (isGlm5ModelSegment(segment)) return "glm5"
  if (/^deepseek-(?:v4-(?:pro|flash)|flash)$/.test(id)) return "deepseek-v4"
  // Exact upstream ids only: vendor-namespaced repository ids
  // (`MiniMaxAI/MiniMax-M3`) are private deployments with <mm:think> tags.
  if (isMiniMaxM3ModelSegment(id)) return "minimax-m3"
  if (id === "minimax-m2.7") return id
  return undefined
}

export function resolveProtocolProfile(model: ProtocolModel) {
  const npm = model.api.npm ?? "@ai-sdk/openai-compatible"
  const family = reasoningFamily(model)
  const schemaDialect = isKimiProtocol(model)
    ? "moonshot"
    : model.providerID === "google" || model.api.id.includes("gemini")
      ? "gemini"
      : "json-schema"
  const providerOptionsKey =
    npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex"
      ? "google"
      : npm === "@ai-sdk/openai"
        ? "openai"
        : model.providerID.split(".")[0]?.trim() || model.providerID
  return Object.freeze({
    id: `${npm}:${family ?? "standard"}:${schemaDialect}`,
    revision: 1,
    adapter: npm,
    reasoningFamily: family,
    schemaDialect,
    providerOptionsKey,
  })
}
