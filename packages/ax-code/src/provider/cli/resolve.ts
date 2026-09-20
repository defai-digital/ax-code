import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import { Filesystem } from "../../util/filesystem"
import { parseCliJsonObject, type CliJsonObject } from "./json"

export interface CliModelInfo {
  model: string
  source: string
}

const DEFAULTS: Record<string, string> = {
  "claude-code": "claude-code",
  "codex-cli": "codex-cli",
  "grok-build-cli": "grok-build-cli",
  "muse-cli": "muse-cli",
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

  const settings = await readJson(join(homeDir(), options.settingsPath))
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
  return resolveModelFromJsonSettings({
    envVar: "ANTHROPIC_MODEL",
    settingsPath: ".claude/settings.json",
    sourceLabel: "~/.claude/settings.json",
    defaultModel: DEFAULTS["claude-code"]!,
    read: resolveModelFromObject,
  })
}

async function resolveCodexModel(): Promise<CliModelInfo> {
  const toml = await readText(join(homeDir(), ".codex", "config.toml"))
  if (toml) {
    const match = toml.match(/^model\s*=\s*"([^"]+)"/m)
    if (match?.[1]) return { model: match[1], source: "~/.codex/config.toml" }
  }

  return { model: DEFAULTS["codex-cli"]!, source: "default" }
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
  "claude-code": resolveClaudeModel,
  "codex-cli": resolveCodexModel,
  "grok-build-cli": async () => ({ model: DEFAULTS["grok-build-cli"]!, source: "default" }),
  "muse-cli": resolveMuseModel,
}

export async function resolveCliModel(providerID: string): Promise<CliModelInfo> {
  const resolver = RESOLVERS[providerID]
  if (!resolver) return { model: "unknown", source: "none" }
  return resolver()
}
