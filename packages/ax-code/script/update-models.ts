#!/usr/bin/env bun

/**
 * Fetches the latest model data from models.dev and updates the local snapshot.
 * Preserves CLI provider entries (claude-code, gemini-cli, codex-cli) that
 * aren't in the upstream API.
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

// Preserve CLI provider entries that models.dev doesn't include
const cliProviderIDs = ["claude-code", "gemini-cli", "codex-cli", "ollama", "ax-studio"]
for (const id of cliProviderIDs) {
  if (existing[id] && !fetched[id]) fetched[id] = existing[id]
}

const prev = JSON.stringify(existing)
const next = JSON.stringify(fetched, null, 2) + "\n"

if (prev === JSON.stringify(fetched)) {
  console.log("models-snapshot.json is already up to date")
  process.exit(0)
}

await Bun.write(snapshotPath, next)
console.log("Updated models-snapshot.json")
