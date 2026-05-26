#!/usr/bin/env bun

/**
 * Fetches the latest model data from models.dev and updates the local snapshot.
 * Preserves local-only provider entries (CLI wrappers and offline providers)
 * that aren't in the upstream API.
 *
 * Usage:
 *   bun run script/update-models.ts
 *   # or via pre-commit hook (auto-runs before each commit)
 */

import path from "path"
import { fileURLToPath } from "url"
import { supportsOpenRouterModelID } from "../src/provider/model-support"

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const snapshotPath = process.env.AX_CODE_MODELS_SNAPSHOT_PATH || path.join(dir, "src/provider/models-snapshot.json")
const modelsUrl = process.env.AX_CODE_MODELS_URL || "https://models.dev"
const modelsFixturePath = process.env.AX_CODE_MODELS_FIXTURE_PATH

async function loadFetchedModels(): Promise<Record<string, any>> {
  if (modelsFixturePath) {
    console.log(`Fetching models from ${modelsFixturePath} ...`)
    return Bun.file(modelsFixturePath).json()
  }

  console.log(`Fetching models from ${modelsUrl}/api.json ...`)
  return fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .catch((err) => {
      console.error(`Failed to fetch models: ${err.message}`)
      process.exit(0) // don't block commit if network is down
    })
}

const fetched = await loadFetchedModels()

const existing = await Bun.file(snapshotPath)
  .json()
  .catch(() => ({}))

// Preserve local-only provider entries that models.dev doesn't include
const localProviderIDs = ["claude-code", "gemini-cli", "codex-cli", "ollama", "ax-serving"]
for (const id of localProviderIDs) {
  if (existing[id] && !fetched[id]) fetched[id] = existing[id]
}

// Remove providers we don't support
for (const id of [
  "groq",
  "azure",
  "azure-cognitive-services",
  "moonshotai",
  "moonshotai-cn",
  "kimi-for-coding",
  "alibaba",
  "alibaba-cn",
  "zai",
]) {
  delete fetched[id]
}

// Strip unsupported models from every remaining provider — multi-host
// resellers (openrouter, novita, vercel, baseten, chutes, nano-gpt, …)
// surface the same upstream models, so a single filter catches all
// hosting variants. Probes match against family, id, and name because
// models.dev tags inconsistently across providers.
//
//   - Kimi (Moonshot): only the kimi-k2.6 version via the Alibaba plan.
//   - Grok: only grok-4.3 plus the grok-code-fast-1 coding model.
//     All other Grok variants (4.2/4.1, 4.0, beta aliases, 2/3) drop.
//   - GLM (Z.AI): only non-vision v5+ (glm-5v and every glm-4.x / glm-3.x drop).
//   - Gemini: only v3+ (Gemini 1.x/2.x drops from ax-code's model picker).
//   - GPT-5.5: hidden from API/provider model pickers; use Codex CLI default instead.
//
// To extend: add another entry to UNSUPPORTED_PROBES.
type RawModel = { family?: string; id?: string; name?: string }
function normalizeModelProbe(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, "-")
}
function probesOf(m: RawModel): string[] {
  return [m.family, m.id, m.name]
    .filter((s): s is string => typeof s === "string")
    .flatMap((s) => {
      const lower = s.toLowerCase()
      const normalized = normalizeModelProbe(lower)
      return [lower, normalized, normalized.replaceAll("-", "")]
    })
}
function isGrokProbe(probe: string): boolean {
  return /(^|[^a-z0-9])grok([^a-z0-9]|$)/.test(probe) || probe.includes("grok-")
}
// Grok allow-list. Only these exact final-segment ids survive the unsupported
// filter — every other grok variant (older versions, beta aliases, vision-only,
// etc.) is dropped. Match on the final segment so account-prefixed reseller ids
// (e.g. "x-ai/grok-4.3") still resolve correctly.
const GROK_ALLOWED_FINAL_SEGMENTS = new Set<string>(["grok-4.3", "grok-4-3", "grok-code-fast-1"])
function isAllowedGrokProbe(probe: string): boolean {
  return GROK_ALLOWED_FINAL_SEGMENTS.has(probe.split("/").pop() ?? "")
}
// Kimi models are dropped across the board, except for an explicit allow-list of
// versions that we want to surface (these are served through Alibaba's coding/token
// plan). The allow-list match is exact on the final id segment so partial aliases
// (kimi-k2.6-vision-preview, etc.) keep getting filtered out.
const KIMI_ALLOWED_FINAL_SEGMENTS = new Set<string>(["kimi-k2.6"])
function isAllowedKimiProbe(probe: string): boolean {
  return KIMI_ALLOWED_FINAL_SEGMENTS.has(probe.split("/").pop() ?? "")
}
function isUnsupportedModel(m: RawModel): boolean {
  const probes = probesOf(m)
  // Kimi: drop anything tagged kimi unless an allow-listed version matches.
  if (probes.some((p) => p.includes("kimi"))) {
    if (!probes.some(isAllowedKimiProbe)) return true
  }
  // Grok: drop unless an allow-listed final-segment id matches.
  if (probes.some(isGrokProbe)) {
    if (!probes.some(isAllowedGrokProbe)) return true
  }
  // GLM: drop if any probe mentions glm-N where N < 5.
  if (probes.some((p) => p.includes("glm-5v") || p.includes("glm5v"))) return true
  if (probes.some((p) => /\bglm-[0-4]\b/.test(p))) return true
  // Gemini: drop any Gemini generation before 3.
  if (probes.some((p) => /\bgemini-[12](?:\.|-)/.test(p))) return true
  // GPT-5.5: do not expose via API/provider pickers; Codex CLI owns the default model choice.
  if (probes.some((p) => p.includes("gpt-5.5") || p.includes("gpt-5-5") || p.includes("gpt55"))) return true
  return false
}
for (const [providerID, provider] of Object.entries(fetched) as Array<
  [string, { models?: Record<string, RawModel> }]
>) {
  if (!provider.models) continue
  for (const [mid, model] of Object.entries(provider.models)) {
    if (providerID === "openrouter" && !supportsOpenRouterModelID(mid)) {
      delete provider.models[mid]
      continue
    }
    if (isUnsupportedModel(model)) delete provider.models[mid]
  }
}

function cloneProvider(sourceID: string, targetID: string, overrides: { name: string; api: string; env: string[] }) {
  const source = fetched[sourceID]
  if (!source) return
  fetched[targetID] = {
    ...JSON.parse(JSON.stringify(source)),
    id: targetID,
    ...overrides,
  }
}

cloneProvider("alibaba-coding-plan", "alibaba-token-plan", {
  name: "Alibaba Token Plan",
  api: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  env: ["ALIBABA_TOKEN_PLAN_INTL_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
})
cloneProvider("alibaba-coding-plan-cn", "alibaba-token-plan-cn", {
  name: "Alibaba Token Plan (China)",
  api: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  env: ["ALIBABA_TOKEN_PLAN_CN_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
})

// Trim Alibaba plan providers to the curated set of chat/reasoning/image models
// served through the plan. Entries that models.dev hasn't published yet are
// silently skipped — the whitelist is forward-looking so they appear automatically
// once upstream catches up. Image models (qwen-image-*, wan*) are kept here per
// product intent even though ax-code's chat picker can't drive image generation
// — they show up so callers using the provider via SDK / API can pick them.
const alibabaModels = [
  // Qwen text / reasoning
  "qwen3.7-max",
  "qwen3.6-plus",
  "qwen3.6-flash",
  // DeepSeek text / reasoning
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  // Other vendors aggregated under the Alibaba plan
  "kimi-k2.6",
  "glm-5.1",
  // Qwen image generation
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  // Wan image generation
  "wan2.7-image",
  "wan2.7-image-pro",
]
const alibabaModelFallbackProviders: Record<string, string[]> = {
  "qwen3.6-flash": ["aihubmix"],
  "deepseek-v4-pro": ["auriko", "cortecs", "302ai", "llmgateway"],
  "deepseek-v4-flash": ["cortecs", "auriko", "302ai", "llmgateway"],
  "kimi-k2.6": ["moonshot", "moonshot-cn", "302ai", "llmgateway"],
  "glm-5.1": ["zai-coding-plan", "zhipuai", "auriko", "302ai"],
}
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  if (!fetched[id]) continue
  const models = fetched[id].models ?? {}
  const kept: Record<string, unknown> = {}
  for (const mid of alibabaModels) {
    if (models[mid]) kept[mid] = models[mid]
    if (kept[mid]) continue

    const existingModel = existing[id]?.models?.[mid]
    if (existingModel) {
      kept[mid] = JSON.parse(JSON.stringify(existingModel))
      continue
    }

    for (const fallbackID of alibabaModelFallbackProviders[mid] ?? []) {
      const fallback = fetched[fallbackID]?.models?.[mid] ?? existing[fallbackID]?.models?.[mid]
      if (!fallback) continue
      kept[mid] = JSON.parse(JSON.stringify(fallback))
      break
    }
  }
  fetched[id].models = kept
}

// xAI ships grok-code-fast-1 as a permanent coding model, but models.dev
// intermittently omits it from the xai provider block (it shows up only on
// resellers like helicone and github-copilot). Re-inject from the existing
// local snapshot or, failing that, from a known-good reseller — otherwise
// regenerating the snapshot can silently drop xAI's coding model from the
// picker between releases.
const xaiInjectedModels = ["grok-code-fast-1"]
const xaiInjectFallbackProviders = ["helicone", "github-copilot"]
if (fetched["xai"]?.models) {
  const xaiModels = fetched["xai"].models as Record<string, RawModel>
  for (const mid of xaiInjectedModels) {
    if (xaiModels[mid]) continue
    const fromExisting = existing["xai"]?.models?.[mid]
    if (fromExisting) {
      xaiModels[mid] = JSON.parse(JSON.stringify(fromExisting))
      continue
    }
    for (const fbID of xaiInjectFallbackProviders) {
      const fb = fetched[fbID]?.models?.[mid] ?? existing[fbID]?.models?.[mid]
      if (!fb) continue
      xaiModels[mid] = JSON.parse(JSON.stringify(fb))
      break
    }
  }
}

// Strip cost fields from every model — cost telemetry is removed from
// ax-code, and zod will silently drop these on parse anyway. Removing them
// here keeps the snapshot small and prevents the pre-commit hook from
// re-introducing thousands of dead JSON entries on each regeneration.
// Also strips nested experimental.modes.<name>.cost which models.dev uses
// to surface alternate-mode pricing.
type ModelEntry = {
  cost?: unknown
  experimental?: { modes?: Record<string, { cost?: unknown }> } | unknown
}
for (const provider of Object.values(fetched) as Array<{ models?: Record<string, ModelEntry> }>) {
  for (const model of Object.values(provider.models ?? {})) {
    delete model.cost
    const experimental = model.experimental
    if (experimental && typeof experimental === "object" && "modes" in experimental) {
      const modes = (experimental as { modes?: Record<string, { cost?: unknown }> }).modes
      for (const mode of Object.values(modes ?? {})) {
        delete mode.cost
      }
    }
  }
}

// Apply display name overrides
const nameOverrides: Record<string, string> = {}
for (const [id, name] of Object.entries(nameOverrides)) {
  if (fetched[id]) fetched[id].name = name
}

const apiOverrides: Record<string, string> = {
  "alibaba-coding-plan": "https://coding-intl.dashscope.aliyuncs.com/v1",
  "alibaba-coding-plan-cn": "https://coding.dashscope.aliyuncs.com/v1",
  "alibaba-token-plan": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  "alibaba-token-plan-cn": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
}
for (const [id, api] of Object.entries(apiOverrides)) {
  if (fetched[id]) fetched[id].api = api
}

const docOverrides: Record<string, string> = {
  "alibaba-token-plan": "https://www.alibabacloud.com/help/en/model-studio/opencode-token-plan",
  "alibaba-token-plan-cn": "https://help.aliyun.com/zh/model-studio/opencode-token-plan",
}
for (const [id, doc] of Object.entries(docOverrides)) {
  if (fetched[id]) fetched[id].doc = doc
}

// Force attachment=true on Alibaba multimodal chat models. models.dev reports
// these with input modalities ["text","image","video"] but attachment=false,
// which leaves ax-code's picker refusing image uploads even though the upstream
// API accepts them. Override here so the capability flag matches the modality.
const alibabaAttachmentForceTrue = ["qwen3.6-plus"]
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  const models = fetched[id]?.models as Record<string, { attachment?: boolean }> | undefined
  if (!models) continue
  for (const mid of alibabaAttachmentForceTrue) {
    const model = models[mid]
    if (model) model.attachment = true
  }
}

// Mark models that have native server-side web search wired in ax-code with a
// 🌐 suffix on their display name so the model picker shows the capability at
// a glance. The suffix is applied to the `name` field only; ids stay stable.
// Re-applied on every regeneration via the endsWith guard so we don't end up
// with "... 🌐 🌐". Other capabilities are NOT marked — this is a deliberate
// narrow opt-in, not a general capability-badge system.
const SEARCH_MARKER = " 🌐"
const LEGACY_SEARCH_PREFIX = "🌐 "
function markSearch(model: { name?: string } | undefined) {
  if (!model?.name) return
  // Clean up any legacy prefix from an earlier marker placement, otherwise we
  // end up with "🌐 Foo 🌐" after the switch from prefix to suffix.
  if (model.name.startsWith(LEGACY_SEARCH_PREFIX)) {
    model.name = model.name.slice(LEGACY_SEARCH_PREFIX.length)
  }
  if (model.name.endsWith(SEARCH_MARKER)) return
  model.name = model.name + SEARCH_MARKER
}
// xAI: grok-4.3 and grok-code-fast-1 are the two allow-listed Grok models;
// both have Live Search wired via providerOptions.searchParameters.
const xaiSearchModelIds = ["grok-4.3", "grok-4-3", "grok-code-fast-1"]
const xaiModels = fetched["xai"]?.models as Record<string, { name?: string }> | undefined
if (xaiModels) {
  for (const mid of xaiSearchModelIds) markSearch(xaiModels[mid])
}
// Alibaba: every Qwen model on the four plan endpoints accepts `enable_search`.
// Non-Qwen models (DeepSeek/GLM/Kimi/MiniMax) served on the same plans don't
// honor the knob, so they stay unmarked.
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  const models = fetched[id]?.models as Record<string, { name?: string }> | undefined
  if (!models) continue
  for (const [mid, model] of Object.entries(models)) {
    if (mid.toLowerCase().startsWith("qwen")) markSearch(model)
  }
}

const envOverrides: Record<string, string[]> = {
  "alibaba-coding-plan": ["ALIBABA_CODING_PLAN_INTL_API_KEY", "ALIBABA_CODING_PLAN_API_KEY"],
  "alibaba-coding-plan-cn": ["ALIBABA_CODING_PLAN_CN_API_KEY", "ALIBABA_CODING_PLAN_API_KEY"],
  "alibaba-token-plan": ["ALIBABA_TOKEN_PLAN_INTL_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
  "alibaba-token-plan-cn": ["ALIBABA_TOKEN_PLAN_CN_API_KEY", "ALIBABA_TOKEN_PLAN_API_KEY"],
}
for (const [id, env] of Object.entries(envOverrides)) {
  if (fetched[id]) fetched[id].env = env
}

// Rename ax-studio -> ax-serving if models.dev still uses old name
if (fetched["ax-studio"]) {
  const entry = fetched["ax-studio"]
  delete fetched["ax-studio"]
  entry.id = "ax-serving"
  entry.name = "AX Serving"
  entry.env = ["AX_SERVING_HOST"]
  fetched["ax-serving"] = entry
}

// Inject the 1M-context beta header on Claude models that declare
// limit.context: 1_000_000. models.dev publishes the limit but not the
// header that opts the request into the long-context beta — without the
// header, Anthropic caps the conversation at 200k tokens regardless of
// the snapshot. Re-applied on every regeneration so it survives upstream
// updates. Update the beta name when Anthropic ships a new revision.
const ANTHROPIC_1M_BETA = "context-1m-2025-08-07"
type AnthropicModel = {
  limit?: { context?: number }
  headers?: Record<string, string>
}
const anthropic = fetched["anthropic"] as { models?: Record<string, AnthropicModel> } | undefined
if (anthropic?.models) {
  for (const model of Object.values(anthropic.models)) {
    if (model.limit?.context !== 1_000_000) continue
    const existingBeta = model.headers?.["anthropic-beta"]
    // Trim guards against an empty / whitespace-only upstream value, which
    // would otherwise be preserved verbatim and silently disable the beta.
    const trimmed = existingBeta?.trim()
    const merged = trimmed
      ? trimmed
          .split(",")
          .map((s) => s.trim())
          .includes(ANTHROPIC_1M_BETA)
        ? trimmed
        : `${trimmed},${ANTHROPIC_1M_BETA}`
      : ANTHROPIC_1M_BETA
    model.headers = { ...(model.headers ?? {}), "anthropic-beta": merged }
  }
}

const prev = JSON.stringify(existing)
const next = JSON.stringify(fetched, null, 2) + "\n"

if (prev === JSON.stringify(fetched)) {
  console.log("models-snapshot.json is already up to date")
} else {
  await Bun.write(snapshotPath, next)
  console.log("Updated models-snapshot.json")
}
