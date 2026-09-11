import { modelIdFinalSegment } from "./model-id"

// Word boundary before `glm` so embedded tokens (chatglm-*, someglm*) don't
// match, and a single captured digit so fully-squashed spellings ("glm52")
// resolve to major 5 instead of 52.
const GLM_MAJOR_VERSION = /(?:^|[^a-z0-9])glm-?(\d)/
const GLM_HIDDEN_FINAL_SEGMENTS = new Set<string>([
  "glm-5.1",
  "glm-5-1",
  "glm-5.1[1m]",
  "glm-5.1-1m",
  "glm-5-turbo",
  // No-separator forms reached via dash-stripped probes (e.g. "glm5.2-fast").
  "glm5.1",
  "glm51",
  "glm5.1[1m]",
  "glm5.11m",
  "glm5turbo",
])
const GLM_HIDDEN_FINAL_PATTERN = /(?:^|[^a-z0-9])glm-?5[.-]1(?:$|[^0-9])/
const GLM_PROVIDER_IDS = new Set(["zhipuai", "zhipuai-coding-plan", "zai", "zai-coding-plan"])
const ALIBABA_PLAN_PROVIDER_IDS = new Set([
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
])
const MINIMAX_PLAN_PROVIDER_IDS = new Set(["minimax-coding-plan", "minimax-cn-coding-plan"])
export const GROQ_CHAT_MODEL_ALLOWLIST = new Set<string>([
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
])

type ModelSupportProbeInput = {
  id?: unknown
  name?: unknown
  family?: unknown
}

function catalogSku(value: string) {
  return modelIdFinalSegment(value)
    .toLowerCase()
    .replace(/:\w+$/, "")
    .replace(/@[\w-]+$/, "")
    .replace(/\[\d+[mM]\]$/, "")
}

const HIDDEN_CATALOG_SKUS = new Set([
  "deepseek-v4-flash",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5-2",
  "gpt-5-2-codex",
  "glm-5.2",
  "glm-5-2",
  "minimax-m2.5",
  "glm-5.3-highspeed",
])

export function isHiddenCatalogSku(modelID: string, model?: ModelSupportProbeInput) {
  return [modelID, model?.id]
    .filter((value): value is string => typeof value === "string")
    .some((value) => HIDDEN_CATALOG_SKUS.has(catalogSku(value)))
}

type Version = { major: number; minor: number }

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

function versionAtLeast(version: Version, floor: Version) {
  return version.major > floor.major || (version.major === floor.major && version.minor >= floor.minor)
}

function maxVersion(versions: readonly Version[]): Version | undefined {
  return versions.reduce<Version | undefined>((best, version) => {
    if (!best || versionAtLeast(version, best)) return version
    return best
  }, undefined)
}

function parseGeminiVersion(probe: string): Version | undefined {
  const withMinor = probe.match(/(?:^|[^a-z0-9])gemini-?(\d+)[.-](\d+)/)
  if (withMinor) return { major: Number.parseInt(withMinor[1], 10), minor: Number.parseInt(withMinor[2], 10) }
  const majorOnly = probe.match(/(?:^|[^a-z0-9])gemini-?(\d+)(?:$|[^0-9.])/)
  if (majorOnly && majorOnly[1].length === 1) return { major: Number.parseInt(majorOnly[1], 10), minor: 0 }
}

function isGeminiBelow38(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("gemini"))) return false
  const version = maxVersion(probes.map(parseGeminiVersion).filter((value): value is Version => value !== undefined))
  if (!version) return true
  return !versionAtLeast(version, { major: 3, minor: 8 })
}

function parseMuseSparkVersion(probe: string): Version | undefined {
  const match = probe.match(/(?:^|[^a-z0-9])muse-spark-(\d+)\.(\d+)/)
  if (!match) return
  return { major: Number.parseInt(match[1], 10), minor: Number.parseInt(match[2], 10) }
}

function isMuseSparkBelow13(probes: readonly string[]) {
  const version = maxVersion(probes.map(parseMuseSparkVersion).filter((value): value is Version => value !== undefined))
  if (!version) return false
  return !versionAtLeast(version, { major: 1, minor: 3 })
}

function isDeepseekFlashVisionExp(probes: readonly string[]) {
  return probes.some((probe) => probe.includes("flash-vision-exp") || probe.includes("flashvisionexp"))
}

function parseGlmVersion(probe: string): Version | undefined {
  const pForm = probe.match(/(?:^|[^a-z0-9])glm-?(\d+)p(\d+)/)
  if (pForm) return { major: Number.parseInt(pForm[1], 10), minor: Number.parseInt(pForm[2], 10) }
  const dotted = probe.match(/(?:^|[^a-z0-9])glm-?(\d+)\.(\d+)/)
  if (dotted) return { major: Number.parseInt(dotted[1], 10), minor: Number.parseInt(dotted[2], 10) }
  const dashed = probe.match(/(?:^|[^a-z0-9])glm-(\d+)-(\d+)(?:$|[^0-9])/)
  if (dashed) return { major: Number.parseInt(dashed[1], 10), minor: Number.parseInt(dashed[2], 10) }
  const majorOnly = probe.match(/(?:^|[^a-z0-9])glm-?(\d+)(?:$|[^0-9p.])/)
  if (majorOnly && majorOnly[1].length === 1) return { major: Number.parseInt(majorOnly[1], 10), minor: 0 }
}

function isGlmBelow53(probes: readonly string[]) {
  const version = maxVersion(probes.map(parseGlmVersion).filter((value): value is Version => value !== undefined))
  if (!version) return true
  return !versionAtLeast(version, { major: 5, minor: 3 })
}

function isAlibabaQwenBelow37Plus(modelID: string, probes: readonly string[]) {
  const haystack = [modelIdFinalSegment(modelID), ...probes].join(" ")
  if (/qwen3[.-]?7/.test(haystack) || /qwen3[.-]?8/.test(haystack) || /qwen3-coder/.test(haystack)) return false
  return /qwen3[.-]?5/.test(haystack) || /qwen3[.-]?6/.test(haystack) || /qwen3-max/.test(haystack)
}

function isMinimaxM27Highspeed(modelID: string, probes: readonly string[]) {
  return [modelIdFinalSegment(modelID), ...probes].some((probe) => {
    const segment = modelIdFinalSegment(probe).toLowerCase()
    return segment === "minimax-m2.7-highspeed" || segment === "minimax-m27-highspeed"
  })
}

export function isModelSupportedForProvider(providerID: string, modelID: string, model?: ModelSupportProbeInput) {
  const probes = buildModelProbes(modelID, model)
  if (probes.some((probe) => probe.includes("gpt-5.5") || probe.includes("gpt-5-5") || probe.includes("gpt55"))) {
    return false
  }
  // Embedding models cannot serve chat/agent traffic, but upstream catalogs
  // (e.g. Hugging Face via models.dev) list them alongside chat models.
  // Selecting one would fail on the first request, so hide them everywhere.
  if (probes.some((probe) => probe.includes("embedding") || probe.includes("embed-"))) {
    return false
  }
  if (isHiddenCatalogSku(modelID, model)) return false
  if (isGeminiBelow38(probes)) return false
  if (isDeepseekFlashVisionExp(probes)) return false
  if (isMuseSparkBelow13(probes)) return false
  if (providerID === "groq") {
    const segment = modelIdFinalSegment(modelID).toLowerCase()
    if (segment === "qwen3.6-27b" || segment === "gpt-oss-safeguard-20b") return false
    if (probes.some((probe) => probe.includes("qwen3.6-27b") || probe.includes("gpt-oss-safeguard-20b"))) return false
  }
  if (MINIMAX_PLAN_PROVIDER_IDS.has(providerID) && isMinimaxM27Highspeed(modelID, probes)) return false
  if (ALIBABA_PLAN_PROVIDER_IDS.has(providerID) && isAlibabaQwenBelow37Plus(modelID, probes)) return false
  if (providerID === "google" || providerID === "google-vertex") {
    if (!probes.some((probe) => probe.includes("gemini"))) return true
    return !isGeminiBelow38(probes)
  }
  if (providerID === "openai") {
    return supportsOpenAIGptModels(probes)
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

// Semantic GLM major-version probe (shared with transform.ts's output-token
// gate). True when any probe spells a GLM with the exact given major version
// — e.g. probesHaveGlmMajorVersion(probes, 5) matches "glm-5.2" / "glm5.2"
// / "glm52" / "glm-5.1[1m]" but not "glm-4.7-flash", versionless aliases,
// or embedded tokens such as "chatglm-6".
export function probesHaveGlmMajorVersion(probes: readonly string[], major: number): boolean {
  for (const probe of probes) {
    const m = probe.match(GLM_MAJOR_VERSION)
    if (!m) continue
    if (Number.parseInt(m[1], 10) === major) return true
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

export function supportsGlmModels(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("glm"))) return true
  if (
    probes.some((probe) => {
      const finalSegment = modelIdFinalSegment(probe)
      return GLM_HIDDEN_FINAL_SEGMENTS.has(finalSegment) || GLM_HIDDEN_FINAL_PATTERN.test(finalSegment)
    })
  )
    return false
  // GLM vision SKUs (glm-5v today, glm-Nv in future releases) cannot serve
  // text-only agent traffic. Probes include a dash-stripped form, so /glm\d+v/
  // matches glm-5v, glm5v, and any future glm-6v across separator styles.
  if (probes.some((probe) => /glm\d+v/.test(probe))) return false
  // Z.AI / Zhipu pickers keep GLM 5.3 and newer. Older flagships including
  // glm-4.7 / glm-4.7-flash and glm-5 / glm-5.2 drop.
  if (isGlmBelow53(probes)) return false
  return hasGlmMajorVersionAtLeastFive(probes)
}
