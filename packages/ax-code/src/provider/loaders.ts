import type { Provider } from "./provider"
import { ProviderID, ModelID } from "./schema"
import { which, whichAll } from "../util/which"
import { Process } from "../util/process"
import { Ssrf } from "../util/ssrf"
import { CliLanguageModel } from "./cli/cli-language-model"
import type { CliOutputParser } from "./cli/parser"
import { selectPreferredCodexBinary } from "./cli/binary"
import { resolveCliModel } from "./cli/resolve"
import { getCliProviderDefinition } from "./cli/config"
import { checkCliProviderAuth } from "./cli/connect"
import { URL } from "url"
import { Log } from "@/util/log"
import { isLocalHostname } from "@/util/local-host"
import { axEngineLoader } from "./ax-engine/provider-loader"
import { isRecord } from "@/util/record"

const log = Log.create({ service: "provider.loaders" })

export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
export type CustomVarsLoader = (options: Record<string, any>) => Record<string, string>
export type CustomDiscoverModels = (provider: Provider.Info) => Promise<Record<string, Provider.Model>>
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

function asOpenAICompatibleModelList(input: unknown): { data: OpenAICompatibleModelItem[] } | null {
  if (!input || typeof input !== "object") return null
  const data = (input as { data?: unknown }).data
  if (!Array.isArray(data)) return null
  return { data: data.filter((item): item is OpenAICompatibleModelItem => !!item && typeof item === "object") }
}

function asOllamaTags(input: unknown): { models: { name: string }[] } | null {
  if (!input || typeof input !== "object") return null
  const models = (input as { models?: unknown }).models
  if (!Array.isArray(models)) return null
  return {
    models: models.filter(
      (item): item is { name: string } =>
        !!item &&
        typeof item === "object" &&
        typeof (item as { name?: unknown }).name === "string" &&
        (item as { name: string }).name.trim().length > 0,
    ),
  }
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function interleavedValue(value: unknown): Provider.Model["capabilities"]["interleaved"] {
  if (typeof value === "boolean") return value
  if (isRecord(value) && (value.field === "reasoning_content" || value.field === "reasoning_details")) {
    return { field: value.field }
  }
  return false
}

function openAICompatibleCapabilities(item: OpenAICompatibleModelItem): Provider.Model["capabilities"] {
  const capabilities: Record<string, unknown> = isRecord(item.capabilities) ? item.capabilities : {}
  const input: Record<string, unknown> = isRecord(capabilities.input) ? capabilities.input : {}
  const output: Record<string, unknown> = isRecord(capabilities.output) ? capabilities.output : {}
  return {
    temperature: booleanValue(capabilities.temperature, true),
    reasoning: booleanValue(capabilities.reasoning, false),
    attachment: booleanValue(capabilities.attachment, false),
    toolcall: booleanValue(capabilities.toolcall, true),
    input: {
      text: booleanValue(input.text, true),
      audio: booleanValue(input.audio, false),
      image: booleanValue(input.image, false),
      video: booleanValue(input.video, false),
      pdf: booleanValue(input.pdf, false),
    },
    output: {
      text: booleanValue(output.text, true),
      audio: booleanValue(output.audio, false),
      image: booleanValue(output.image, false),
      video: booleanValue(output.video, false),
      pdf: booleanValue(output.pdf, false),
    },
    interleaved: interleavedValue(capabilities.interleaved),
  }
}

function openAICompatibleLimit(item: OpenAICompatibleModelItem): Provider.Model["limit"] {
  const limit: Record<string, unknown> = isRecord(item.limit) ? item.limit : {}
  return {
    context: numberValue(limit.context, numberValue(item.context_length, numberValue(item.max_context_length, 128000))),
    output: numberValue(limit.output, numberValue(item.max_output_tokens, 4096)),
  }
}

async function fetchOpenAICompatibleModels(fetcher: ModelListFetcher, endpoint: LocalProviderEndpoint) {
  return fetcher(`${endpoint.inferenceBaseURL}/models`, { signal: AbortSignal.timeout(5000) })
    .then(async (r) => {
      if (!r.ok) {
        log.debug("OpenAI-compatible model list fetch returned non-OK", {
          host: endpoint.discoveryHost,
          status: r.status,
        })
        return null
      }
      const parsed = asOpenAICompatibleModelList(await r.json())
      if (!parsed) {
        log.debug("OpenAI-compatible model list returned invalid schema", {
          host: endpoint.discoveryHost,
        })
      }
      return parsed
    })
    .catch((error) => {
      log.debug("OpenAI-compatible model list fetch failed", { host: endpoint.discoveryHost, error })
      return null
    })
}

type LocalProviderEndpoint = {
  discoveryHost: string
  inferenceBaseURL: string
  local: boolean
}

function normalizeLocalProviderURL(input: string) {
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`
  return new URL(withProtocol)
}

function trimTrailingSlash(input: string) {
  return input.replace(/\/+$/, "")
}

function isLocalProviderHost(hostname: string) {
  return isLocalHostname(hostname)
}

function resolveLocalProviderEndpoint(input: {
  provider: Provider.Info
  envKey: string
  defaultHost: string
}): LocalProviderEndpoint {
  const configured = typeof input.provider.options?.baseURL === "string" ? input.provider.options.baseURL : undefined
  const raw = configured || process.env[input.envKey] || input.defaultHost
  const url = normalizeLocalProviderURL(raw)
  const normalized = trimTrailingSlash(url.toString())
  const discoveryHost = normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized
  return {
    discoveryHost,
    inferenceBaseURL: normalized.endsWith("/v1") ? normalized : `${normalized}/v1`,
    local: isLocalProviderHost(url.hostname),
  }
}

function ollamaCompatibleLoader(providerID: string, envKey: string, defaultHost: string): CustomLoader {
  return async (provider) => {
    const initialEndpoint = resolveLocalProviderEndpoint({ provider, envKey, defaultHost })
    const initialFetcher = initialEndpoint.local ? fetch : Ssrf.pinnedFetch
    const reachable = await initialFetcher(`${initialEndpoint.discoveryHost}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
      .then((r) => {
        if (!r.ok)
          log.debug("Ollama-compatible reachability probe returned non-OK", {
            providerID,
            host: initialEndpoint.discoveryHost,
            status: r.status,
          })
        return r.ok
      })
      .catch((error) => {
        log.debug("Ollama-compatible reachability probe failed", {
          providerID,
          host: initialEndpoint.discoveryHost,
          error,
        })
        return false
      })

    return {
      autoload: reachable,
      options: reachable ? { baseURL: initialEndpoint.inferenceBaseURL } : {},
      async discoverModels(provider) {
        const endpoint = resolveLocalProviderEndpoint({ provider, envKey, defaultHost })
        const fetcher = endpoint.local ? fetch : Ssrf.pinnedFetch
        const res = await fetcher(`${endpoint.discoveryHost}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(
          (error) => {
            log.debug("Ollama-compatible model discovery failed", { providerID, host: endpoint.discoveryHost, error })
            return null
          },
        )
        if (!res?.ok) {
          if (res)
            log.debug("Ollama-compatible model discovery returned non-OK", {
              providerID,
              host: endpoint.discoveryHost,
              status: res.status,
            })
          return {}
        }
        let data: { models: { name: string }[] } | null = null
        try {
          data = asOllamaTags(await res.json())
        } catch (error) {
          log.debug("Ollama-compatible model discovery returned invalid JSON", {
            providerID,
            host: endpoint.discoveryHost,
            error,
          })
        }
        if (!data) {
          log.debug("Ollama-compatible model discovery returned invalid schema", {
            providerID,
            host: endpoint.discoveryHost,
          })
          return {}
        }
        const models: Record<string, Provider.Model> = {}
        for (const m of data.models) {
          const id = ModelID.make(m.name)
          models[id] = {
            id,
            providerID: ProviderID.make(providerID),
            name: m.name,
            api: { id: m.name, url: endpoint.inferenceBaseURL, npm: "@ai-sdk/openai-compatible" },
            capabilities: {
              temperature: true,
              reasoning: false,
              attachment: false,
              // Local inference models have inconsistent tool-calling support.
              // Default to false so they don't silently get selected for agent
              // workflows that depend on reliable tool execution.
              toolcall: false,
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
  return async (provider) => {
    const initialEndpoint = resolveLocalProviderEndpoint({ provider, envKey, defaultHost })
    const initialFetcher = initialEndpoint.local ? fetch : Ssrf.pinnedFetch
    const initial = await fetchOpenAICompatibleModels(initialFetcher, initialEndpoint)
    const reachable = !!initial

    return {
      autoload: reachable,
      options: reachable ? { baseURL: initialEndpoint.inferenceBaseURL } : {},
      async discoverModels(provider) {
        const endpoint = resolveLocalProviderEndpoint({ provider, envKey, defaultHost })
        const fetcher = endpoint.local ? fetch : Ssrf.pinnedFetch
        const discovered = await fetchOpenAICompatibleModels(fetcher, endpoint)
        if (!discovered) return {}
        const models: Record<string, Provider.Model> = {}
        for (const item of discovered.data ?? []) {
          if (typeof item.id !== "string" || !item.id.trim()) continue
          const id = ModelID.make(item.id)
          const caps = openAICompatibleCapabilities(item)
          // Local inference endpoints (ax-studio) serve models with inconsistent
          // tool-calling support. Override to false so discovered models don't
          // silently get selected for agent workflows that need tools.
          caps.toolcall = false
          models[id] = {
            id,
            providerID: ProviderID.make(providerID),
            name: item.id,
            api: { id: item.id, url: endpoint.inferenceBaseURL, npm: "@ai-sdk/openai-compatible" },
            capabilities: caps,
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

const CLI_DEFAULT_MODEL_NAMES: Record<string, string> = {
  "claude-code": "Claude Code default",
  "gemini-cli": "Gemini CLI default",
  "codex-cli": "Codex CLI default",
  "grok-build-cli": "Grok Build CLI default",
  "qoder-cli": "Qoder CLI default",
  "antigravity-cli": "Antigravity CLI default",
  "kimi-cli": "Kimi Code CLI default",
}

// A stale standalone `codex` launcher can shadow the newer executable bundled
// with the ChatGPT app. Codex CLI models are version-coupled, so prefer the
// newest executable found on the real PATH rather than failing a selected
// model solely because an older duplicate appears first.
const cliBinaryCache = new Map<string, Promise<string | null>>()

async function resolveCliBinary(providerID: string, binary: string) {
  const cacheKey = `${providerID}:${binary}`
  const cached = cliBinaryCache.get(cacheKey)
  if (cached) return cached

  const resolving = (async () => {
    const primary = which(binary)
    if (!primary || providerID !== "codex-cli") return primary

    const candidates = [...new Set(whichAll(binary, undefined, { extraDirs: false }))]
    if (candidates.length < 2) return primary

    const inspected = await Promise.all(
      candidates.map(async (candidate) => {
        const result = await Process.run([candidate, "--version"], { timeout: 2_000, nothrow: true }).catch(
          () => undefined,
        )
        return {
          path: candidate,
          version: result?.code === 0 ? `${result.stdout}\n${result.stderr}` : undefined,
        }
      }),
    )
    const selected = selectPreferredCodexBinary(inspected) ?? primary
    if (selected !== primary) {
      log.info("selected newer Codex CLI executable", { primary, selected })
    }
    return selected
  })()

  cliBinaryCache.set(cacheKey, resolving)
  return resolving
}

function cliModels(providerID: string, provider: Provider.Info, resolved?: string): Record<string, Provider.Model> {
  const base = Object.values(provider.models)[0]
  if (!base) return {}
  const name = CLI_DEFAULT_MODEL_NAMES[providerID] ?? "CLI default"
  const models: Record<string, Provider.Model> = {}
  const add = (modelID: string, modelName: string) => {
    const id = ModelID.make(modelID)
    models[id] = {
      ...base,
      id,
      providerID: ProviderID.make(providerID),
      api: { ...base.api, id: modelID },
      name: modelName,
    }
  }
  add(providerID, name)
  if (resolved && resolved !== providerID) {
    add(resolved, `${name} (${resolved})`)
  }
  return models
}

function cliModel(providerID: string, provider: Provider.Info, modelID: string): Provider.Model | undefined {
  const base = Object.values(provider.models)[0]
  if (!base) return
  return {
    ...base,
    id: ModelID.make(modelID),
    providerID: ProviderID.make(providerID),
    api: { ...base.api, id: modelID },
    name: modelID === providerID ? (CLI_DEFAULT_MODEL_NAMES[providerID] ?? "CLI default") : modelID,
  }
}

interface CliLoaderOpts {
  providerID: string
  binary: string
  args: string[]
  parser: CliOutputParser
  promptMode: "stdin" | "arg" | "positional"
  promptFlag?: string
}

function cliLoader(opts: CliLoaderOpts): CustomLoader {
  return async (provider) => {
    return {
      autoload: false,
      async getModel(_sdk: any, modelID: string) {
        const path = await resolveCliBinary(opts.providerID, opts.binary)
        if (!path) throw new Error(`${opts.binary} CLI not found in PATH`)
        const authError = await checkCliProviderAuth(opts.providerID, path)
        if (authError) throw new Error(authError)
        const published = cliModel(opts.providerID, provider, modelID)
        if (!published) throw new Error(`Model not found: ${opts.providerID}/${modelID}`)
        return new CliLanguageModel({
          providerID: opts.providerID,
          modelID,
          binary: path,
          args: opts.args,
          parser: opts.parser,
          providerEnvKeys: provider.env,
          promptMode: opts.promptMode,
          promptFlag: opts.promptFlag,
        })
      },
      async discoverModels() {
        const path = await resolveCliBinary(opts.providerID, opts.binary)
        if (!path) return {}
        const authError = await checkCliProviderAuth(opts.providerID, path)
        if (authError) return {}
        const resolved = await resolveCliModel(opts.providerID)
        return cliModels(opts.providerID, provider, resolved.model)
      },
    }
  }
}

const claudeCode = getCliProviderDefinition("claude-code")!
const geminiCli = getCliProviderDefinition("gemini-cli")!
const codexCli = getCliProviderDefinition("codex-cli")!
const grokBuildCli = getCliProviderDefinition("grok-build-cli")!
const qoderCli = getCliProviderDefinition("qoder-cli")!
const antigravityCli = getCliProviderDefinition("antigravity-cli")!
const kimiCli = getCliProviderDefinition("kimi-cli")!

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
  "ax-studio": openAICompatibleLoader("ax-studio", "AX_STUDIO_HOST", "http://localhost:18080"),
  "ax-engine": axEngineLoader(),
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
  "grok-build-cli": cliLoader({
    providerID: "grok-build-cli",
    binary: grokBuildCli.binary,
    args: grokBuildCli.args,
    parser: grokBuildCli.parser,
    promptMode: grokBuildCli.promptMode,
    promptFlag: grokBuildCli.promptFlag,
  }),
  "qoder-cli": cliLoader({
    providerID: "qoder-cli",
    binary: qoderCli.binary,
    args: qoderCli.args,
    parser: qoderCli.parser,
    promptMode: qoderCli.promptMode,
    promptFlag: qoderCli.promptFlag,
  }),
  "antigravity-cli": cliLoader({
    providerID: "antigravity-cli",
    binary: antigravityCli.binary,
    args: antigravityCli.args,
    parser: antigravityCli.parser,
    promptMode: antigravityCli.promptMode,
    promptFlag: antigravityCli.promptFlag,
  }),
  "kimi-cli": cliLoader({
    providerID: "kimi-cli",
    binary: kimiCli.binary,
    args: kimiCli.args,
    parser: kimiCli.parser,
    promptMode: kimiCli.promptMode,
    promptFlag: kimiCli.promptFlag,
  }),
}
