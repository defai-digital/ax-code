import type { Provider } from "./provider"
import { ProviderID, ModelID } from "./schema"
import { which } from "../util/which"
import { Ssrf } from "../util/ssrf"
import { CliLanguageModel } from "./cli/cli-language-model"
import type { CliOutputParser } from "./cli/parser"
import { resolveCliModel } from "./cli/resolve"
import { getCliProviderDefinition } from "./cli/config"
import { checkCliProviderAuth } from "./cli/connect"
import { URL } from "url"

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

type OpenAICompatibleModelItem = {
  id?: string
  capabilities?: Partial<Provider.Model["capabilities"]>
  limit?: Partial<Provider.Model["limit"]>
  context_length?: number
  max_context_length?: number
  max_output_tokens?: number
}

type ModelListFetcher = (input: string, init?: { signal?: AbortSignal }) => Promise<Response>

function openAICompatibleCapabilities(item: OpenAICompatibleModelItem): Provider.Model["capabilities"] {
  return {
    temperature: item.capabilities?.temperature ?? true,
    reasoning: item.capabilities?.reasoning ?? false,
    attachment: item.capabilities?.attachment ?? false,
    toolcall: item.capabilities?.toolcall ?? true,
    input: {
      text: item.capabilities?.input?.text ?? true,
      audio: item.capabilities?.input?.audio ?? false,
      image: item.capabilities?.input?.image ?? false,
      video: item.capabilities?.input?.video ?? false,
      pdf: item.capabilities?.input?.pdf ?? false,
    },
    output: {
      text: item.capabilities?.output?.text ?? true,
      audio: item.capabilities?.output?.audio ?? false,
      image: item.capabilities?.output?.image ?? false,
      video: item.capabilities?.output?.video ?? false,
      pdf: item.capabilities?.output?.pdf ?? false,
    },
    interleaved: item.capabilities?.interleaved ?? false,
  }
}

function openAICompatibleLimit(item: OpenAICompatibleModelItem): Provider.Model["limit"] {
  return {
    context: item.limit?.context ?? item.context_length ?? item.max_context_length ?? 128000,
    output: item.limit?.output ?? item.max_output_tokens ?? 4096,
  }
}

async function fetchOpenAICompatibleModels(fetcher: ModelListFetcher, host: string) {
  return fetcher(`${host}/v1/models`, { signal: AbortSignal.timeout(5000) })
    .then(async (r) => {
      if (!r.ok) return null
      return (await r.json()) as { data?: OpenAICompatibleModelItem[] }
    })
    .catch(() => null)
}

function ollamaCompatibleLoader(providerID: string, envKey: string, defaultHost: string): CustomLoader {
  return async () => {
    const host = process.env[envKey] || defaultHost
    const url = new URL(host)
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    const fetcher = local ? fetch : Ssrf.pinnedFetch
    const reachable = await fetcher(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false)

    return {
      autoload: reachable,
      options: reachable ? { baseURL: `${host}/v1` } : {},
      async discoverModels() {
        const res = await fetcher(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
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

function openAICompatibleLoader(providerID: string, envKey: string, defaultHost: string): CustomLoader {
  return async () => {
    const host = process.env[envKey] || defaultHost
    const url = new URL(host)
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    const fetcher = local ? fetch : Ssrf.pinnedFetch
    const initial = await fetchOpenAICompatibleModels(fetcher, host)
    const reachable = !!initial

    return {
      autoload: reachable,
      options: reachable ? { baseURL: `${host}/v1` } : {},
      async discoverModels() {
        const discovered = await fetchOpenAICompatibleModels(fetcher, host)
        if (!discovered) return {}
        const models: Record<string, Provider.Model> = {}
        for (const item of discovered.data ?? []) {
          if (!item.id) continue
          const id = ModelID.make(item.id)
          models[id] = {
            id,
            providerID: ProviderID.make(providerID),
            name: item.id,
            api: { id: item.id, url: `${host}/v1`, npm: "@ai-sdk/openai-compatible" },
            capabilities: openAICompatibleCapabilities(item),
            limit: openAICompatibleLimit(item),
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
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", context: 200000, output: 16384 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context: 200000, output: 16384 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", context: 200000, output: 8192 },
  ],
  "gemini-cli": [
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", context: 1000000, output: 65536 },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", context: 1000000, output: 65536 },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", context: 1000000, output: 65536 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", context: 1000000, output: 65536 },
  ],
  "codex-cli": [
    { id: "gpt-5.4", name: "GPT-5.4", context: 200000, output: 16384 },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", context: 200000, output: 16384 },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", context: 200000, output: 16384 },
    { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", context: 200000, output: 16384 },
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

interface CliLoaderOpts {
  providerID: string
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg"
  promptFlag?: string
}

function cliLoader(opts: CliLoaderOpts): CustomLoader {
  return async (provider) => {
    const path = which(opts.binary)
    return {
      autoload: false,
      async getModel(_sdk: any, modelID: string) {
        if (!path) throw new Error(`${opts.binary} CLI not found in PATH`)
        const authError = await checkCliProviderAuth(opts.providerID, path)
        if (authError) throw new Error(authError)
        return new CliLanguageModel({
          providerID: opts.providerID,
          modelID,
          binary: path,
          args: opts.args,
          parser: opts.parser,
          promptMode: opts.promptMode,
          promptFlag: opts.promptFlag,
        })
      },
      async discoverModels() {
        if (!path) return {}
        const authError = await checkCliProviderAuth(opts.providerID, path)
        if (authError) return {}
        const info = await resolveCliModel(opts.providerID)
        return cliModels(opts.providerID, provider, info.model)
      },
    }
  }
}

const claudeCode = getCliProviderDefinition("claude-code")!
const geminiCli = getCliProviderDefinition("gemini-cli")!
const codexCli = getCliProviderDefinition("codex-cli")!

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
  "ax-serving": openAICompatibleLoader("ax-serving", "AX_SERVING_HOST", "http://localhost:18080"),
  "claude-code": cliLoader({
    providerID: "claude-code",
    binary: claudeCode.binary,
    args: claudeCode.args,
    parser: claudeCode.parser,
    promptMode: claudeCode.promptMode,
    promptFlag: claudeCode.promptFlag,
  }),
  "gemini-cli": cliLoader({
    providerID: "gemini-cli",
    binary: geminiCli.binary,
    args: geminiCli.args,
    parser: geminiCli.parser,
    promptMode: geminiCli.promptMode,
    promptFlag: geminiCli.promptFlag,
  }),
  "codex-cli": cliLoader({
    providerID: "codex-cli",
    binary: codexCli.binary,
    args: codexCli.args,
    parser: codexCli.parser,
    promptMode: codexCli.promptMode,
    promptFlag: codexCli.promptFlag,
  }),
}
