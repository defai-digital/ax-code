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
for (const id of ["groq", "azure", "azure-cognitive-services"]) {
  delete fetched[id]
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

const prev = JSON.stringify(existing)
const next = JSON.stringify(fetched, null, 2) + "\n"

if (prev === JSON.stringify(fetched)) {
  console.log("models-snapshot.json is already up to date")
  process.exit(0)
}

await Bun.write(snapshotPath, next)
console.log("Updated models-snapshot.json")
