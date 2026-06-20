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
import { readJson, writeText } from "./fs-compat"

const dir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const snapshotPath = process.env.AX_CODE_MODELS_SNAPSHOT_PATH || path.join(dir, "src/provider/models-snapshot.json")
const modelsUrl = process.env.AX_CODE_MODELS_URL || "https://models.dev"
const modelsFixturePath = process.env.AX_CODE_MODELS_FIXTURE_PATH

async function loadFetchedModels(): Promise<Record<string, any>> {
  if (modelsFixturePath) {
    console.log(`Fetching models from ${modelsFixturePath} ...`)
    return readJson(modelsFixturePath)
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

const existing = await readJson<Record<string, any>>(snapshotPath).catch((): Record<string, any> => ({}))

// Preserve local-only provider entries that models.dev doesn't include
const cliImageProviderIDs = ["claude-code", "gemini-cli", "codex-cli", "grok-build-cli", "qoder-cli"] as const
const localProviderIDs = ["ax-studio", ...cliImageProviderIDs, "ollama"]
for (const id of localProviderIDs) {
  if (existing[id] && !fetched[id]) fetched[id] = JSON.parse(JSON.stringify(existing[id]))
}
if (fetched["ax-serving"] && !fetched["ax-studio"]) {
  fetched["ax-studio"] = JSON.parse(JSON.stringify(fetched["ax-serving"]))
}
if (!fetched["ax-studio"]) {
  fetched["ax-studio"] = {
    id: "ax-studio",
    name: "AX Studio",
    env: ["AX_STUDIO_HOST"],
    npm: "@ai-sdk/openai-compatible",
    api: "http://localhost:18080/v1",
    doc: "https://github.com/defai-digital/ax-studio",
    models: {},
  }
}
fetched["ax-studio"].id = "ax-studio"
fetched["ax-studio"].name = "AX Studio"
fetched["ax-studio"].env = ["AX_STUDIO_HOST"]
fetched["ax-studio"].npm = "@ai-sdk/openai-compatible"
fetched["ax-studio"].doc = "https://github.com/defai-digital/ax-studio"
if (!fetched["grok-build-cli"]) {
  fetched["grok-build-cli"] = {
    id: "grok-build-cli",
    name: "Grok Build CLI",
    env: [],
    npm: "cli",
    models: {
      "grok-build-cli": {
        id: "grok-build-cli",
        name: "Grok Build CLI",
        family: "grok",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-04-16",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 256000,
          output: 10000,
        },
        options: {},
        status: "active",
      },
    },
  }
}
if (!fetched["grok-build-cli"].models?.["grok-build-cli"]) {
  fetched["grok-build-cli"].models = {
    ...(fetched["grok-build-cli"].models ?? {}),
    "grok-build-cli": {
      id: "grok-build-cli",
      name: "Grok Build CLI",
      family: "grok",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-04-16",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 256000,
        output: 10000,
      },
      options: {},
      status: "active",
    },
  }
}
if (!fetched["qoder-cli"]) {
  fetched["qoder-cli"] = {
    id: "qoder-cli",
    name: "Qoder CLI",
    env: [],
    npm: "cli",
    models: {
      "qoder-cli": {
        id: "qoder-cli",
        name: "Qoder CLI",
        family: "qoder",
        attachment: true,
        reasoning: false,
        tool_call: false,
        temperature: false,
        release_date: "2026-06-01",
        modalities: {
          input: ["text", "image"],
          output: ["text"],
        },
        limit: {
          context: 200000,
          output: 16384,
        },
        options: {},
        status: "active",
      },
    },
  }
}
if (!fetched["qoder-cli"].models?.["qoder-cli"]) {
  fetched["qoder-cli"].models = {
    ...(fetched["qoder-cli"].models ?? {}),
    "qoder-cli": {
      id: "qoder-cli",
      name: "Qoder CLI",
      family: "qoder",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-06-01",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 200000,
        output: 16384,
      },
      options: {},
      status: "active",
    },
  }
}

// Remove providers we don't support
const removedProviderSources = Object.fromEntries(
  ["moonshotai", "moonshotai-cn", "kimi-for-coding"].flatMap((id) =>
    fetched[id] ? [[id, JSON.parse(JSON.stringify(fetched[id]))]] : [],
  ),
)
for (const id of [
  "groq",
  "azure",
  "azure-cognitive-services",
  "openrouter",
  "lmstudio",
  "ax-serving",
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
// resellers (novita, vercel, baseten, chutes, nano-gpt, ...)
// surface the same upstream models, so a single filter catches all
// hosting variants. Probes match against family, id, and name because
// models.dev tags inconsistently across providers.
//
//   - Kimi (Moonshot): only the kimi-k2.6 version via the Alibaba plan.
//   - Grok: only grok-4.3 plus the Grok Build coding model aliases.
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
const GROK_ALLOWED_FINAL_SEGMENTS = new Set<string>([
  "grok-4.3",
  "grok-4-3",
  "grok-code-fast-1",
  "grok-code-fast",
  "grok-code-fast-1-0825",
  "grok-build-0.1",
  "grok-build-cli",
])
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
    if (mid.toLowerCase().startsWith("openrouter/") || model.id?.toLowerCase().startsWith("openrouter/")) {
      delete provider.models[mid]
      continue
    }
    if (isUnsupportedModel(model)) delete provider.models[mid]
  }
}

if (!fetched["grok-build-cli"].models?.["grok-build-cli"]) {
  fetched["grok-build-cli"].models = {
    ...(fetched["grok-build-cli"].models ?? {}),
    "grok-build-cli": {
      id: "grok-build-cli",
      name: "Grok Build CLI",
      family: "grok",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-04-16",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 256000,
        output: 10000,
      },
      options: {},
      status: "active",
    },
  }
}
if (!fetched["qoder-cli"].models?.["qoder-cli"]) {
  fetched["qoder-cli"].models = {
    ...(fetched["qoder-cli"].models ?? {}),
    "qoder-cli": {
      id: "qoder-cli",
      name: "Qoder CLI",
      family: "qoder",
      attachment: true,
      reasoning: false,
      tool_call: false,
      temperature: false,
      release_date: "2026-06-01",
      modalities: {
        input: ["text", "image"],
        output: ["text"],
      },
      limit: {
        context: 200000,
        output: 16384,
      },
      options: {},
      status: "active",
    },
  }
}

// CLI wrappers pass images as materialized temp-file paths/URLs to the wrapped
// assistant. Keep their model metadata aligned with that adapter path so the
// common provider transform does not downgrade image parts before the CLI runs.
for (const id of cliImageProviderIDs) {
  const provider = fetched[id]
  const model = provider?.models?.[id]
  if (!model) continue
  model.attachment = true
  const input = Array.isArray(model.modalities?.input) ? model.modalities.input : []
  model.modalities = {
    ...(model.modalities ?? {}),
    input: Array.from(new Set(["text", "image", ...input])),
    output: Array.isArray(model.modalities?.output) ? model.modalities.output : ["text"],
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
  "qwen3.7-plus",
  "qwen3.6-plus",
  "qwen3.6-flash",
  // DeepSeek text / reasoning
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  // Other vendors aggregated under the Alibaba plan
  "kimi-k2.6",
  // Qwen image generation
  "qwen-image-2.0",
  "qwen-image-2.0-pro",
  // Wan image generation
  "wan2.7-image",
  "wan2.7-image-pro",
]
const alibabaModelFallbackProviders: Record<string, string[]> = {
  "qwen3.7-plus": ["llmgateway", "opencode-go", "nano-gpt"],
  "qwen3.6-flash": ["aihubmix"],
  "deepseek-v4-pro": ["auriko", "cortecs", "302ai", "llmgateway"],
  "deepseek-v4-flash": ["cortecs", "auriko", "302ai", "llmgateway"],
  "kimi-k2.6": ["moonshot", "moonshot-cn", "302ai", "llmgateway"],
}
const alibabaModelFallbackDefaults: Record<string, RawModel> = {
  "qwen-image-2.0": alibabaImageModel("qwen-image-2.0", "Qwen Image 2.0", "qwen-image"),
  "qwen-image-2.0-pro": alibabaImageModel("qwen-image-2.0-pro", "Qwen Image 2.0 Pro", "qwen-image"),
  "wan2.7-image": alibabaImageModel("wan2.7-image", "Wan 2.7 Image", "wan"),
  "wan2.7-image-pro": alibabaImageModel("wan2.7-image-pro", "Wan 2.7 Image Pro", "wan"),
}
function alibabaImageModel(id: string, name: string, family: string): RawModel {
  return {
    id,
    name,
    family,
    attachment: false,
    reasoning: false,
    tool_call: false,
    temperature: true,
    release_date: "2026-06-10",
    modalities: {
      input: ["text"],
      output: ["image"],
    },
    open_weights: false,
    limit: {
      context: 8192,
      output: 1,
    },
    status: "active",
  } as RawModel
}
function withAlibabaModelFallbackDefault(mid: string, model: unknown) {
  const fallback = alibabaModelFallbackDefaults[mid]
  if (!fallback) return JSON.parse(JSON.stringify(model))
  return {
    ...JSON.parse(JSON.stringify(fallback)),
    ...JSON.parse(JSON.stringify(model)),
  }
}
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  if (!fetched[id]) continue
  const models = fetched[id].models ?? {}
  const kept: Record<string, unknown> = {}
  for (const mid of alibabaModels) {
    if (models[mid]) kept[mid] = withAlibabaModelFallbackDefault(mid, models[mid])
    if (kept[mid]) continue

    const existingModel = existing[id]?.models?.[mid]
    if (existingModel) {
      kept[mid] = withAlibabaModelFallbackDefault(mid, existingModel)
      continue
    }

    for (const fallbackID of alibabaModelFallbackProviders[mid] ?? []) {
      const fallback = fetched[fallbackID]?.models?.[mid] ?? existing[fallbackID]?.models?.[mid]
      if (!fallback) continue
      kept[mid] = withAlibabaModelFallbackDefault(mid, fallback)
      break
    }
    if (!kept[mid] && alibabaModelFallbackDefaults[mid]) {
      kept[mid] = JSON.parse(JSON.stringify(alibabaModelFallbackDefaults[mid]))
    }
  }
  fetched[id].models = kept
}

// Kimi Cloud Plan is a first-party Moonshot endpoint surfaced as a narrow plan
// provider. Keep it separate from the generic upstream Moonshot provider so the
// picker only shows the currently validated coding model instead of every legacy
// Kimi alias published by models.dev.
const kimiCloudPlanModels = ["kimi-k2.6"]
const kimiCloudPlanFallbackProviders: Record<string, string[]> = {
  "kimi-k2.6": [
    "moonshotai",
    "moonshotai-cn",
    "kimi-for-coding",
    "alibaba-coding-plan",
    "alibaba-token-plan",
    "llmgateway",
    "opencode",
  ],
}
const kimiCloudPlanID = "kimi-cloud-plan"
const kimiCloudPlanKept: Record<string, unknown> = {}
for (const mid of kimiCloudPlanModels) {
  for (const fallbackID of kimiCloudPlanFallbackProviders[mid] ?? []) {
    const fallback =
      fetched[fallbackID]?.models?.[mid] ??
      existing[fallbackID]?.models?.[mid] ??
      removedProviderSources[fallbackID]?.models?.[mid]
    if (!fallback) continue
    kimiCloudPlanKept[mid] = {
      ...JSON.parse(JSON.stringify(fallback)),
      id: mid,
      name: "Kimi K2.6",
      family: "kimi-k2.6",
    }
    break
  }
}
if (Object.keys(kimiCloudPlanKept).length > 0) {
  fetched[kimiCloudPlanID] = {
    id: kimiCloudPlanID,
    name: "Kimi Cloud Plan",
    env: ["KIMI_CLOUD_PLAN_API_KEY", "MOONSHOT_API_KEY"],
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.moonshot.ai/v1",
    doc: "https://platform.moonshot.ai/docs/api/chat",
    models: kimiCloudPlanKept,
  }
}

// xAI ships Grok Build as the canonical coding model name, with the older
// grok-code-fast ids as aliases. models.dev can lag or publish only reseller
// copies, so re-inject both the legacy alias and the canonical model into the
// xai provider block on every regeneration.
const XAI_LEGACY_CODING_MODEL_ID = "grok-code-fast-1"
const XAI_GROK_BUILD_MODEL_ID = "grok-build-0.1"
const xaiInjectedModels = [XAI_LEGACY_CODING_MODEL_ID]
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
  if (!xaiModels[XAI_GROK_BUILD_MODEL_ID]) {
    const source =
      existing["xai"]?.models?.[XAI_GROK_BUILD_MODEL_ID] ??
      xaiModels[XAI_LEGACY_CODING_MODEL_ID] ??
      existing["xai"]?.models?.[XAI_LEGACY_CODING_MODEL_ID]
    if (source) {
      xaiModels[XAI_GROK_BUILD_MODEL_ID] = {
        ...JSON.parse(JSON.stringify(source)),
        id: XAI_GROK_BUILD_MODEL_ID,
        name: "xAI Grok Build 0.1",
      }
    }
  }
}

// GLM flagship + 1M-context variants on the Z.AI coding-plan endpoints.
// Z.AI exposes a 1M-token window by appending a "[1m]" suffix to the model
// name (e.g. "glm-5.2[1m]"); the suffix is forwarded verbatim as the
// OpenAI-compatible `model` field, so it is just another model id to ax-code.
// models.dev publishes only the 200K base ids and GLM-5.2 is coding-plan-only
// at launch (general API / open weights ship later), so re-inject the GLM-5.2
// flagship plus the glm-5.2[1m] and glm-5.1[1m] long-context variants on every
// regeneration. Prefer the upstream entry when models.dev catches up; fall back
// to the template otherwise. Scoped to the coding providers where the [1m]
// suffix is documented (https://docs.z.ai/devpack/latest-model).
const GLM_CODING_PROVIDER_IDS = ["zai-coding-plan", "zhipuai-coding-plan"]
function glmCodingModel(id: string, name: string, context: number, releaseDate: string): RawModel {
  return {
    id,
    name,
    family: "glm",
    attachment: false,
    reasoning: true,
    reasoning_options: [{ type: "toggle" }],
    tool_call: true,
    interleaved: { field: "reasoning_content" },
    structured_output: true,
    temperature: true,
    release_date: releaseDate,
    last_updated: releaseDate,
    modalities: { input: ["text"], output: ["text"] },
    open_weights: false,
    limit: { context, output: 131072 },
  } as RawModel
}
const glmInjectedModels: Array<{ id: string; name: string; context: number; release: string }> = [
  { id: "glm-5.2", name: "GLM-5.2", context: 200000, release: "2026-06-13" },
  { id: "glm-5.2[1m]", name: "GLM-5.2 (1M context)", context: 1000000, release: "2026-06-13" },
  { id: "glm-5.1[1m]", name: "GLM-5.1 (1M context)", context: 1000000, release: "2026-03-27" },
]
for (const providerID of GLM_CODING_PROVIDER_IDS) {
  const provider = fetched[providerID]
  if (!provider) continue
  const models = (provider.models ?? {}) as Record<string, RawModel>
  const merged: Record<string, RawModel> = {}
  // Surface the injected ids first so they lead the model picker, preferring
  // any richer upstream metadata once models.dev publishes the base id.
  for (const m of glmInjectedModels) {
    merged[m.id] = models[m.id] ?? glmCodingModel(m.id, m.name, m.context, m.release)
  }
  for (const [mid, model] of Object.entries(models)) {
    if (!merged[mid]) merged[mid] = model
  }
  provider.models = merged
}

// General Zhipu AI API (open.bigmodel.cn/api/paas/v4) gets the GLM-5.2 base
// flagship only — the [1m] long-context variants stay scoped to the coding
// endpoints where the suffix is documented. The general API ships GLM-5.2
// shortly after the coding-plan launch, so inject it forward-looking until
// models.dev publishes it; prefer the upstream entry once it does.
{
  const provider = fetched["zhipuai"]
  if (provider) {
    const models = (provider.models ?? {}) as Record<string, RawModel>
    const merged: Record<string, RawModel> = {
      "glm-5.2": models["glm-5.2"] ?? glmCodingModel("glm-5.2", "GLM-5.2", 200000, "2026-06-13"),
    }
    for (const [mid, model] of Object.entries(models)) {
      if (!merged[mid]) merged[mid] = model
    }
    provider.models = merged
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
const nameOverrides: Record<string, string> = {
  xai: "Grok Cloud API",
}
for (const [id, name] of Object.entries(nameOverrides)) {
  if (fetched[id]) fetched[id].name = name
}

const apiOverrides: Record<string, string> = {
  "alibaba-coding-plan": "https://coding-intl.dashscope.aliyuncs.com/v1",
  "alibaba-coding-plan-cn": "https://coding.dashscope.aliyuncs.com/v1",
  "alibaba-token-plan": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  "alibaba-token-plan-cn": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  "ax-studio": "http://localhost:18080/v1",
  ollama: "http://localhost:11434/v1",
}
for (const [id, api] of Object.entries(apiOverrides)) {
  if (fetched[id]) fetched[id].api = api
}

const docOverrides: Record<string, string> = {
  "alibaba-token-plan": "https://www.alibabacloud.com/help/en/model-studio/opencode-token-plan",
  "alibaba-token-plan-cn": "https://help.aliyun.com/zh/model-studio/opencode-token-plan",
  "ax-studio": "https://github.com/defai-digital/ax-studio",
}
for (const [id, doc] of Object.entries(docOverrides)) {
  if (fetched[id]) fetched[id].doc = doc
}

// Force attachment=true on Alibaba multimodal chat models. models.dev reports
// these with input modalities ["text","image","video"] but attachment=false,
// which leaves ax-code's picker refusing image uploads even though the upstream
// API accepts them. Override here so the capability flag matches the modality.
const alibabaAttachmentForceTrue = ["qwen3.7-plus", "qwen3.6-plus"]
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
function unmarkSearch(model: { name?: string } | undefined) {
  if (!model?.name) return
  if (model.name.startsWith(LEGACY_SEARCH_PREFIX)) {
    model.name = model.name.slice(LEGACY_SEARCH_PREFIX.length)
  }
  if (model.name.endsWith(SEARCH_MARKER)) {
    model.name = model.name.slice(0, -SEARCH_MARKER.length)
  }
}
function supportsTextOutput(model: { modalities?: { output?: unknown } } | undefined) {
  const output = model?.modalities?.output
  return !Array.isArray(output) || output.includes("text")
}
// xAI: only Grok 4.3 has Live Search wired via providerOptions.searchParameters.
const xaiSearchModelIds = ["grok-4.3", "grok-4-3"]
const xaiModels = fetched["xai"]?.models as Record<string, { name?: string }> | undefined
if (xaiModels) {
  for (const model of Object.values(xaiModels)) unmarkSearch(model)
  for (const mid of xaiSearchModelIds) markSearch(xaiModels[mid])
}
// Alibaba: every Qwen model on the four plan endpoints accepts `enable_search`.
// Non-Qwen models (DeepSeek/GLM/Kimi/MiniMax) served on the same plans don't
// honor the knob, so they stay unmarked.
for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  const models = fetched[id]?.models as Record<string, { name?: string; modalities?: { output?: unknown } }> | undefined
  if (!models) continue
  for (const [mid, model] of Object.entries(models)) {
    unmarkSearch(model)
    if (mid.toLowerCase().startsWith("qwen") && supportsTextOutput(model)) markSearch(model)
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
  await writeText(snapshotPath, next)
  console.log("Updated models-snapshot.json")
}
