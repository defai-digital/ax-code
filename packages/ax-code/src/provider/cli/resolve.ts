import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

export interface CliModelInfo {
  model: string
  source: string
}

const HOME = homedir()

const DEFAULTS: Record<string, string> = {
  "claude-code": "claude-sonnet-4-6",
  "gemini-cli": "gemini-2.5-pro",
  "codex-cli": "gpt-5.4",
}

async function readJson(path: string): Promise<Record<string, any> | null> {
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

async function resolveClaudeModel(): Promise<CliModelInfo> {
  // Check env var first (cheapest)
  if (process.env.ANTHROPIC_MODEL) return { model: process.env.ANTHROPIC_MODEL, source: "ANTHROPIC_MODEL" }

  const settings = await readJson(join(HOME, ".claude", "settings.json"))
  if (typeof settings?.model === "string") return { model: settings.model, source: "~/.claude/settings.json" }

  return { model: DEFAULTS["claude-code"]!, source: "default" }
}

async function resolveGeminiModel(): Promise<CliModelInfo> {
  if (process.env.GEMINI_MODEL) return { model: process.env.GEMINI_MODEL, source: "GEMINI_MODEL" }

  const settings = await readJson(join(HOME, ".gemini", "settings.json"))
  if (typeof settings?.model === "string") return { model: settings.model, source: "~/.gemini/settings.json" }
  if (typeof settings?.model?.name === "string")
    return { model: settings.model.name, source: "~/.gemini/settings.json" }

  return { model: DEFAULTS["gemini-cli"]!, source: "default" }
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
