import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { Filesystem } from "../../util/filesystem"
import { isRecord } from "@/util/record"
import { parseCliJsonObject, type CliJsonObject } from "./json"
import { codexHome } from "./home"

/**
 * A model the CLI itself currently offers, read from the model cache the CLI
 * refreshes from its vendor. Vendors retire and add models between AX Code
 * releases, so these caches outrank the bundled models.dev snapshot.
 */
export interface NativeCliModel {
  id: string
  name: string
  context?: number
  output?: number
  image?: boolean
  /** Reasoning efforts the CLI accepts for this model, in ascending order. */
  efforts?: string[]
}

function homeDir() {
  return process.env.AX_CODE_TEST_HOME || homedir()
}

async function readJson(path: string): Promise<CliJsonObject | undefined> {
  const text = await readFile(path, "utf-8").catch((error) => {
    if (Filesystem.isEnoent(error)) return undefined
    throw error
  })
  return text === undefined ? undefined : parseCliJsonObject(text)
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]

// Efforts become a CLI argument (and a TOML string for Codex), so accept only
// plain identifiers.
function efforts(list: unknown, key: string): string[] | undefined {
  if (!Array.isArray(list)) return undefined
  const values = new Set<string>()
  for (const item of list) {
    const value = isRecord(item) ? str(item[key]) : undefined
    if (value && /^[a-z][a-z0-9_-]{0,31}$/.test(value)) values.add(value)
  }
  if (values.size === 0) return undefined
  const rank = (value: string) => {
    const index = EFFORT_ORDER.indexOf(value)
    return index === -1 ? EFFORT_ORDER.length : index
  }
  return [...values].sort((a, b) => rank(a) - rank(b))
}

// ~/.codex/models_cache.json: { models: [{ slug, display_name, visibility, priority, ... }] }.
// Only `visibility: "list"` entries appear in Codex's own model picker.
export function parseCodexModelsCache(data: CliJsonObject): NativeCliModel[] {
  if (!Array.isArray(data.models)) return []
  const rows: Array<NativeCliModel & { priority: number }> = []
  for (const item of data.models) {
    if (!isRecord(item) || item.visibility !== "list") continue
    const id = str(item.slug)
    if (!id) continue
    const modalities = Array.isArray(item.input_modalities) ? item.input_modalities : []
    rows.push({
      id,
      name: str(item.display_name) ?? id,
      context: positive(item.context_window),
      image: modalities.includes("image"),
      efforts: efforts(item.supported_reasoning_levels, "effort"),
      priority:
        typeof item.priority === "number" && Number.isFinite(item.priority) && item.priority >= 0
          ? item.priority
          : Number.MAX_SAFE_INTEGER,
    })
  }
  return rows.sort((a, b) => a.priority - b.priority).map(({ priority: _, ...model }) => model)
}

// ~/.grok/models_cache.json: { models: { [id]: { info: { id, name, hidden, context_window, ... } } } }.
export function parseGrokModelsCache(data: CliJsonObject): NativeCliModel[] {
  if (!isRecord(data.models)) return []
  const rows: NativeCliModel[] = []
  for (const [key, entry] of Object.entries(data.models)) {
    const info = isRecord(entry) && isRecord(entry.info) ? entry.info : undefined
    if (!info || info.hidden === true) continue
    const id = str(info.id) ?? str(key)
    if (!id) continue
    rows.push({
      id,
      name: str(info.name) ?? id,
      context: positive(info.context_window),
      output: positive(info.max_completion_tokens),
      efforts: info.supports_reasoning_effort === false ? undefined : efforts(info.reasoning_efforts, "value"),
    })
  }
  return rows
}

const READERS: Record<string, () => Promise<NativeCliModel[]>> = {
  "codex-cli": async () => {
    const data = await readJson(join(codexHome().path, "models_cache.json"))
    return data ? parseCodexModelsCache(data) : []
  },
  "grok-build-cli": async () => {
    const data = await readJson(join(homeDir(), ".grok", "models_cache.json"))
    return data ? parseGrokModelsCache(data) : []
  },
}

/**
 * The CLI's own current model list, or an empty list when the CLI keeps no
 * readable cache (callers then fall back to the bundled catalog).
 */
export async function readNativeCliModels(providerID: string): Promise<NativeCliModel[]> {
  const reader = Object.hasOwn(READERS, providerID) ? READERS[providerID] : undefined
  if (!reader) return []
  return reader().catch(() => [])
}
