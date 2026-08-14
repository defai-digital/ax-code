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
// Only Grok 4.5 and its official xAI aliases. Older Grok chat/coding SKUs are dropped.
const GROK_ALLOWED_FINAL_SEGMENTS = new Set<string>(["grok-4.5", "grok-4-5", "grok-4.5-latest", "grok-build-latest"])
const GLM_PROVIDER_IDS = new Set(["zhipuai", "zhipuai-coding-plan", "zai", "zai-coding-plan"])

type ModelSupportProbeInput = {
  id?: unknown
  name?: unknown
  family?: unknown
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
  if (probes.some((probe) => probe.includes("gpt-5.5") || probe.includes("gpt-5-5") || probe.includes("gpt55"))) {
    return false
  }
  // Embedding models cannot serve chat/agent traffic, but upstream catalogs
  // (e.g. Hugging Face via models.dev) list them alongside chat models.
  // Selecting one would fail on the first request, so hide them everywhere.
  if (probes.some((probe) => probe.includes("embedding") || probe.includes("embed-"))) {
    return false
  }
  if (providerID === "google" || providerID === "google-vertex") {
    if (!probes.some((probe) => probe.includes("gemini"))) return true
    return probes.some((probe) => probe.includes("gemini-3"))
  }
  if (providerID === "openai") {
    return supportsOpenAIGptModels(probes)
  }
  if (providerID === "xai") {
    return supportsAllowedGrokModel(probes)
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

// Grok allow-list: only Grok 4.5 (and official aliases). Final-segment match so
// reseller-prefixed ids like "x-ai/grok-4.5" still resolve.
export function supportsAllowedGrokModel(probes: readonly string[]) {
  if (!probes.some((probe) => probe.includes("grok"))) return true
  return probes.some((probe) => GROK_ALLOWED_FINAL_SEGMENTS.has(modelIdFinalSegment(probe)))
}

/** @deprecated Use {@link supportsAllowedGrokModel} — the allow-list is Grok 4.5, not 4.1. */
export const supportsGrok41OrAllowedCodingModel = supportsAllowedGrokModel

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
  // Allow selected non-vision GLM 5 and any future GLM N≥5. Drops hidden SKUs, glm-Nv, and glm-3.x / glm-4.x.
  return hasGlmMajorVersionAtLeastFive(probes)
}
