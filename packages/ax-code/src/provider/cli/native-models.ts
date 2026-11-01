import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { Filesystem } from "../../util/filesystem"
import { isRecord } from "@/util/record"
import { parseCliJsonObject, type CliJsonObject } from "./json"

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

function codexHome() {
  if (process.env.AX_CODE_TEST_HOME) return join(process.env.AX_CODE_TEST_HOME, ".codex")
  return process.env.CODEX_HOME?.trim() || join(homeDir(), ".codex")
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

function museDataDir() {
  const testHome = process.env.AX_CODE_TEST_HOME?.trim()
  if (testHome) return join(testHome, ".local", "share", "muse")
  const xdg = process.env.XDG_DATA_HOME?.trim()
  if (xdg) return join(xdg, "muse")
  return join(homeDir(), ".local", "share", "muse")
}

// <data>/muse/model-catalog/*.json: { rows: [{ model_id, display_label, visibility, is_default, ... }] }.
export function parseMuseModelCatalog(data: CliJsonObject): NativeCliModel[] {
  if (!Array.isArray(data.rows)) return []
  const rows: Array<NativeCliModel & { isDefault: boolean }> = []
  for (const item of data.rows) {
    if (!isRecord(item) || item.visibility !== "visible") continue
    const id = str(item.model_id)
    if (!id) continue
    // Rows without a context limit are non-chat models (image generation).
    const context = positive(item.context_limit)
    if (!context) continue
    rows.push({
      id,
      name: str(item.display_label) ?? id,
      context,
      output: positive(item.output_limit),
      efforts: efforts(item.reasoning_effort_variants, "tier"),
      isDefault: item.is_default === true,
    })
  }
  return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map(({ isDefault: _, ...model }) => model)
}

async function readMuseCatalogs(): Promise<NativeCliModel[]> {
  const dir = join(museDataDir(), "model-catalog")
  const files = await readdir(dir).catch((error) => {
    if (Filesystem.isEnoent(error)) return [] as string[]
    throw error
  })
  const seen = new Set<string>()
  const models: NativeCliModel[] = []
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    const data = await readJson(join(dir, file))
    for (const model of data ? parseMuseModelCatalog(data) : []) {
      if (seen.has(model.id)) continue
      seen.add(model.id)
      models.push(model)
    }
  }
  return models
}

function claudeConfigDir() {
  if (process.env.AX_CODE_TEST_HOME) return join(process.env.AX_CODE_TEST_HOME, ".claude")
  return process.env.CLAUDE_CONFIG_DIR?.trim() || join(homeDir(), ".claude")
}

// <claude config>/cache/model-catalog/<account>-cc.json:
// { fetchedAt, catalog: { config: { models: [{ id, name, section, runtime: { ... } }] } } }.
// The "main" section is Claude Code's own picker; "overflow" holds older models.
export function parseClaudeModelCatalog(data: CliJsonObject): NativeCliModel[] {
  const catalog = isRecord(data.catalog) ? data.catalog : undefined
  const config = catalog && isRecord(catalog.config) ? catalog.config : undefined
  if (!config || !Array.isArray(config.models)) return []
  const rows: NativeCliModel[] = []
  for (const item of config.models) {
    if (!isRecord(item) || item.section !== "main" || item.hidden === true) continue
    const id = str(item.id)
    if (!id) continue
    const runtime = isRecord(item.runtime) ? item.runtime : {}
    const capabilities = Array.isArray(runtime.capabilities) ? runtime.capabilities : []
    rows.push({
      id,
      name: str(item.name) ?? id,
      context: positive(runtime.max_input_tokens),
      output: positive(runtime.max_output_tokens),
      image: capabilities.includes("mm_images"),
      efforts: efforts(
        Array.isArray(runtime.effort_levels) ? runtime.effort_levels.map((value) => ({ value })) : undefined,
        "value",
      ),
    })
  }
  return rows
}

// One catalog file per signed-in account; the most recently fetched belongs to
// the account Claude Code is using now.
async function readClaudeCatalogs(): Promise<NativeCliModel[]> {
  const dir = join(claudeConfigDir(), "cache", "model-catalog")
  const files = await readdir(dir).catch((error) => {
    if (Filesystem.isEnoent(error)) return [] as string[]
    throw error
  })
  let newest: { fetchedAt: number; models: NativeCliModel[] } | undefined
  for (const file of files.filter((name) => name.endsWith("-cc.json"))) {
    const data = await readJson(join(dir, file))
    if (!data) continue
    const models = parseClaudeModelCatalog(data)
    const fetchedAt = positive(data.fetchedAt) ?? 0
    if (models.length > 0 && (!newest || fetchedAt > newest.fetchedAt)) newest = { fetchedAt, models }
  }
  return newest?.models ?? []
}

const READERS: Record<string, () => Promise<NativeCliModel[]>> = {
  "claude-code": readClaudeCatalogs,
  "codex-cli": async () => {
    const data = await readJson(join(codexHome(), "models_cache.json"))
    return data ? parseCodexModelsCache(data) : []
  },
  "grok-build-cli": async () => {
    const data = await readJson(join(homeDir(), ".grok", "models_cache.json"))
    return data ? parseGrokModelsCache(data) : []
  },
  "muse-cli": readMuseCatalogs,
}

/**
 * The CLI's own current model list, or an empty list when the CLI keeps no
 * readable cache (callers then fall back to the bundled catalog).
 */
export async function readNativeCliModels(providerID: string): Promise<NativeCliModel[]> {
  const reader = READERS[providerID]
  if (!reader) return []
  return reader().catch(() => [])
}
