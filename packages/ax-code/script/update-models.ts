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
for (const id of ["groq", "azure", "azure-cognitive-services", "moonshotai", "moonshotai-cn", "kimi-for-coding"]) {
  delete fetched[id]
}

// Strip unsupported models from every remaining provider — multi-host
// resellers (openrouter, novita, vercel, baseten, chutes, nano-gpt, …)
// surface the same upstream models, so a single filter catches all
// hosting variants. Probes match against family, id, and name because
// models.dev tags inconsistently across providers.
//
//   - Kimi (Moonshot): unsupported entirely.
//   - Grok: only v4+ and grok-code-* (Grok 2/3 and unversioned betas
//     drop). The grok-code line is xAI's coding model and is treated
//     as v4-era for our purposes (transform.ts already groups them).
//   - GLM (Z.AI): only v5+ (every glm-4.x / glm-3.x drops).
//
// To extend: add another entry to UNSUPPORTED_PROBES.
type RawModel = { family?: string; id?: string; name?: string }
function probesOf(m: RawModel): string[] {
  return [m.family, m.id, m.name].filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase())
}
function isUnsupportedModel(m: RawModel): boolean {
  const probes = probesOf(m)
  // Kimi: anything tagged kimi.
  if (probes.some((p) => p.includes("kimi"))) return true
  // Grok: drop if any probe mentions grok and none mentions grok-4*/grok-code*.
  if (probes.some((p) => /\bgrok\b|grok-/.test(p))) {
    const supported = probes.some((p) => /grok-4|grok-code/.test(p))
    if (!supported) return true
  }
  // GLM: drop if any probe mentions glm-N where N < 5.
  if (probes.some((p) => /\bglm-[0-4]\b/.test(p))) return true
  return false
}
for (const provider of Object.values(fetched) as Array<{ models?: Record<string, RawModel> }>) {
  if (!provider.models) continue
  for (const [mid, model] of Object.entries(provider.models)) {
    if (isUnsupportedModel(model)) delete provider.models[mid]
  }
}

// Trim alibaba providers to supported models only
const alibabaModels = ["qwen3.6-plus", "qwen3.5-flash"]
for (const id of ["alibaba", "alibaba-cn", "alibaba-coding-plan", "alibaba-coding-plan-cn"]) {
  if (!fetched[id]) continue
  const models = fetched[id].models ?? {}
  const kept: Record<string, unknown> = {}
  for (const mid of alibabaModels) {
    if (models[mid]) kept[mid] = models[mid]
  }
  // If models.dev doesn't have a model for this region, copy from alibaba-cn
  if (!kept["qwen3.5-flash"] && fetched["alibaba-cn"]?.models?.["qwen3.5-flash"]) {
    kept["qwen3.5-flash"] = JSON.parse(JSON.stringify(fetched["alibaba-cn"].models["qwen3.5-flash"]))
  }
  fetched[id].models = kept
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
  alibaba: "Alibaba (Standard API)",
  "alibaba-cn": "Alibaba (Standard API, China)",
  zai: "Z.AI (Standard API)",
}
for (const [id, name] of Object.entries(nameOverrides)) {
  if (fetched[id]) fetched[id].name = name
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
