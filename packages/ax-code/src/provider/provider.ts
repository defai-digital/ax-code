import z from "zod"
import os from "os"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type LanguageModel } from "ai"
import { Log } from "../util/log"
import { BunProc } from "../bun"
import { Hash } from "../util/hash"
import { Plugin } from "../plugin"
import { NamedError } from "@ax-code/util/error"
import { ModelsDev } from "./models"
import { Auth } from "../auth"
import { Env } from "../env"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { iife } from "@/util/iife"
import { Global } from "../global"
import path from "path"
import { Filesystem } from "../util/filesystem"

// Direct imports for bundled providers
import { createGroq } from "@ai-sdk/groq"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createXai } from "@ai-sdk/xai"
import { ProviderTransform } from "./transform"
import { Installation } from "../installation"
import { ModelID, ProviderID } from "./schema"
import { levenshtein } from "@/util/levenshtein"
import { CUSTOM_LOADERS, type CustomModelLoader, type CustomVarsLoader, type CustomDiscoverModels, type CustomLoader } from "./loaders"

export namespace Provider {
  const log = Log.create({ service: "provider" })
  function supported(providerID: string, modelID: string) {
    const lower = modelID.toLowerCase()
    if (providerID === "google" || providerID === "google-vertex") {
      if (!lower.includes("gemini")) return true
      return lower.includes("gemini-3")
    }
    if (providerID === "openai") {
      if (!lower.includes("gpt")) return true
      if (lower.includes("gpt-oss")) return true
      return lower.includes("gpt-4") || lower.includes("gpt-5")
    }
    return true
  }
  type Lang = Exclude<LanguageModel, string>
  type SDK = {
    languageModel(modelID: string): unknown
    responses?: (modelID: string) => unknown
    chat?: (modelID: string) => unknown
  }

  function wrapSSE(res: Response, ms: number, ctl: AbortController) {
    if (typeof ms !== "number" || ms <= 0) return res
    if (!res.body) return res
    if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

    const reader = res.body.getReader()
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
          const id = setTimeout(() => {
            const err = new Error("SSE read timed out")
            ctl.abort(err)
            void reader.cancel(err)
            reject(err)
          }, ms)

          reader.read().then(
            (part) => {
              clearTimeout(id)
              resolve(part)
            },
            (err) => {
              clearTimeout(id)
              reject(err)
            },
          )
        })

        if (part.done) {
          ctrl.close()
          return
        }

        ctrl.enqueue(part.value)
      },
      async cancel(reason) {
        ctl.abort(reason)
        await reader.cancel(reason)
      },
    })

    return new Response(body, {
      headers: new Headers(res.headers),
      status: res.status,
      statusText: res.statusText,
    })
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
    "@ai-sdk/groq": createGroq,
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@ai-sdk/xai": createXai,
  }

  function useLanguageModel(sdk: Record<string, unknown>) {
    return sdk.responses === undefined && sdk.chat === undefined
  }

  export const Model = z
    .object({
      id: ModelID.zod,
      providerID: ProviderID.zod,
      api: z.object({
        id: z.string(),
        url: z.string(),
        npm: z.string(),
      }),
      name: z.string(),
      family: z.string().optional(),
      capabilities: z.object({
        temperature: z.boolean(),
        reasoning: z.boolean(),
        attachment: z.boolean(),
        toolcall: z.boolean(),
        input: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        output: z.object({
          text: z.boolean(),
          audio: z.boolean(),
          image: z.boolean(),
          video: z.boolean(),
          pdf: z.boolean(),
        }),
        interleaved: z.union([
          z.boolean(),
          z.object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          }),
        ]),
      }),
      cost: z.object({
        input: z.number(),
        output: z.number(),
        cache: z.object({
          read: z.number(),
          write: z.number(),
        }),
        experimentalOver200K: z
          .object({
            input: z.number(),
            output: z.number(),
            cache: z.object({
              read: z.number(),
              write: z.number(),
            }),
          })
          .optional(),
      }),
      limit: z.object({
        context: z.number(),
        input: z.number().optional(),
        output: z.number(),
      }),
      status: z.enum(["alpha", "beta", "deprecated", "active"]),
      options: z.record(z.string(), z.any()),
      headers: z.record(z.string(), z.string()),
      release_date: z.string(),
      variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
    })
    .meta({
      ref: "Model",
    })
  export type Model = z.infer<typeof Model>

  export const Info = z
    .object({
      id: ProviderID.zod,
      name: z.string(),
      source: z.enum(["env", "config", "custom", "api"]),
      env: z.string().array(),
      key: z.string().optional(),
      options: z.record(z.string(), z.any()),
      models: z.record(z.string(), Model),
    })
    .meta({
      ref: "Provider",
    })
  export type Info = z.infer<typeof Info>

  function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
    const m: Model = {
      id: ModelID.make(model.id),
      providerID: ProviderID.make(provider.id),
      name: model.name,
      family: model.family,
      api: {
        id: model.id,
        url: model.provider?.api ?? provider.api!,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      cost: {
        input: model.cost?.input ?? 0,
        output: model.cost?.output ?? 0,
        cache: {
          read: model.cost?.cache_read ?? 0,
          write: model.cost?.cache_write ?? 0,
        },
        experimentalOver200K: model.cost?.context_over_200k
          ? {
              cache: {
                read: model.cost.context_over_200k.cache_read ?? 0,
                write: model.cost.context_over_200k.cache_write ?? 0,
              },
              input: model.cost.context_over_200k.input,
              output: model.cost.context_over_200k.output,
            }
          : undefined,
      },
      limit: {
        context: model.limit.context,
        input: model.limit.input,
        output: model.limit.output,
      },
      capabilities: {
        temperature: model.temperature,
        reasoning: model.reasoning,
        attachment: model.attachment,
        toolcall: model.tool_call,
        input: {
          text: model.modalities?.input?.includes("text") ?? false,
          audio: model.modalities?.input?.includes("audio") ?? false,
          image: model.modalities?.input?.includes("image") ?? false,
          video: model.modalities?.input?.includes("video") ?? false,
          pdf: model.modalities?.input?.includes("pdf") ?? false,
        },
        output: {
          text: model.modalities?.output?.includes("text") ?? false,
          audio: model.modalities?.output?.includes("audio") ?? false,
          image: model.modalities?.output?.includes("image") ?? false,
          video: model.modalities?.output?.includes("video") ?? false,
          pdf: model.modalities?.output?.includes("pdf") ?? false,
        },
        interleaved: model.interleaved ?? false,
      },
      release_date: model.release_date,
      variants: {},
    }

    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)

    return m
  }

  export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
    return {
      id: ProviderID.make(provider.id),
      source: "custom",
      name: provider.name,
      env: provider.env ?? [],
      options: {},
      models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
    }
  }

  const state = Instance.state(async () => {
    using _ = log.time("state")
    const config = await Config.get()
    const modelsDev = await ModelsDev.get()
    const database = mapValues(modelsDev, fromModelsDevProvider)

    const disabled = new Set(config.disabled_providers ?? [])
    const enabled = config.enabled_providers ? new Set(config.enabled_providers) : null

    function isProviderAllowed(providerID: ProviderID): boolean {
      if (enabled && !enabled.has(providerID)) return false
      if (disabled.has(providerID)) return false
      return true
    }

    const providers: Record<ProviderID, Info> = {} as Record<ProviderID, Info>
    const languages = new Map<string, Lang>()
    const modelLoaders: {
      [providerID: string]: CustomModelLoader
    } = {}
    const varsLoaders: {
      [providerID: string]: CustomVarsLoader
    } = {}
    const discoveryLoaders: {
      [providerID: string]: CustomDiscoverModels
    } = {}
    const sdk = new Map<string, SDK>()

    log.info("init")

    const configProviders = Object.entries(config.provider ?? {})

    function mergeProvider(providerID: ProviderID, provider: Partial<Info>) {
      const existing = providers[providerID]
      if (existing) {
        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, provider)
        return
      }
      const match = database[providerID]
      if (!match) return
      // @ts-expect-error
      providers[providerID] = mergeDeep(match, provider)
    }

    // extend database from config
    for (const [providerID, provider] of configProviders) {
      const existing = database[providerID]
      const parsed: Info = {
        id: ProviderID.make(providerID),
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options: mergeDeep(existing?.options ?? {}, provider.options ?? {}),
        source: "config",
        models: existing?.models ?? {},
      }

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const nextID = model.id ?? modelID
        if (!supported(providerID, nextID)) continue
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        const parsedModel: Model = {
          id: ModelID.make(modelID),
          api: {
            id: model.id ?? existingModel?.api.id ?? modelID,
            npm:
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api.npm ??
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible",
            url: model.provider?.api ?? provider?.api ?? existingModel?.api.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID: ProviderID.make(providerID),
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities.input.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities.input.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities.input.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities.input.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities.input.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities.output.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities.output.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities.output.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities.output.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities.output.pdf ?? false,
            },
            interleaved: model.interleaved ?? false,
          },
          cost: {
            input: model?.cost?.input ?? existingModel?.cost?.input ?? 0,
            output: model?.cost?.output ?? existingModel?.cost?.output ?? 0,
            cache: {
              read: model?.cost?.cache_read ?? existingModel?.cost?.cache.read ?? 0,
              write: model?.cost?.cache_write ?? existingModel?.cost?.cache.write ?? 0,
            },
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            output: model.limit?.output ?? existingModel?.limit?.output ?? 0,
          },
          headers: mergeDeep(existingModel?.headers ?? {}, model.headers ?? {}),
          family: model.family ?? existingModel?.family ?? "",
          release_date: model.release_date ?? existingModel?.release_date ?? "",
          variants: {},
        }
        const merged = mergeDeep(ProviderTransform.variants(parsedModel), model.variants ?? {})
        parsedModel.variants = mapValues(
          pickBy(merged, (v) => !v.disabled),
          (v) => omit(v, ["disabled"]),
        )
        parsed.models[modelID] = parsedModel
      }
      database[providerID] = parsed
    }

    // load env
    const env = Env.all()
    for (const [id, provider] of Object.entries(database)) {
      const providerID = ProviderID.make(id)
      if (disabled.has(providerID)) continue
      const apiKey = provider.env.map((item) => env[item]).find(Boolean)
      if (!apiKey) continue
      mergeProvider(providerID, {
        source: "env",
        key: apiKey,
      })
    }

    // load apikeys
    for (const [id, provider] of Object.entries(await Auth.all())) {
      const providerID = ProviderID.make(id)
      if (disabled.has(providerID)) continue
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
    }

    await Promise.all(
      (await Plugin.list())
        .filter((plugin) => {
          if (!plugin.auth) return false
          const providerID = ProviderID.make(plugin.auth.provider)
          return !disabled.has(providerID)
        })
        .map(async (plugin) => {
          const providerID = ProviderID.make(plugin.auth!.provider)
          const auth = await Auth.get(providerID)
          if (!auth) return
          if (!plugin.auth!.loader) return
          const options = await plugin.auth!.loader(() => Auth.get(providerID) as any, database[plugin.auth!.provider])
          const opts = options ?? {}
          const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
          mergeProvider(providerID, patch)
        }),
    )

    await Promise.all(
      Object.entries(CUSTOM_LOADERS).map(async ([id, fn]) => {
        const providerID = ProviderID.make(id)
        if (disabled.has(providerID)) return
        const data = database[providerID]
        if (!data) {
          log.error("Provider does not exist in model list " + providerID)
          return
        }
        const result = await fn(data)
        if (result && (result.autoload || providers[providerID])) {
          if (result.getModel) modelLoaders[providerID] = result.getModel
          if (result.vars) varsLoaders[providerID] = result.vars
          if (result.discoverModels) discoveryLoaders[providerID] = result.discoverModels
          const opts = result.options ?? {}
          const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
          mergeProvider(providerID, patch)
        }
      }),
    )

    // load config
    for (const [id, provider] of configProviders) {
      const providerID = ProviderID.make(id)
      const partial: Partial<Info> = { source: "config" }
      if (provider.env) partial.env = provider.env
      if (provider.name) partial.name = provider.name
      if (provider.options) partial.options = provider.options
      mergeProvider(providerID, partial)
    }

    for (const [id, provider] of Object.entries(providers)) {
      const providerID = ProviderID.make(id)
      if (!isProviderAllowed(providerID)) {
        delete providers[providerID]
        continue
      }

      const configProvider = config.provider?.[providerID]

      for (const [modelID, model] of Object.entries(provider.models)) {
        model.api = { ...model.api, id: model.api.id ?? model.id ?? modelID }
        if (modelID === "gpt-5-chat-latest")
          delete provider.models[modelID]
        if (model.status === "alpha" && !Flag.AX_CODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        if (model.status === "deprecated") delete provider.models[modelID]
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]

        model.variants = mapValues(ProviderTransform.variants(model), (v) => v)

        // Filter out disabled variants from config
        const configVariants = configProvider?.models?.[modelID]?.variants
        if (configVariants && model.variants) {
          const merged = mergeDeep(model.variants, configVariants)
          model.variants = mapValues(
            pickBy(merged, (v) => !v.disabled),
            (v) => omit(v, ["disabled"]),
          )
        }
      }

      if (Object.keys(provider.models).length === 0) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    const gitlab = ProviderID.make("gitlab")
    if (discoveryLoaders[gitlab] && providers[gitlab]) {
      await (async () => {
        const discovered = await discoveryLoaders[gitlab]()
        for (const [modelID, model] of Object.entries(discovered)) {
          if (!providers[gitlab].models[modelID]) {
            providers[gitlab].models[modelID] = model
          }
        }
      })().catch((e) => log.warn("state discovery error", { id: "gitlab", error: e }))
    }

    return {
      models: languages,
      providers,
      sdk,
      modelLoaders,
      varsLoaders,
    }
  })

  export function warmup() {
    state().catch(() => {})
  }

  export async function list() {
    return state().then((state) => state.providers)
  }

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      const options = { ...provider.options }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }

      const baseURL = iife(() => {
        let url =
          typeof options["baseURL"] === "string" && options["baseURL"] !== "" ? options["baseURL"] : model.api.url
        if (!url) return

        // some models/providers have variable urls, ex: "https://${AZURE_RESOURCE_NAME}.services.ai.azure.com/anthropic/v1"
        // We track this in models.dev, and then when we are resolving the baseURL
        // we need to string replace that literal: "${AZURE_RESOURCE_NAME}"
        const loader = s.varsLoaders[model.providerID]
        if (loader) {
          const vars = loader(options)
          for (const [key, value] of Object.entries(vars)) {
            const field = "${" + key + "}"
            url = url.replaceAll(field, value)
          }
        }

        url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
          const val = Env.get(String(key))
          return val ?? item
        })
        return url
      })

      if (baseURL !== undefined) options["baseURL"] = baseURL
      if (options["apiKey"] === undefined && provider.key) options["apiKey"] = provider.key
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Hash.fast(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      const customFetch = options["fetch"]
      const chunkTimeout = options["chunkTimeout"]
      delete options["chunkTimeout"]

      options["fetch"] = async (input: string | Request | URL, init?: BunFetchRequestInit) => {
        // Preserve custom fetch if it exists, wrap it with timeout logic
        const fetchFn = customFetch ?? fetch
        const opts = init ?? {}
        const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
        const signals: AbortSignal[] = []

        if (opts.signal) signals.push(opts.signal)
        if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
        if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
          signals.push(AbortSignal.timeout(options["timeout"]))

        const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
        if (combined) opts.signal = combined

        const res = await fetchFn(input, {
          ...opts,
          // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
          timeout: false,
        })

        if (!chunkAbortCtl) return res
        return wrapSSE(res, chunkTimeout, chunkAbortCtl)
      }

      const bundledFn = BUNDLED_PROVIDERS[model.api.npm]
      if (bundledFn) {
        log.info("using bundled provider", { providerID: model.providerID, pkg: model.api.npm })
        const loaded = bundledFn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded
      }

      // Security: only allow known-safe scoped packages for dynamic install.
      // Prevents supply-chain attacks where compromised remote data (ModelsDev)
      // or a malicious config could trigger installation of arbitrary packages.
      const NPM_ALLOWLIST = /^@ai-sdk\//
      if (!model.api.npm.startsWith("file://") && !NPM_ALLOWLIST.test(model.api.npm)) {
        throw new InitError(
          { providerID: model.providerID },
          { cause: new Error(`Package '${model.api.npm}' is not an allowed provider SDK. Only @ai-sdk/* packages are permitted.`) },
        )
      }

      let installedPath: string
      if (!model.api.npm.startsWith("file://")) {
        installedPath = await BunProc.install(model.api.npm, "latest")
      } else {
        log.info("loading local provider", { pkg: model.api.npm })
        installedPath = model.api.npm
      }

      const mod = await import(installedPath)

      const createKey = Object.keys(mod).find((key) => key.startsWith("create"))
      if (!createKey) throw new InitError({ providerID: model.providerID }, { cause: new Error(`No 'create*' export found in package ${model.api.npm}`) })
      const fn = mod[createKey]
      const loaded = fn({
        name: model.providerID,
        ...options,
      })
      s.sdk.set(key, loaded)
      return loaded as SDK
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  export async function getProvider(providerID: ProviderID) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(providerID: ProviderID, modelID: ModelID) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) {
      const availableProviders = Object.keys(s.providers)
      const fuzzyMatches = fuzzysort.go(providerID, availableProviders, { limit: 3, threshold: -10000 })
      let suggestions = fuzzyMatches.map((m) => m.target)
      // Fallback to Levenshtein distance for typos fuzzysort can't handle (e.g. "xia" → "xai")
      if (suggestions.length === 0) {
        suggestions = availableProviders
          .map((p) => ({ p, d: levenshtein(providerID, p) }))
          .filter(({ d }) => d <= 2)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .map(({ p }) => p)
      }
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }

    const info = provider.models[modelID]
    if (!info) {
      const availableModels = Object.keys(provider.models)
      const matches = fuzzysort.go(modelID, availableModels, { limit: 3, threshold: -10000 })
      const suggestions = matches.map((m) => m.target)
      throw new ModelNotFoundError({ providerID, modelID, suggestions })
    }
    return info
  }

  export async function getLanguage(model: Model): Promise<Lang> {
    const s = await state()
    const key = `${model.providerID}/${model.id}`
    if (s.models.has(key)) return s.models.get(key)!

    const provider = s.providers[model.providerID]
    const sdk = await getSDK(model)

    try {
      const language = s.modelLoaders[model.providerID]
        ? await s.modelLoaders[model.providerID](sdk, model.api.id, { ...provider.options, ...model.options })
        : sdk.languageModel(model.api.id)
      s.models.set(key, language as Lang)
      return language as Lang
    } catch (e) {
      if (e instanceof NoSuchModelError)
        throw new ModelNotFoundError(
          {
            modelID: model.id,
            providerID: model.providerID,
          },
          { cause: e },
        )
      throw e
    }
  }

  export async function closest(providerID: ProviderID, query: string[]) {
    const s = await state()
    const provider = s.providers[providerID]
    if (!provider) return undefined
    for (const item of query) {
      for (const modelID of Object.keys(provider.models)) {
        if (modelID.includes(item))
          return {
            providerID,
            modelID,
          }
      }
    }
  }

  export async function getSmallModel(providerID: ProviderID) {
    const cfg = await Config.get()

    if (cfg.small_model) {
      const parsed = parseModel(cfg.small_model)
      return getModel(parsed.providerID, parsed.modelID)
    }

    const provider = await state().then((state) => state.providers[providerID])
    if (provider) {
      let priority = [
        "gemini-3-flash",
        "gemini-flash",
        "llama-3.1-8b",
        "llama3-8b",
      ]
      if (providerID.startsWith("zai")) {
        priority = ["glm-4.7-flash", "glm-4.5-flash", "glm-5-turbo"]
      }
      if (providerID === ProviderID.xai) {
        priority = ["grok-4-fast", "grok-4"]
      }
      for (const item of priority) {
        for (const model of Object.keys(provider.models)) {
          if (model.includes(item)) return getModel(providerID, ModelID.make(model))
        }
      }
    }

    return undefined
  }

  const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
  export function sort<T extends { id: string }>(models: T[]) {
    return sortBy(
      models,
      [(model) => priority.findIndex((filter) => model.id.includes(filter)), "desc"],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    const providers = await list()
    const recent = (await Filesystem.readJson<{ recent?: { providerID: ProviderID; modelID: ModelID }[] }>(
      path.join(Global.Path.state, "model.json"),
    )
      .then((x) => (Array.isArray(x.recent) ? x.recent : []))
      .catch(() => [])) as { providerID: ProviderID; modelID: ModelID }[]
    for (const entry of recent) {
      const provider = providers[entry.providerID]
      if (!provider) continue
      if (!provider.models[entry.modelID]) continue
      return { providerID: entry.providerID, modelID: entry.modelID }
    }

    const provider = Object.values(providers).find((p) => !cfg.provider || Object.keys(cfg.provider).includes(p.id))
    if (provider) {
      const [model] = sort(Object.values(provider.models))
      if (!model) throw new Error("no models found")
      return {
        providerID: provider.id,
        modelID: model.id,
      }
    }

    const disabled = new Set(cfg.disabled_providers ?? [])
    const enabled = cfg.enabled_providers ? new Set(cfg.enabled_providers) : undefined
    const fallback = Object.values(await ModelsDev.get()).find((item) => {
      const id = ProviderID.make(item.id)
      if (enabled && !enabled.has(id)) return false
      if (disabled.has(id)) return false
      if (cfg.provider && !Object.keys(cfg.provider).includes(item.id)) return false
      return true
    })
    if (!fallback) throw new Error("no providers found")
    const [model] = sort(Object.values(fallback.models))
    if (!model) throw new Error("no models found")
    return {
      providerID: ProviderID.make(fallback.id),
      modelID: ModelID.make(model.id),
    }
  }

  export function parseModel(model: string | { providerID: string; modelID?: string; id?: string }) {
    if (typeof model !== "string") {
      return {
        providerID: ProviderID.make(model.providerID),
        modelID: ModelID.make(model.modelID ?? model.id ?? ""),
      }
    }
    const [providerID, ...rest] = model.split("/")
    return {
      providerID: ProviderID.make(providerID),
      modelID: ModelID.make(rest.join("/")),
    }
  }

  export const ModelNotFoundError = NamedError.create(
    "ProviderModelNotFoundError",
    z.object({
      providerID: ProviderID.zod,
      modelID: ModelID.zod,
      suggestions: z.array(z.string()).optional(),
    }),
  )

  export const InitError = NamedError.create(
    "ProviderInitError",
    z.object({
      providerID: ProviderID.zod,
    }),
  )
}
