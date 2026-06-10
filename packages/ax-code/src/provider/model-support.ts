const GLM_MAJOR_VERSION = /glm-(\d+)/
const GROK_ALLOWED_FINAL_SEGMENTS = new Set<string>([
  "grok-4.3",
  "grok-4-3",
  "grok-code-fast-1",
  "grok-code-fast",
  "grok-code-fast-1-0825",
  "grok-build-0.1",
])
const GLM_PROVIDER_IDS = new Set(["zhipuai", "zhipuai-coding-plan", "zai", "zai-coding-plan"])

type ModelSupportProbeInput = {
  id?: unknown
  name?: unknown
  family?: unknown
}

export const OPENROUTER_SUPPORTED_MODEL_IDS = [
  "openrouter/auto",
  "minimax/minimax-m3",
  "mistralai/mistral-medium-3-5",
  "inclusionai/ring-2.6-1t",
] as const

const OPENROUTER_SUPPORTED_MODEL_ID_SET = new Set<string>(OPENROUTER_SUPPORTED_MODEL_IDS)

export function supportsOpenRouterModelID(modelID: string) {
  return OPENROUTER_SUPPORTED_MODEL_ID_SET.has(modelID.toLowerCase().trim())
}

function parseModelProbes(value: string) {
  const lower = value.toLowerCase().trim()
  const normalized = lower.replace(/[\s_]+/g, "-")
  return [lower, normalized, normalized.replaceAll("-", "")]
}

export function buildModelProbes(modelID: string, model?: { id?: unknown; name?: unknown; family?: unknown }) {
  return [modelID, model?.id, model?.name, model?.family]
    .filter((value): value is string => typeof value === "string")
    .flatMap(parseModelProbes)
}

export function isModelSupportedForProvider(providerID: string, modelID: string, model?: ModelSupportProbeInput) {
  const probes = buildModelProbes(modelID, model)
  const lower = probes[0] ?? modelID.toLowerCase()
  if (probes.some((probe) => probe.includes("gpt-5.5") || probe.includes("gpt-5-5") || probe.includes("gpt55"))) {
    return false
  }
  if (providerID === "openrouter") return supportsOpenRouterModelID(modelID)
  if (providerID === "google" || providerID === "google-vertex") {
    if (!lower.includes("gemini")) return true
    return lower.includes("gemini-3")
  }
  if (providerID === "openai") {
    return supportsOpenAIGptModels(probes)
  }
  if (providerID === "xai") {
    return supportsGrok41OrAllowedCodingModel(probes)
  }
  if (GLM_PROVIDER_IDS.has(providerID)) {
    return supportsGlmModels(probes)
  }
  return true
}

function hasGlmMajorVersionAtLeastFive(probes: readonly string[]) {
  for (const probe of probes) {
    const m = probe.match(GLM_MAJOR_VERSION)
    if (!m) continue
    const major = Number.parseInt(m[1], 10)
    if (major >= 5) return true
  }
  return false
}

export function supportsOpenAIGptModels(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("gpt"))) return true
  if (probes.some((probe) => probe.includes("gpt-oss"))) return true
  if (probes.some((probe) => probe.includes("gpt-5.5") || probe.includes("gpt-5-5") || probe.includes("gpt55")))
    return false
  return probes.some((probe) => probe.includes("gpt-4") || probe.includes("gpt-5"))
}

// Grok allow-list: only explicitly validated Grok coding/chat models are kept.
// Everything else (4.2/4.1/4.0, betas, unversioned aliases) is dropped.
// Final-segment match so reseller-prefixed ids like "x-ai/grok-4.3" still
// resolve.
export function supportsGrok41OrAllowedCodingModel(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("grok"))) return true
  return probes.some((probe) => GROK_ALLOWED_FINAL_SEGMENTS.has(probe.split("/").pop() ?? ""))
}

export function supportsGlmModels(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("glm"))) return true
  if (probes.some((probe) => probe.includes("glm-5v") || probe.includes("glm5v"))) return false
  // Allow non-vision GLM 5 and any future GLM N≥5. Drops glm-5v and glm-3.x / glm-4.x.
  return hasGlmMajorVersionAtLeastFive(probes)
}
