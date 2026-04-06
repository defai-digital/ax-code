import { readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

interface CliModelInfo {
  model: string
  source: string
}

const DEFAULTS: Record<string, string> = {
  "claude-code": "claude-sonnet-4-6",
  "gemini-cli": "gemini-2.5-pro",
  "codex-cli": "gpt-5.4",
}

function readJson(path: string): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8")
  } catch {
    return null
  }
}

function resolveClaudeModel(): CliModelInfo {
  const home = homedir()

  // Project-level settings take precedence, but we don't know the project dir here.
  // Check global settings.
  const settings = readJson(join(home, ".claude", "settings.json"))
  if (typeof settings?.model === "string") return { model: settings.model, source: "~/.claude/settings.json" }

  // Check env var
  if (process.env.ANTHROPIC_MODEL) return { model: process.env.ANTHROPIC_MODEL, source: "ANTHROPIC_MODEL" }

  return { model: DEFAULTS["claude-code"]!, source: "default" }
}

function resolveGeminiModel(): CliModelInfo {
  const home = homedir()

  // Check env var first (higher priority)
  if (process.env.GEMINI_MODEL) return { model: process.env.GEMINI_MODEL, source: "GEMINI_MODEL" }

  const settings = readJson(join(home, ".gemini", "settings.json"))
  // model can be a string or { name: "..." } depending on version
  if (typeof settings?.model === "string") return { model: settings.model, source: "~/.gemini/settings.json" }
  if (typeof settings?.model?.name === "string") return { model: settings.model.name, source: "~/.gemini/settings.json" }

  return { model: DEFAULTS["gemini-cli"]!, source: "default" }
}

function resolveCodexModel(): CliModelInfo {
  const home = homedir()

  const toml = readText(join(home, ".codex", "config.toml"))
  if (toml) {
    // Extract top-level model = "..." from TOML
    const match = toml.match(/^model\s*=\s*"([^"]+)"/m)
    if (match?.[1]) return { model: match[1], source: "~/.codex/config.toml" }
  }

  return { model: DEFAULTS["codex-cli"]!, source: "default" }
}

const RESOLVERS: Record<string, () => CliModelInfo> = {
  "claude-code": resolveClaudeModel,
  "gemini-cli": resolveGeminiModel,
  "codex-cli": resolveCodexModel,
}

export function resolveCliModel(providerID: string): CliModelInfo {
  const resolver = RESOLVERS[providerID]
  if (!resolver) return { model: "unknown", source: "none" }
  return resolver()
}
