import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { parse as parseToml } from "smol-toml"
import { Filesystem } from "../../util/filesystem"
import { isRecord } from "../../util/record"
import { parseCliJsonObject, type CliJsonObject } from "./json"
import { claudeConfigDir, codexHome } from "./home"

export interface CliModelInfo {
  model: string
  source: string
}

const DEFAULTS: Record<string, string> = {
  "claude-code": "claude-code",
  "codex-cli": "codex-cli",
  "grok-build-cli": "grok-build-cli",
  "kimi-cli": "kimi-cli",
  "muse-cli": "muse-cli",
  "dsh-cli": "dsh-cli",
  "antigravity-cli": "antigravity-cli",
}

const KIMI_CODE_LEGACY_MODEL_IDS = new Set(["k3", "k3-256k", "kimi-for-coding", "kimi-for-coding-highspeed"])

export function normalizeKimiCodeModelID(model: string) {
  const trimmed = model.trim()
  return KIMI_CODE_LEGACY_MODEL_IDS.has(trimmed) ? `kimi-code/${trimmed}` : trimmed
}

type JsonLike = CliJsonObject

export function parseCliSettingsJson(text: string): JsonLike | null {
  return parseCliJsonObject(text) ?? null
}

function homeDir() {
  return process.env.AX_CODE_TEST_HOME || homedir()
}

async function readJson(path: string): Promise<JsonLike | null> {
  const text = await readFile(path, "utf-8").catch((error) => {
    if (Filesystem.isEnoent(error)) return undefined
    throw error
  })
  return text === undefined ? null : parseCliSettingsJson(text)
}

async function readText(path: string): Promise<string | null> {
  const text = await readFile(path, "utf-8").catch((error) => {
    if (Filesystem.isEnoent(error)) return undefined
    throw error
  })
  return text ?? null
}

function resolveTomlModel(toml: string, key: string): string | undefined {
  try {
    // Parsing preserves table scope and ignores model-looking text in strings.
    const value = parseToml(toml)[key]
    return typeof value === "string" ? value.trim() || undefined : undefined
  } catch {
    return undefined
  }
}

type ResolveCliModelOptions = {
  envVar: string
  settingsPath: string
  sourceLabel: string
  defaultModel: string
  read: (settings: JsonLike) => string | undefined
}

async function resolveModelFromJsonSettings(options: ResolveCliModelOptions): Promise<CliModelInfo> {
  // Trim and reject empty/whitespace so blank env or settings never override the default.
  const envModel = process.env[options.envVar]?.trim()
  if (envModel) return { model: envModel, source: options.envVar }

  const settings = await readJson(options.settingsPath)
  const model = settings ? options.read(settings) : undefined
  if (model) return { model, source: options.sourceLabel }

  return { model: options.defaultModel, source: "default" }
}

function resolveJsonModelString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function resolveModelFromObject(settings: JsonLike): string | undefined {
  const directModel = resolveJsonModelString(settings.model)
  if (directModel !== undefined) return directModel
  const model = settings.model
  if (model && typeof model === "object" && !Array.isArray(model) && "name" in model) {
    return resolveJsonModelString((model as JsonLike).name)
  }
  return undefined
}

async function resolveClaudeModel(): Promise<CliModelInfo> {
  const dir = claudeConfigDir()
  return resolveModelFromJsonSettings({
    envVar: "ANTHROPIC_MODEL",
    settingsPath: join(dir.path, "settings.json"),
    sourceLabel: `${dir.source}/settings.json`,
    defaultModel: DEFAULTS["claude-code"]!,
    read: resolveModelFromObject,
  })
}

export function resolveCodexTomlModel(toml: string): string | undefined {
  return resolveTomlModel(toml, "model")
}

async function resolveCodexModel(): Promise<CliModelInfo> {
  const home = codexHome()
  const toml = await readText(join(home.path, "config.toml"))
  const model = toml ? resolveCodexTomlModel(toml) : undefined
  if (model) return { model, source: `${home.source}/config.toml` }

  return { model: DEFAULTS["codex-cli"]!, source: "default" }
}

function kimiHomeOverride(): { path: string; source: string } | undefined {
  const codeHome = process.env.KIMI_CODE_HOME?.trim()
  if (codeHome) return { path: codeHome, source: "$KIMI_CODE_HOME" }
  const shareDir = process.env.KIMI_SHARE_DIR?.trim()
  if (shareDir) return { path: shareDir, source: "$KIMI_SHARE_DIR" }
  return undefined
}

function kimiDefaultHomes(): Array<{ path: string; source: string }> {
  // Prefer the current Kimi Code CLI data dir, then the legacy ~/.kimi. This
  // fallback only applies when no explicit home override is set.
  return [
    { path: join(homeDir(), ".kimi-code"), source: "~/.kimi-code" },
    { path: join(homeDir(), ".kimi"), source: "~/.kimi" },
  ]
}

interface KimiConfig {
  defaultModel?: string
  aliases: string[]
}

function parseKimiModelAliases(toml: string): string[] {
  try {
    // `[models."<alias>"]` tables; the table keys are the models Kimi offers.
    const models = parseToml(toml).models
    if (!isRecord(models)) return []
    return Object.keys(models)
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0)
      .map(normalizeKimiCodeModelID)
  } catch {
    return []
  }
}

async function readKimiConfig(path: string): Promise<KimiConfig | undefined> {
  const toml = await readText(path)
  if (!toml) return undefined
  const defaultModel = resolveTomlModel(toml, "default_model")
  const aliases = parseKimiModelAliases(toml)
  if (!defaultModel && aliases.length === 0) return undefined
  return { defaultModel, aliases }
}

// Kimi uses exactly one home: the explicit override when set, otherwise the
// current data dir with the legacy dir as a fallback. It never mixes an
// override with the default homes.
async function resolveKimiConfig(): Promise<{ config: KimiConfig; source: string } | undefined> {
  const override = kimiHomeOverride()
  if (override) {
    const config = await readKimiConfig(join(override.path, "config.toml"))
    return config ? { config, source: `${override.source}/config.toml` } : undefined
  }
  for (const candidate of kimiDefaultHomes()) {
    const config = await readKimiConfig(join(candidate.path, "config.toml"))
    if (config) return { config, source: `${candidate.source}/config.toml` }
  }
  return undefined
}

export interface KimiCliConfiguredModels {
  source: string
  defaultModel?: string
  /** Model aliases declared as `[models."<alias>"]` tables, normalized. */
  aliases: string[]
}

/** Model ids from the effective Kimi home's config.toml, for discovery. */
export async function resolveKimiConfigModels(): Promise<KimiCliConfiguredModels | undefined> {
  const resolved = await resolveKimiConfig()
  if (!resolved) return undefined
  const aliases = new Set(resolved.config.aliases)
  const defaultModel = resolved.config.defaultModel ? normalizeKimiCodeModelID(resolved.config.defaultModel) : undefined
  if (defaultModel) aliases.add(defaultModel)
  return { source: resolved.source, defaultModel, aliases: [...aliases] }
}

async function resolveKimiModel(): Promise<CliModelInfo> {
  const envModel = process.env.KIMI_MODEL?.trim()
  if (envModel) return { model: normalizeKimiCodeModelID(envModel), source: "KIMI_MODEL" }

  const resolved = await resolveKimiConfig()
  const model = resolved?.config.defaultModel
  if (resolved && model) {
    return { model: normalizeKimiCodeModelID(model), source: resolved.source }
  }

  return { model: DEFAULTS["kimi-cli"]!, source: "default" }
}

function museConfigDir() {
  const testHome = process.env.AX_CODE_TEST_HOME?.trim()
  if (testHome) return join(testHome, ".config", "muse")
  const xdg = process.env.XDG_CONFIG_HOME?.trim()
  if (xdg) return join(xdg, "muse")
  return join(homeDir(), ".config", "muse")
}

async function resolveMuseModel(): Promise<CliModelInfo> {
  const envModel = process.env.MUSE_MODEL?.trim()
  if (envModel) return { model: envModel, source: "MUSE_MODEL" }

  const settings = await readJson(join(museConfigDir(), "settings.json"))
  const model = settings ? resolveJsonModelString(settings.model) : undefined
  if (model) {
    const testHome = process.env.AX_CODE_TEST_HOME?.trim()
    const source = testHome
      ? "test-home ~/.config/muse/settings.json"
      : process.env.XDG_CONFIG_HOME?.trim()
        ? "$XDG_CONFIG_HOME/muse/settings.json"
        : "~/.config/muse/settings.json"
    return { model, source }
  }

  return { model: DEFAULTS["muse-cli"]!, source: "default" }
}

const RESOLVERS: Record<string, () => Promise<CliModelInfo>> = {
  // Delegate to agy's saved default; settings may contain a display name for
  // a retired model rather than a currently accepted model slug.
  "antigravity-cli": async () => ({ model: DEFAULTS["antigravity-cli"]!, source: "default" }),
  "claude-code": resolveClaudeModel,
  "codex-cli": resolveCodexModel,
  "grok-build-cli": async () => ({ model: DEFAULTS["grok-build-cli"]!, source: "default" }),
  "kimi-cli": resolveKimiModel,
  "muse-cli": resolveMuseModel,
  // dsh headless has no model flag; the profile's model route decides.
  "dsh-cli": async () => ({ model: DEFAULTS["dsh-cli"]!, source: "default" }),
}

export async function resolveCliModel(providerID: string): Promise<CliModelInfo> {
  const resolver = Object.hasOwn(RESOLVERS, providerID) ? RESOLVERS[providerID] : undefined
  if (!resolver) return { model: "unknown", source: "none" }
  return resolver()
}
