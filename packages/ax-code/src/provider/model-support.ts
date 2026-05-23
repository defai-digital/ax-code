const GLM_MAJOR_VERSION = /glm-(\d+)/
const GROK_MAJOR_MINOR_VERSION = /grok-(\d+)(?:[.-]?(\d+))?/

export const OPENROUTER_SUPPORTED_MODEL_IDS = [
  "openrouter/auto",
  "openai/gpt-5.1-codex",
  "openai/gpt-5.1-codex-mini",
  "openai/gpt-5.1-codex-max",
  "openai/gpt-5-codex",
  "openai/gpt-5.2-codex",
  "openai/gpt-5.3-codex",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.7",
  "x-ai/grok-4.3",
  "moonshotai/kimi-k2.6",
  "z-ai/glm-5.1",
  "deepseek/deepseek-v4-pro",
  "qwen/qwen3-coder",
  "qwen/qwen3.6-plus",
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

export function supportsGrok41OrAllowedCodingModel(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("grok"))) return true
  if (
    probes.some((probe) => {
      const finalSegment = probe.split("/").pop()
      return finalSegment === "grok-4.1" || finalSegment === "grok-4-1"
    })
  )
    return false
  if (probes.some((probe) => probe.split("/").pop() === "grok-code-fast-1")) return true
  // Allow Grok 4.1 and any future Grok N>4. Parsing major/minor
  // avoids keeping Grok 4.0 variants like grok-4, grok-4-fast, or
  // other unversioned grok-code-* aliases.
  for (const probe of probes) {
    const m = probe.match(GROK_MAJOR_MINOR_VERSION)
    if (!m) continue
    const major = Number(m[1])
    const minor = m[2] === undefined ? 0 : Number(m[2])
    if (major > 4 || (major === 4 && minor >= 1)) return true
  }
  return false // grok-beta, grok-vision-beta — no 4.1+ version, drop
}

export function supportsGlmModels(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("glm"))) return true
  if (probes.some((probe) => probe.includes("glm-5v") || probe.includes("glm5v"))) return false
  // Allow non-vision GLM 5 and any future GLM N≥5. Drops glm-5v and glm-3.x / glm-4.x.
  return hasGlmMajorVersionAtLeastFive(probes)
}
