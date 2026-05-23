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
const snapshotPath = path.join(dir, "src/provider/models-snapshot.json")
const modelsUrl = process.env.AX_CODE_MODELS_URL || "https://models.dev"

console.log(`Fetching models from ${modelsUrl}/api.json ...`)

const fetched = await fetch(`${modelsUrl}/api.json`, { signal: AbortSignal.timeout(10_000) })
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })
  .catch((err) => {
    console.error(`Failed to fetch models: ${err.message}`)
    process.exit(0) // don't block commit if network is down
  })

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
//   - Kimi (Moonshot): unsupported entirely.
//   - Grok: only v4.1+ plus the explicit grok-code-fast-1 coding model
//     (Grok 4.0, other unversioned grok-code-* aliases, Grok 2/3, and
//     unversioned betas drop).
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
function isGrok41OrLaterProbe(probe: string): boolean {
  const match = probe.match(/grok-(\d+)(?:[.-]?(\d+))?/)
  if (!match) return false
  const major = Number(match[1])
  const minor = match[2] === undefined ? 0 : Number(match[2])
  return major > 4 || (major === 4 && minor >= 1)
}
function isExactGrok41Probe(probe: string): boolean {
  const finalSegment = probe.split("/").pop()
  return finalSegment === "grok-4.1" || finalSegment === "grok-4-1"
}
function isAllowedGrokCodingProbe(probe: string): boolean {
  return probe.split("/").pop() === "grok-code-fast-1"
}
function isUnsupportedModel(m: RawModel): boolean {
  const probes = probesOf(m)
  // Kimi: anything tagged kimi.
  if (probes.some((p) => p.includes("kimi"))) return true
  // Grok: drop if any probe mentions grok and none has a 4.1+ version or explicit coding exception.
  if (probes.some(isGrokProbe)) {
    if (probes.some(isExactGrok41Probe)) return true
    const supported = probes.some((p) => isGrok41OrLaterProbe(p) || isAllowedGrokCodingProbe(p))
    if (!supported) return true
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
for (const [providerID, provider] of Object.entries(fetched) as Array<[string, { models?: Record<string, RawModel> }]>) {
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

// Trim Alibaba plan providers to the text/reasoning models supported by the plan.
// Image-only models (qwen-image-*, wan*) are intentionally omitted because ax-code
// uses this provider list for chat/code LLM selection.
const alibabaModels = ["qwen3.6-plus", "deepseek-v3.2", "glm-5", "MiniMax-M2.5"]
const alibabaModelFallbackProviders: Record<string, string[]> = {
  "deepseek-v3.2": ["302ai", "ollama-cloud", "cortecs", "llmgateway"],
  "glm-5": ["tencent-coding-plan", "zhipuai", "302ai", "opencode"],
  "MiniMax-M2.5": ["minimax-coding-plan", "minimax-cn-coding-plan", "minimax"],
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

for (const id of ["alibaba-coding-plan", "alibaba-coding-plan-cn", "alibaba-token-plan", "alibaba-token-plan-cn"]) {
  const deepseek = fetched[id]?.models?.["deepseek-v3.2"] as
    | { limit?: { context?: number; output?: number } }
    | undefined
  if (deepseek?.limit) deepseek.limit.output = 16_384
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
  process.exit(0)
}

await Bun.write(snapshotPath, next)
console.log("Updated models-snapshot.json")
