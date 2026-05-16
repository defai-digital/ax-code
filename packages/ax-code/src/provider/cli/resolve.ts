import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

export interface CliModelInfo {
  model: string
  source: string
}

const HOME = homedir()

const DEFAULTS: Record<string, string> = {
  "claude-code": "claude-code",
  "gemini-cli": "gemini-cli",
  "codex-cli": "codex-cli",
}

type JsonLike = Record<string, unknown>

async function readJson(path: string): Promise<JsonLike | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8"))
  } catch {
    return null
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8")
  } catch {
    return null
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
  const envModel = process.env[options.envVar]
  if (envModel) return { model: envModel, source: options.envVar }

  const settings = await readJson(join(HOME, options.settingsPath))
  const model = settings ? options.read(settings) : undefined
  if (model !== undefined) return { model, source: options.sourceLabel }

  return { model: options.defaultModel, source: "default" }
}

function resolveJsonModelString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function resolveModelFromObject(settings: JsonLike): string | undefined {
  const directModel = resolveJsonModelString(settings.model)
  if (directModel !== undefined) return directModel
  const model = (settings as JsonLike).model
  if (model && typeof model === "object" && "name" in model) return resolveJsonModelString((model as JsonLike).name)
  return undefined
}

async function resolveClaudeModel(): Promise<CliModelInfo> {
  return resolveModelFromJsonSettings({
    envVar: "ANTHROPIC_MODEL",
    settingsPath: ".claude/settings.json",
    sourceLabel: "~/.claude/settings.json",
    defaultModel: DEFAULTS["claude-code"]!,
    read: resolveJsonModelString,
  })
}

async function resolveGeminiModel(): Promise<CliModelInfo> {
  return resolveModelFromJsonSettings({
    envVar: "GEMINI_MODEL",
    settingsPath: ".gemini/settings.json",
    sourceLabel: "~/.gemini/settings.json",
    defaultModel: DEFAULTS["gemini-cli"]!,
    read: resolveModelFromObject,
  })
}

async function resolveCodexModel(): Promise<CliModelInfo> {
  const toml = await readText(join(HOME, ".codex", "config.toml"))
  if (toml) {
    const match = toml.match(/^model\s*=\s*"([^"]+)"/m)
    if (match?.[1]) return { model: match[1], source: "~/.codex/config.toml" }
  }

  return { model: DEFAULTS["codex-cli"]!, source: "default" }
}

const RESOLVERS: Record<string, () => Promise<CliModelInfo>> = {
  "claude-code": resolveClaudeModel,
  "gemini-cli": resolveGeminiModel,
  "codex-cli": resolveCodexModel,
}

export async function resolveCliModel(providerID: string): Promise<CliModelInfo> {
  const resolver = RESOLVERS[providerID]
  if (!resolver) return { model: "unknown", source: "none" }
  return resolver()
}
