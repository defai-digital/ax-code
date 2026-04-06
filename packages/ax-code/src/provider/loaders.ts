import type { Provider } from "./provider"
import { ProviderID, ModelID } from "./schema"
import { which } from "../util/which"
import { CliLanguageModel } from "./cli/cli-language-model"
import { claudeCodeParser, geminiCliParser, codexCliParser, type CliOutputParser } from "./cli/parser"
import { resolveCliModel } from "./cli/resolve"

export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
export type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
export type CustomDiscoverModels = () => Promise<Record<string, Provider.Model>>
export type CustomLoader = (provider: Provider.Info) => Promise<{
  autoload: boolean
  getModel?: CustomModelLoader
  vars?: CustomVarsLoader
  options?: Record<string, any>
  discoverModels?: CustomDiscoverModels
}>

function ollamaCompatibleLoader(providerID: string, envKey: string, defaultHost: string): CustomLoader {
  return async () => {
    const host = process.env[envKey] || defaultHost
    const reachable = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false)

    return {
      autoload: reachable,
      options: reachable ? { baseURL: `${host}/v1` } : {},
      async discoverModels() {
        const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
        if (!res?.ok) return {}
        const data = (await res.json()) as { models?: { name: string }[] }
        const models: Record<string, Provider.Model> = {}
        for (const m of data.models ?? []) {
          const id = ModelID.make(m.name)
          models[id] = {
            id,
            providerID: ProviderID.make(providerID),
            name: m.name,
            api: { id: m.name, url: `${host}/v1`, npm: "@ai-sdk/openai-compatible" },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              toolcall: true,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            limit: { context: 128000, output: 4096 },
            cost: { input: 0, output: 0 },
            status: "active",
            options: {},
            headers: {},
            release_date: "",
            variants: {},
          }
        }
        return models
      },
    }
  }
}

const CLI_MODELS: Record<string, { id: string; name: string; context: number; output: number }[]> = {
  "claude-code": [
    { id: "claude-opus-4-6", name: "Opus 4.6", context: 200000, output: 16384 },
    { id: "claude-sonnet-4-6", name: "Sonnet 4.6", context: 200000, output: 16384 },
    { id: "claude-haiku-4-5", name: "Haiku 4.5", context: 200000, output: 8192 },
  ],
  "gemini-cli": [
    { id: "gemini-3", name: "Gemini 3", context: 1000000, output: 65536 },
    { id: "gemini-2.5", name: "Gemini 2.5", context: 1000000, output: 65536 },
  ],
  "codex-cli": [
    { id: "gpt-5.4", name: "GPT-5.4", context: 200000, output: 16384 },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", context: 200000, output: 16384 },
    { id: "gpt-5-codex", name: "GPT-5 Codex", context: 200000, output: 16384 },
  ],
}

function cliModels(providerID: string, provider: Provider.Info, currentModel: string): Record<string, Provider.Model> {
  const base = Object.values(provider.models)[0]
  if (!base) return {}
  const list = CLI_MODELS[providerID] ?? []
  const models: Record<string, Provider.Model> = {}
  for (const m of list) {
    const id = ModelID.make(m.id)
    models[id] = {
      ...base,
      id,
      providerID: ProviderID.make(providerID),
      api: { ...base.api, id: m.id },
      name: m.id === currentModel ? `${m.name} (active)` : m.name,
      limit: { context: m.context, output: m.output },
    }
  }
  return models
}

function cliLoader(providerID: string, binary: string, args: string[], parser: CliOutputParser): CustomLoader {
  return async (provider) => {
    const path = which(binary)
    const info = resolveCliModel(providerID)
    return {
      // Don't autoload — require explicit connect via auth.json
      autoload: false,
      async getModel(_sdk: any, modelID: string) {
        if (!path) throw new Error(`${binary} CLI not found in PATH`)
        return new CliLanguageModel({ providerID, modelID, binary: path, args, parser })
      },
      async discoverModels() {
        if (!path) return {}
        return cliModels(providerID, provider, info.model)
      },
    }
  }
}

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  xai: async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        return sdk.responses(modelID)
      },
      options: {},
    }
  },
  ollama: ollamaCompatibleLoader("ollama", "OLLAMA_HOST", "http://localhost:11434"),
  "ax-studio": ollamaCompatibleLoader("ax-studio", "AX_STUDIO_HOST", "http://localhost:11434"),
  "claude-code": cliLoader("claude-code", "claude", ["--print", "--output-format", "stream-json", "--verbose"], claudeCodeParser),
  "gemini-cli": cliLoader("gemini-cli", "gemini", ["--approval-mode", "auto_edit", "--output-format", "stream-json"], geminiCliParser),
  "codex-cli": cliLoader("codex-cli", "codex", ["exec", "--json", "--skip-git-repo-check"], codexCliParser),
}
