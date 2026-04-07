import type { Provider } from "./provider"
import { ProviderID, ModelID } from "./schema"
import { which } from "../util/which"
import { Ssrf } from "../util/ssrf"
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
    const reachable = await Ssrf.pinnedFetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) })
      .then((r) => r.ok)
      .catch(() => false)

    return {
      autoload: reachable,
      options: reachable ? { baseURL: `${host}/v1` } : {},
      async discoverModels() {
        const res = await Ssrf.pinnedFetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
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
  authCheck?: (binary: string) => Promise<boolean>
}

async function checkClaudeAuth(binary: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([binary, "--print", "--output-format", "stream-json", "ping"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1", CI: "true" },
    })
    const timer = setTimeout(() => proc.kill(), 5000)
    const stdout = await new Response(proc.stdout).text().catch(() => "")
    clearTimeout(timer)
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed[0] !== "{") continue
      try {
        const event = JSON.parse(trimmed)
        if (event.type === "system" && event.apiKeySource === "none") return false
        if (event.type === "error" && event.error === "authentication_failed") return false
      } catch {}
    }
    return true
  } catch {
    return true // if probe fails, let the actual request surface the error
  }
}

function cliLoader(opts: CliLoaderOpts): CustomLoader {
  return async (provider) => {
    const path = which(opts.binary)
    const info = await resolveCliModel(opts.providerID)
    const authenticated = path && opts.authCheck ? await opts.authCheck(path) : true
    return {
      autoload: false,
      async getModel(_sdk: any, modelID: string) {
        if (!path) throw new Error(`${opts.binary} CLI not found in PATH`)
        if (!authenticated) throw new Error(`${opts.binary} CLI is not logged in — run \`${opts.binary} login\` first`)
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
        if (!path || !authenticated) return {}
        return cliModels(opts.providerID, provider, info.model)
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
  "claude-code": cliLoader({
    providerID: "claude-code",
    binary: "claude",
    args: ["--print", "--verbose", "--output-format", "stream-json"],
    parser: claudeCodeParser,
    promptMode: "stdin",
    authCheck: checkClaudeAuth,
  }),
  "gemini-cli": cliLoader({
    providerID: "gemini-cli",
    binary: "gemini",
    args: ["--output-format", "stream-json"],
    parser: geminiCliParser,
    promptMode: "arg",
    promptFlag: "-p",
  }),
  "codex-cli": cliLoader({
    providerID: "codex-cli",
    binary: "codex",
    args: ["exec", "--json", "--skip-git-repo-check"],
    parser: codexCliParser,
    promptMode: "stdin",
  }),
}
