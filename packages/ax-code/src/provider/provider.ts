import z from "zod"
import os from "os"
import fuzzysort from "fuzzysort"
import { Config } from "../config/config"
import { mapValues, mergeDeep, omit, pickBy, sortBy } from "remeda"
import { NoSuchModelError, type LanguageModel } from "ai"
import { Log } from "../util/log"
import { toErrorMessage } from "@/util/error-message"
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
import { withTimeout } from "../util/timeout"
import { isNonEmptyRecord, recordCount } from "@/util/record"

// Direct imports for bundled providers
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { createXai } from "@ai-sdk/xai"
import { ProviderTransform } from "./transform"
import { Installation } from "../installation"
import { providerModelKey, providerModelList } from "./model-key"
import {
  ProviderInfo as ProviderInfoSchema,
  ProviderModel as ProviderModelSchema,
  fromModelsDevProvider as convertModelsDevProvider,
  type ProviderInfo as ProviderInfoType,
  type ProviderModel as ProviderModelType,
} from "./model-info"
import { ModelID, ProviderID } from "./schema"
import { levenshtein } from "@/util/levenshtein"
import { isModelSupportedForProvider } from "./model-support"
import {
  CUSTOM_LOADERS,
  type CustomModelLoader,
  type CustomVarsLoader,
  type CustomDiscoverModels,
  type CustomLoader,
} from "./loaders"
import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"

export namespace Provider {
  const log = Log.create({ service: "provider" })

  // Emitted after background model discovery (CLI subprocess probes, local
  // LLM model-list fetches) finishes mutating the provider state. The TUI
  // refetches its provider list on this so discovered models appear once
  // ready, while startup itself never blocks on discovery. See `state()`.
  export const Event = {
    Updated: BusEvent.define("provider.updated", z.object({})),
  }
  const supported = isModelSupportedForProvider
  let modelCacheGeneration = 0
  const MODEL_CACHE_INVALIDATION_RETRY_LIMIT = 8

  function canonicalXaiApiModelID(modelID: string) {
    if (modelID === "grok-code-fast" || modelID === "grok-code-fast-1" || modelID === "grok-code-fast-1-0825") {
      return "grok-build-0.1"
    }
    return modelID
  }

  function sanitizeAuthString(value: unknown): unknown {
    if (typeof value !== "string") return value
    const next = value.replace(/[\r\n]+/g, "").trim()
    return next === "" ? undefined : next
  }

  export function authString(value: unknown): string | undefined {
    const sanitized = sanitizeAuthString(value)
    return typeof sanitized === "string" ? sanitized : undefined
  }

  function sanitizeProviderAuth<T extends Partial<Info>>(provider: T): T {
    const next = { ...provider }
    if (typeof next.key === "string") {
      const key = sanitizeAuthString(next.key)
      if (typeof key === "string") next.key = key
      else delete next.key
    }
    if (next.options && typeof next.options === "object" && "apiKey" in next.options) {
      const apiKey = sanitizeAuthString(next.options.apiKey)
      next.options = {
        ...next.options,
      }
      if (apiKey === undefined) delete next.options.apiKey
      else next.options.apiKey = apiKey
    }
    return next
  }

  function addLegacyXaiModelAliases(providerID: ProviderID, models: Record<string, Model>) {
    if (providerID !== ProviderID.xai) return

    const isLegacyGrok = (modelID: string) => {
      return /^grok-4[.-]20(?:-|\.|-|$)/i.test(modelID)
    }

    const addLegacyAlias = (aliasID: string) => {
      if (models[aliasID]) return
      const legacyTargets = Object.entries(models).filter(
        ([modelID]) =>
          isLegacyGrok(modelID) &&
          (modelID.includes("-reasoning") || modelID.includes("-non-reasoning") || modelID.includes("-0309-")),
      )
      if (legacyTargets.length === 0) return
      const reasoningModel = legacyTargets.find(
        ([modelID]) => modelID.includes("-reasoning") && !modelID.includes("-non-reasoning"),
      )
      const baseModel = reasoningModel ?? legacyTargets[0]
      if (!baseModel) return
      const [modelID, sourceModel] = baseModel
      models[aliasID] = {
        ...sourceModel,
        id: ModelID.make(aliasID),
        api: { ...sourceModel.api, id: modelID },
      }
    }

    addLegacyAlias("grok-4-1-fast")
    // grok-code-fast-1 is now a first-class entry in the xai snapshot block
    // (update-models.ts re-injects it from a reseller fallback if upstream
    // drops it). An alias here would silently route to grok-4.20-0309-reasoning
    // on the wire, which is a different model — deceptive UX.
  }
  type Lang = Exclude<LanguageModel, string>
  type SDK = {
    languageModel(modelID: string): unknown
    responses?: (modelID: string) => unknown
    chat?: (modelID: string) => unknown
  }

  export function wrapSSE(res: Response, ms: number, ctl: AbortController, signal?: AbortSignal) {
    if (typeof ms !== "number" || ms <= 0) return res
    if (!res.body) return res
    if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

    const reader = res.body.getReader()
    let settled = false
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", onAbort)
    }
    const abortReader = (reason?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      ctl.abort(reason)
      void reader.cancel(reason).catch(() => {})
    }
    const onAbort = () => abortReader(signal?.reason)

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) {
        abortReader(signal.reason)
      }
    }

    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
          const id = setTimeout(() => {
            const err = new Error("SSE read timed out")
            abortReader(err)
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
          settled = true
          cleanup()
          ctrl.close()
          return
        }

        ctrl.enqueue(part.value)
      },
      async cancel(reason) {
        cleanup()
        abortReader(reason)
      },
    })

    return new Response(body, {
      headers: new Headers(res.headers),
      status: res.status,
      statusText: res.statusText,
    })
  }

  const BUNDLED_PROVIDERS: Record<string, (options: any) => SDK> = {
    "@ai-sdk/google": createGoogleGenerativeAI,
    "@ai-sdk/openai-compatible": createOpenAICompatible,
    "@ai-sdk/xai": createXai,
  }

  function useLanguageModel(sdk: Record<string, unknown>) {
    return sdk.responses === undefined && sdk.chat === undefined
  }

  export const Model = ProviderModelSchema
  export type Model = ProviderModelType

  export const Info = ProviderInfoSchema
  export type Info = ProviderInfoType

  export const fromModelsDevProvider = convertModelsDevProvider

  const state = Instance.state(async () => {
    using _ = log.time("state")
    // Ensure shell env is loaded before reading API keys from process.env
    const { ensureShellEnv } = await import("@/runtime/shell-env")
    await ensureShellEnv()
    // Parallelize independent init calls — Config, ModelsDev, and Auth
    // have no cross-dependencies and each may involve network I/O.
    const [config, modelsDev, authEntries] = await Promise.all([Config.get(), ModelsDev.get(), Auth.all()])
    // fromModelsDevProvider may return undefined for malformed entries.
    // Filter those out so downstream code never observes a partial map.
    const database: Record<string, Info> = {}
    for (const [id, raw] of Object.entries(modelsDev)) {
      const converted = fromModelsDevProvider(raw)
      if (converted) database[id] = converted
    }

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
    const sdkPending = new Map<string, Promise<SDK>>()

    log.info("provider init started", { command: "provider.init", status: "started" })
    const initFailures: { source: string; error: unknown }[] = []

    const configProviders = Object.entries(config.provider ?? {})

    function mergeProvider(providerID: ProviderID, provider: Partial<Info>) {
      const sanitized = sanitizeProviderAuth(provider)
      const existing = providers[providerID]
      if (existing) {
        // @ts-expect-error
        providers[providerID] = mergeDeep(existing, sanitized)
        return
      }
      const match = database[providerID]
      if (!match) return
      // @ts-expect-error
      providers[providerID] = mergeDeep(match, sanitized)
    }

    function applyModelFilters(providerID: ProviderID, provider: Info) {
      const configProvider = config.provider?.[providerID]
      addLegacyXaiModelAliases(providerID, provider.models)

      for (const [modelID, model] of Object.entries(provider.models)) {
        const supportModelID = model.api.id ?? model.id ?? modelID
        model.api = {
          ...model.api,
          id: providerID === ProviderID.xai ? canonicalXaiApiModelID(supportModelID) : supportModelID,
        }
        if (!supported(providerID, supportModelID, model)) {
          delete provider.models[modelID]
          continue
        }
        if (modelID === "gpt-5-chat-latest") delete provider.models[modelID]
        if (model.status === "alpha" && !Flag.AX_CODE_ENABLE_EXPERIMENTAL_MODELS) delete provider.models[modelID]
        if (model.status === "deprecated") delete provider.models[modelID]
        if (
          (configProvider?.blacklist && configProvider.blacklist.includes(modelID)) ||
          (configProvider?.whitelist && !configProvider.whitelist.includes(modelID))
        )
          delete provider.models[modelID]

        try {
          model.variants = mapValues(ProviderTransform.variants(model), (v) => v)
        } catch (variantError) {
          log.warn("provider variant transform failed, skipping variants for model", {
            modelID,
            providerID,
            error: variantError,
          })
          model.variants = {}
        }

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
    }

    // extend database from config
    for (const [rawProviderID, provider] of configProviders) {
      const providerID = ProviderID.make(rawProviderID)
      const existing = database[providerID]
      const parsed: Info = {
        id: ProviderID.make(providerID),
        name: provider.name ?? existing?.name ?? providerID,
        env: provider.env ?? existing?.env ?? [],
        options:
          sanitizeProviderAuth({ options: mergeDeep(existing?.options ?? {}, provider.options ?? {}) }).options ?? {},
        source: "config",
        models: existing?.models ?? {},
      }
      addLegacyXaiModelAliases(providerID, parsed.models)

      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const nextID = model.id ?? modelID
        if (!supported(providerID, nextID, model)) continue
        const existingModel = parsed.models[model.id ?? modelID]
        const name = iife(() => {
          if (model.name) return model.name
          if (model.id && model.id !== modelID) return modelID
          return existingModel?.name ?? modelID
        })
        // IMPORTANT: every access through `existingModel?.` must chain an
        // additional `?.` for each nested property. `existingModel?.api.id`
        // parses as `(existingModel?.api).id` — when existingModel is
        // undefined, that evaluates to `undefined.id` and crashes. This
        // happens whenever a user configures a custom model whose ID
        // isn't in the built-in modelsDev database.
        const parsedModel: Model = {
          id: ModelID.make(modelID),
          api: {
            id: model.id ?? existingModel?.api?.id ?? modelID,
            npm:
              model.provider?.npm ??
              provider.npm ??
              existingModel?.api?.npm ??
              modelsDev[providerID]?.npm ??
              "@ai-sdk/openai-compatible",
            url: model.provider?.api ?? provider?.api ?? existingModel?.api?.url ?? modelsDev[providerID]?.api,
          },
          status: model.status ?? existingModel?.status ?? "active",
          name,
          providerID: ProviderID.make(providerID),
          capabilities: {
            temperature: model.temperature ?? existingModel?.capabilities?.temperature ?? false,
            reasoning: model.reasoning ?? existingModel?.capabilities?.reasoning ?? false,
            attachment: model.attachment ?? existingModel?.capabilities?.attachment ?? false,
            toolcall: model.tool_call ?? existingModel?.capabilities?.toolcall ?? true,
            input: {
              text: model.modalities?.input?.includes("text") ?? existingModel?.capabilities?.input?.text ?? true,
              audio: model.modalities?.input?.includes("audio") ?? existingModel?.capabilities?.input?.audio ?? false,
              image: model.modalities?.input?.includes("image") ?? existingModel?.capabilities?.input?.image ?? false,
              video: model.modalities?.input?.includes("video") ?? existingModel?.capabilities?.input?.video ?? false,
              pdf: model.modalities?.input?.includes("pdf") ?? existingModel?.capabilities?.input?.pdf ?? false,
            },
            output: {
              text: model.modalities?.output?.includes("text") ?? existingModel?.capabilities?.output?.text ?? true,
              audio: model.modalities?.output?.includes("audio") ?? existingModel?.capabilities?.output?.audio ?? false,
              image: model.modalities?.output?.includes("image") ?? existingModel?.capabilities?.output?.image ?? false,
              video: model.modalities?.output?.includes("video") ?? existingModel?.capabilities?.output?.video ?? false,
              pdf: model.modalities?.output?.includes("pdf") ?? existingModel?.capabilities?.output?.pdf ?? false,
            },
            interleaved: model.interleaved ?? existingModel?.capabilities?.interleaved ?? false,
          },
          options: mergeDeep(existingModel?.options ?? {}, model.options ?? {}),
          limit: {
            context: model.limit?.context ?? existingModel?.limit?.context ?? 0,
            input: model.limit?.input ?? existingModel?.limit?.input,
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
    for (const [id, provider] of Object.entries(authEntries)) {
      const providerID = ProviderID.make(id)
      if (disabled.has(providerID)) continue
      if (provider.type === "api") {
        mergeProvider(providerID, {
          source: "api",
          key: provider.key,
        })
      }
    }

    const plugins = await Plugin.list()
    const authGroups = new Map<string, typeof plugins>()
    for (const plugin of plugins) {
      if (!plugin.auth) continue
      const providerID = ProviderID.make(plugin.auth.provider)
      if (disabled.has(providerID)) continue
      const group = authGroups.get(plugin.auth.provider) ?? []
      group.push(plugin)
      authGroups.set(plugin.auth.provider, group)
    }
    for (const plugins of authGroups.values()) {
      for (const plugin of plugins) {
        try {
          const providerID = ProviderID.make(plugin.auth!.provider)
          const auth = await Auth.get(providerID)
          if (!auth) continue
          if (!plugin.auth!.loader) continue
          const options = await withTimeout(
            plugin.auth!.loader(() => Auth.get(providerID) as any, database[plugin.auth!.provider]),
            10_000,
            `plugin auth loader timed out for ${plugin.auth!.provider}`,
          )
          const opts = options ?? {}
          const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
          mergeProvider(providerID, patch)
        } catch (err) {
          initFailures.push({ source: `plugin-auth:${plugin.auth!.provider}`, error: err })
          log.warn("plugin auth loader failed", { provider: plugin.auth!.provider, error: err })
        }
      }
    }

    await Promise.all(
      Object.entries(CUSTOM_LOADERS).map(async ([id, fn]) => {
        try {
          const providerID = ProviderID.make(id)
          if (disabled.has(providerID)) return
          const configured = Object.prototype.hasOwnProperty.call(config.provider ?? {}, providerID)
          const data = database[providerID] ?? {
            id: ProviderID.make(id),
            name: id,
            env: [],
            options: {},
            source: "custom" as const,
            models: {},
          }
          if (!database[providerID]) database[providerID] = data
          const result = await withTimeout(fn(data), 15_000, `custom loader '${id}' timed out`)
          if (result && (result.autoload || providers[providerID] || configured)) {
            if (result.getModel) modelLoaders[providerID] = result.getModel
            if (result.vars) varsLoaders[providerID] = result.vars
            if (result.discoverModels) discoveryLoaders[providerID] = result.discoverModels
            const opts = result.options ?? {}
            const patch: Partial<Info> = providers[providerID] ? { options: opts } : { source: "custom", options: opts }
            mergeProvider(providerID, patch)
          }
        } catch (err) {
          initFailures.push({ source: `loader:${id}`, error: err })
          log.warn("custom provider loader failed", { provider: id, error: err })
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

      applyModelFilters(providerID, provider)

      if (!isNonEmptyRecord(provider.models) && !discoveryLoaders[providerID]) {
        delete providers[providerID]
        continue
      }

      log.info("found", { providerID })
    }

    // Run model discovery (CLI subprocess auth probes, local LLM /models and
    // /api/tags fetches) WITHOUT blocking state resolution. These were the
    // dominant startup cost: a `Promise.all` here waited on the slowest probe
    // — e.g. the claude-code auth `ping` — gating the provider list the TUI
    // blocks on before the prompt is usable. Cloud and CLI providers already
    // carry their snapshot models and are returned immediately; discovered
    // models stream in afterwards and the TUI refetches on `Event.Updated`.
    // Consumers that need the complete list await `state().discovery` (see
    // `ready()` and the cache-miss retry in `getModel()`).
    const runDiscovery = async () => {
      await Promise.all(
        Object.entries(discoveryLoaders).map(async ([id, loader]) => {
          const providerID = ProviderID.make(id)
          if (!providers[providerID]) return
          await (async () => {
            const discovered = await withTimeout(
              loader(providers[providerID]),
              10_000,
              `discovery loader '${id}' timed out`,
            )
            for (const [modelID, model] of Object.entries(discovered)) {
              providers[providerID].models[modelID] = model
            }
            applyModelFilters(providerID, providers[providerID])
          })().catch((e) => {
            initFailures.push({ source: `discovery:${id}`, error: e })
            log.warn("state discovery error", { id, error: e })
          })
        }),
      )

      // Drop providers whose models come solely from discovery (e.g. a local
      // LLM endpoint that turned out to expose nothing) now that discovery has
      // settled. Providers with snapshot/config models are unaffected.
      for (const [id, provider] of Object.entries(providers)) {
        const providerID = ProviderID.make(id)
        if (!isNonEmptyRecord(provider.models)) {
          delete providers[providerID]
        }
      }

      log.info("provider discovery completed", {
        command: "provider.discovery",
        status: "ok",
        providers: recordCount(providers),
      })
      Bus.publishDetached(Event.Updated, {})
    }

    // `.catch` here is load-bearing: in the warmup path nothing awaits
    // `discovery`, so an unexpected throw inside `runDiscovery` (it already
    // swallows per-loader failures, but the cleanup/publish steps could
    // regress) would surface as an unhandled rejection. Resolving to `void`
    // also keeps `ready()`/`getModel()` awaiters from ever seeing a rejection.
    const discovery: Promise<void> =
      Object.keys(discoveryLoaders).length > 0
        ? runDiscovery().catch((err) => log.warn("provider discovery failed", { err }))
        : Promise.resolve()

    const providerCount = recordCount(providers)
    if (initFailures.length > 0) {
      log.warn("provider init completed with failures", {
        command: "provider.init",
        status: "partial",
        providers: providerCount,
        failures: initFailures.map((f) => `${f.source}: ${toErrorMessage(f.error)}`),
      })
    } else {
      log.info("provider init completed", {
        command: "provider.init",
        status: "ok",
        providers: providerCount,
      })
    }

    return {
      generation: modelCacheGeneration,
      models: languages,
      modelPending: new Map<string, Promise<Lang>>(),
      providers,
      sdk,
      sdkPending,
      modelLoaders,
      varsLoaders,
      discovery,
    }
  })

  export function warmup(options?: { swallow?: boolean }) {
    const next = state().then(() => undefined)
    if (options?.swallow === false) {
      return next
    }
    return next.catch((err) => {
      log.warn("provider warmup failed", { err })
    })
  }

  export async function list() {
    return state().then((state) => state.providers)
  }

  // Await background model discovery (CLI probes, local LLM model lists) to
  // settle. `list()` deliberately returns before discovery so the TUI is not
  // blocked; callers that must observe the COMPLETE set — e.g. the `models`
  // command — await this first. Resolves immediately when there is nothing to
  // discover. Never rejects: discovery swallows per-loader failures.
  export async function ready() {
    await state().then((s) => s.discovery)
  }

  // Drop the cached provider state so the next `list()` / `getSDK()`
  // call re-reads `Auth.all()`, `Config.get()`, `ModelsDev.get()`, and
  // the CUSTOM_LOADERS pipeline. The server's `PUT /auth/:providerID`
  // handler calls this after `Auth.set()` succeeds; without it the
  // provider list stays stale until the process restarts because
  // `Instance.state()` caches the state forever per directory. This
  // is the narrowest fix for issue #13 — a full `Instance.reload()`
  // would also tear down LSP clients, MCP connections, the session
  // store, and the tool registry, which is disproportionate for an
  // auth-only change.
  export async function invalidate() {
    const currentState = await state()
    modelCacheGeneration++
    currentState.models.clear()
    currentState.modelPending.clear()
    currentState.sdkPending.clear()
    currentState.sdk.clear()
    await state.invalidate()
  }

  // Short-lived negative cache for provider install failures. Without it,
  // a hung npm registry or a permanent install error gets retried at the
  // request rate (one BunProc.install per getSDK call). 5s is short enough
  // that recovery from a transient registry blip is still automatic.
  const PROVIDER_INSTALL_NEGATIVE_CACHE_MS = 5_000
  const PROVIDER_INSTALL_TIMEOUT_MS = 60_000
  const providerInstallFailures = new Map<string, { at: number; error: unknown }>()

  async function getSDK(model: Model) {
    try {
      using _ = log.time("getSDK", {
        providerID: model.providerID,
      })
      const s = await state()
      const provider = s.providers[model.providerID]
      if (!provider) {
        throw new ModelNotFoundError({
          providerID: model.providerID,
          modelID: model.id,
        })
      }
      const options = { ...provider.options }

      if (model.api.npm.includes("@ai-sdk/openai-compatible") && options["includeUsage"] !== false) {
        options["includeUsage"] = true
      }
      const optionApiKey = authString(options["apiKey"])
      const providerApiKey = authString(provider.key)
      if (optionApiKey) options["apiKey"] = optionApiKey
      else if (providerApiKey) options["apiKey"] = providerApiKey
      else delete options["apiKey"]

      // Disable provider-level retries — ax-code handles retries via
      // SessionRetry with smarter logic (permanent error detection,
      // provider fallback, abort signal checks). The AI SDK default
      // (maxRetries: 2) burns ~7s retrying billing/quota 429 errors
      // that will never succeed.
      if (options["maxRetries"] === undefined) {
        options["maxRetries"] = 0
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
      if (model.headers)
        options["headers"] = {
          ...options["headers"],
          ...model.headers,
        }

      const key = Hash.fast(JSON.stringify({ providerID: model.providerID, npm: model.api.npm, options }))
      const existing = s.sdk.get(key)
      if (existing) return existing

      // Deduplicate concurrent SDK instantiation for the same key.
      // Without this, parallel calls race through the cache-miss path
      // and create duplicate SDK instances (and duplicate npm installs).
      const pending = s.sdkPending.get(key)
      if (pending) return pending

      const promise = (async (): Promise<SDK> => {
        const customFetch = options["fetch"]
        // Default to 90s per-chunk timeout to detect dead sockets from
        // network interruptions. Generous enough for extended thinking
        // (servers send keepalive events) but prevents indefinite hangs.
        // Explicit 0 or false disables the timeout.
        const rawChunkTimeout = options["chunkTimeout"]
        const chunkTimeout =
          rawChunkTimeout === false || rawChunkTimeout === 0
            ? 0
            : typeof rawChunkTimeout === "number"
              ? rawChunkTimeout
              : 90_000
        delete options["chunkTimeout"]

        options["fetch"] = async (input: string | Request | URL, init?: BunFetchRequestInit) => {
          // Preserve custom fetch if it exists, wrap it with timeout logic
          const fetchFn = customFetch ?? fetch
          // Shallow copy to avoid mutating caller's init object
          const opts = init ? { ...init } : {}
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
          return wrapSSE(res, chunkTimeout, chunkAbortCtl, opts.signal ?? undefined)
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
            {
              cause: new Error(
                `Package '${model.api.npm}' is not an allowed provider SDK. Only @ai-sdk/* packages are permitted.`,
              ),
            },
          )
        }

        let installedPath: string
        if (!model.api.npm.startsWith("file://")) {
          const cached = providerInstallFailures.get(model.api.npm)
          if (cached && Date.now() - cached.at < PROVIDER_INSTALL_NEGATIVE_CACHE_MS) {
            // Surface the cached install error instead of re-running install
            // against the same registry that just failed.
            throw cached.error
          }
          try {
            // Wrap install in a hard timeout; without it, a hung npm
            // registry stalls the session indefinitely. The surrounding
            // withTimeout below only wraps the post-install `import()`.
            installedPath = await withTimeout(
              BunProc.install(model.api.npm, "latest"),
              PROVIDER_INSTALL_TIMEOUT_MS,
              `installing provider package timed out: ${model.api.npm}`,
            )
            providerInstallFailures.delete(model.api.npm)
          } catch (error) {
            providerInstallFailures.set(model.api.npm, { at: Date.now(), error })
            throw error
          }
        } else {
          // Restrict file:// imports to a small set of trusted directories.
          // Previously the `if (!npm.startsWith("file://"))` allowlist check
          // above completely bypassed the allowlist for file:// URLs,
          // letting a compromised AX_CODE_MODELS_URL or a malicious config
          // entry trigger `import()` against an arbitrary path on disk —
          // i.e. RCE via file write + config injection.
          const filePath = model.api.npm.replace(/^file:\/\//, "")
          const resolved = path.resolve(filePath)
          const allowedDirs = [Instance.worktree, Global.Path.data, Global.Path.cache, Global.Path.config]
          const inAllowed = allowedDirs.some((dir) => {
            const normalizedDir = path.resolve(dir) + path.sep
            return (resolved + path.sep).startsWith(normalizedDir)
          })
          if (!inAllowed) {
            throw new InitError(
              { providerID: model.providerID },
              {
                cause: new Error(
                  `file:// path outside allowed directories (worktree, data, cache, config): ${model.api.npm}`,
                ),
              },
            )
          }
          log.info("loading local provider", { pkg: model.api.npm })
          installedPath = model.api.npm
        }

        const mod = await withTimeout(
          import(installedPath),
          15_000,
          `loading provider module timed out: ${model.api.npm}`,
        )

        const createKey = Object.keys(mod).find((key) => key.startsWith("create"))
        if (!createKey)
          throw new InitError(
            { providerID: model.providerID },
            { cause: new Error(`No 'create*' export found in package ${model.api.npm}`) },
          )
        const fn = mod[createKey]
        const loaded = fn({
          name: model.providerID,
          ...options,
        })
        s.sdk.set(key, loaded)
        return loaded as SDK
      })()

      s.sdkPending.set(key, promise)
      try {
        return await promise
      } finally {
        s.sdkPending.delete(key)
      }
    } catch (e) {
      throw new InitError({ providerID: model.providerID }, { cause: e })
    }
  }

  function languageCacheKey(model: Model, provider: Info) {
    const base = providerModelKey({ providerID: model.providerID, modelID: model.id })
    try {
      const options = JSON.stringify({
        providerOptions: provider.options,
        modelOptions: model.options,
        modelAPI: {
          npm: model.api.npm,
          id: model.api.id,
        },
      })
      if (!options) return base
      return `${base}#${Hash.fast(options)}`
    } catch {
      return base
    }
  }

  export async function getProvider(providerID: ProviderID) {
    return state().then((s) => s.providers[providerID])
  }

  export async function getModel(
    providerID: ProviderID,
    modelID: ModelID,
    awaitedDiscovery?: Promise<void>,
  ): Promise<Model> {
    const s = await state()
    const provider = s.providers[providerID]
    // Discovery (CLI/local model lists) runs in the background after `state()`
    // resolves, so a model can be legitimately missing only because discovery
    // hasn't finished. Await it and retry before reporting not-found — this
    // keeps headless/session resolution of a freshly-discovered model correct
    // without forcing every `list()` caller to wait for discovery. Guarding on
    // the discovery promise identity (rather than a boolean) awaits each
    // distinct discovery exactly once: a genuinely-missing model terminates
    // immediately after the first wait, while a concurrent `invalidate()` that
    // swaps in a fresh, still-in-flight discovery is re-awaited correctly.
    if ((!provider || !provider.models[modelID]) && awaitedDiscovery !== s.discovery) {
      await s.discovery
      return getModel(providerID, modelID, s.discovery)
    }
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

  export async function getLanguage(model: Model, retryDepth = 0): Promise<Lang> {
    const s = await state()
    const provider = s.providers[model.providerID]
    if (!provider) {
      throw new ModelNotFoundError({ providerID: model.providerID, modelID: model.id })
    }

    const key = languageCacheKey(model, provider)
    const retryAfterInvalidation = () => {
      if (retryDepth >= MODEL_CACHE_INVALIDATION_RETRY_LIMIT) {
        throw new Error(`Provider model cache repeatedly invalidated while loading ${model.providerID}/${model.id}`)
      }
      return getLanguage(model, retryDepth + 1)
    }

    const cached = s.models.get(key)
    if (cached && s.generation === modelCacheGeneration) return cached
    // In-flight dedup: the pending check below and the modelPending registration
    // after the loader promise is created run with no await in between, so concurrent
    // callers cannot both miss the pending entry and start duplicate loads.
    const pending = s.modelPending.get(key)
    if (pending) {
      const language = await pending
      if (s.generation === modelCacheGeneration) return language
      return retryAfterInvalidation()
    }

    const promise = Promise.resolve().then(async (): Promise<Lang> => {
      // CLI providers bypass SDK loading — their custom loaders handle everything
      if (s.modelLoaders[model.providerID] && model.api?.npm === "cli") {
        const language = await s.modelLoaders[model.providerID](null, model.api.id, {
          ...provider.options,
          ...model.options,
        })
        if (s.generation === modelCacheGeneration) s.models.set(key, language as Lang)
        return language as Lang
      }

      const sdk = await getSDK(model)

      try {
        const language = s.modelLoaders[model.providerID]
          ? await s.modelLoaders[model.providerID](sdk, model.api.id, { ...provider.options, ...model.options })
          : sdk.languageModel(model.api.id)
        if (s.generation === modelCacheGeneration) s.models.set(key, language as Lang)
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
    })
    s.modelPending.set(key, promise)

    try {
      const language = await promise
      if (s.generation === modelCacheGeneration) return language
      return retryAfterInvalidation()
    } finally {
      if (s.modelPending.get(key) === promise) {
        s.modelPending.delete(key)
      }
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

    // Await discovery so models populated solely by discovery loaders (e.g. a
    // local Ollama endpoint) are visible before the priority scan runs.
    // getModel() and defaultModel() both do this; omitting it here caused
    // getSmallModel() to return undefined during the startup discovery window.
    const s = await state()
    await s.discovery
    const provider = s.providers[providerID]
    if (provider) {
      let priority = ["gemini-3-flash", "gemini-flash", "llama-3.1-8b", "llama3-8b"]
      if (providerID.startsWith("zai")) {
        priority = ["glm-5-turbo", "glm-5"]
      }
      if (providerID === ProviderID.xai) {
        priority = ["grok-4-fast", "grok-4"]
      }
      if (providerID.startsWith("alibaba")) {
        priority = ["qwen3.6-flash", "deepseek-v4-flash", "deepseek-v4-pro", "qwen3.6-plus"]
      }
      // OpenAI and Anthropic were missing — without overrides they fell through to the
      // gemini/llama default list which never matched their model IDs, returning undefined
      // and silently disabling Auto-route's LLM tier for the majority of users.
      if (providerID === "openai" || providerID.startsWith("openai-")) {
        priority = ["gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"]
      }
      if (providerID === "anthropic" || providerID.startsWith("anthropic-")) {
        priority = ["claude-haiku-4-5", "haiku-4", "claude-3-5-haiku"]
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
      [
        (model) => {
          const index = priority.findIndex((filter) => model.id.includes(filter))
          return index === -1 ? Number.POSITIVE_INFINITY : index
        },
        "asc",
      ],
      [(model) => (model.id.includes("latest") ? 0 : 1), "asc"],
      [(model) => model.id, "desc"],
    )
  }

  export async function defaultModel() {
    const cfg = await Config.get()
    if (cfg.model) return parseModel(cfg.model)

    // Wait for background discovery: the persisted "recent" model may point at
    // a CLI/local provider whose `models` are only populated by discovery. On
    // a cache miss `list()` would skip that recent entry (its model is absent
    // pre-discovery) and silently fall through to a different default. Unlike
    // `getModel()`, this resolution has no retry, so block until complete.
    await ready()
    const providers = await list()
    const recent = (await Filesystem.readJson<{ recent?: unknown }>(path.join(Global.Path.state, "model.json"))
      .then((x) => providerModelList(x.recent))
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
    const validate = (providerID: string | undefined, modelID: string | undefined, source: string) => {
      const provider = providerID?.trim() ?? ""
      const id = modelID?.trim() ?? ""
      if (!provider || !id) {
        throw new Error(`Invalid model format "${source}"; expected "provider/model"`)
      }
      return {
        providerID: ProviderID.make(provider),
        modelID: ModelID.make(id),
      }
    }

    if (typeof model !== "string") {
      return validate(model.providerID, model.modelID ?? model.id, model.providerID)
    }
    // Auto-correct "provider:model" → "provider/model"
    if (!model.includes("/") && model.includes(":")) {
      model = model.replace(":", "/")
    }
    const [providerID, ...rest] = model.split("/")
    return validate(providerID, rest.join("/"), model)
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
