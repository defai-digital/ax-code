import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@/provider/models"
import { findRegisteredModelCapabilities } from "@/provider/model-capabilities"
import { isRetiredProviderID } from "@/provider/retired-providers"
import { isLocalHostname } from "@/util/local-host"
import { isNonChatModelID, skuKey } from "@/provider/model-selectability"
import { isRecord } from "@/util/record"
import { Ssrf } from "@/util/ssrf"

export namespace CustomApiProvider {
  export const Protocol = z.enum(["openai-compatible", "anthropic-compatible"])
  export type Protocol = z.infer<typeof Protocol>

  export const ProviderID = z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{0,62}$/, "Provider ID must be a lowercase slug with at most 63 characters")

  const BaseURL = z
    .string()
    .trim()
    .min(1, "Base URL is required")
    .max(2_048, "Base URL cannot exceed 2,048 characters")
    .superRefine((value, context) => {
      let url: URL
      try {
        url = new URL(value)
      } catch {
        context.addIssue({ code: "custom", message: "Base URL must be a valid HTTP(S) URL" })
        return
      }
      if (url.protocol !== "http:" && url.protocol !== "https:")
        context.addIssue({ code: "custom", message: "Base URL must use HTTP or HTTPS" })
      if (url.username || url.password)
        context.addIssue({ code: "custom", message: "Base URL must not contain credentials" })
      if (url.search || url.hash)
        context.addIssue({ code: "custom", message: "Base URL must not contain a query string or fragment" })
    })

  export const Model = z
    .object({
      id: z
        .string()
        .trim()
        .min(1, "Model ID is required")
        .max(256, "Model ID cannot exceed 256 characters")
        .refine((value) => !/\s/u.test(value), "Model ID must not contain whitespace")
        .refine(
          (value) =>
            !Array.from(value).some((character) => {
              const codePoint = character.codePointAt(0) ?? 0
              return codePoint <= 0x1f || codePoint === 0x7f
            }),
          "Model ID must not contain control characters",
        ),
      name: z.string().trim().min(1).max(120).optional(),
      contextWindow: z.number().int().positive().safe(),
      outputLimit: z.number().int().positive().safe(),
      toolCall: z.boolean(),
      reasoning: z.boolean(),
      attachment: z.boolean(),
      temperature: z.boolean(),
    })
    .strict()
    .refine((model) => model.outputLimit <= model.contextWindow, {
      message: "Model output limit cannot exceed its context window",
      path: ["outputLimit"],
    })
  export type Model = z.infer<typeof Model>

  export const Upsert = z
    .object({
      name: z.string().trim().min(1, "Provider name is required").max(120),
      protocol: Protocol,
      baseURL: BaseURL,
      apiKey: z.string().min(1).max(16_384).optional(),
      allowInsecureHttp: z.boolean().optional().default(false),
      models: z
        .array(Model)
        .max(128, "A custom provider can declare at most 128 models")
        .superRefine((models, context) => {
          const seen = new Set<string>()
          for (const [index, model] of models.entries()) {
            if (seen.has(model.id))
              context.addIssue({ code: "custom", message: `Duplicate model ID: ${model.id}`, path: [index, "id"] })
            seen.add(model.id)
          }
        })
        .optional(),
      // Re-run GET /models even when the base URL is unchanged, replacing the
      // stored model list with what the endpoint reports now.
      refreshModels: z.boolean().optional(),
    })
    .strict()
    .superRefine((input, context) => {
      if (!needsInsecureHttpAcknowledgement(input.baseURL) || input.allowInsecureHttp) return
      context.addIssue({
        code: "custom",
        message: "Non-loopback HTTP requires explicit insecure transport acknowledgement",
        path: ["allowInsecureHttp"],
      })
    })
  export type Upsert = z.infer<typeof Upsert>

  export const View = z
    .object({
      providerID: ProviderID,
      name: z.string(),
      protocol: Protocol,
      baseURL: BaseURL,
      hasApiKey: z.boolean(),
      models: z.array(Model),
    })
    .strict()
  export type View = z.infer<typeof View>
  export const ListView = z.array(View)

  export const Error = NamedError.create("CustomApiProviderError", z.object({ message: z.string() }))

  function isLoopbackHostname(hostname: string) {
    const host = hostname.toLowerCase()
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host)
  }

  function needsInsecureHttpAcknowledgement(baseURL: string) {
    try {
      const url = new URL(baseURL)
      return url.protocol === "http:" && !isLoopbackHostname(url.hostname)
    } catch {
      return false
    }
  }

  const DISCOVERY_TIMEOUT_MS = 8_000
  export const DEFAULT_CONTEXT_WINDOW = 128_000
  export const DEFAULT_OUTPUT_LIMIT = 16_384

  export function identityFromBaseURL(baseURL: string): { name: string; providerID: string } {
    let host = "custom-api"
    try {
      host = new URL(baseURL).hostname
    } catch {
      // Keep the fallback slug when the URL is still being typed.
    }
    const clean = host.replace(/^\[|\]$/g, "").replace(/^www\./i, "")
    const name = (clean || "Custom API").slice(0, 120)
    // OpenCode-style one-api/new-api IDs are slugs (`myapi`), not hostnames.
    // Dots in `127.0.0.1` look like a model path and break preference pruning.
    let providerID = clean
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63)
    if (!/^[a-z0-9]/.test(providerID)) providerID = `c${providerID}`.slice(0, 63)
    if (!providerID) providerID = "custom-api"
    return { name, providerID }
  }

  export function catalogModelKey(modelID: string) {
    return skuKey(modelID)
  }

  function positiveSafeInt(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value) && value > 0) return value
    if (typeof value === "string" && /^\d+$/.test(value)) {
      const parsed = Number(value)
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
    }
  }

  function payloadLimits(raw?: Record<string, unknown>): { context?: number; output?: number } {
    if (!raw) return {}
    const limit = isRecord(raw.limit) ? raw.limit : undefined
    return {
      context:
        positiveSafeInt(limit?.context) ??
        positiveSafeInt(raw.context_length) ??
        positiveSafeInt(raw.context_window) ??
        positiveSafeInt(raw.max_context_length) ??
        positiveSafeInt(raw.max_model_len) ??
        positiveSafeInt(raw.max_input_tokens),
      output:
        positiveSafeInt(limit?.output) ?? positiveSafeInt(raw.max_output_tokens) ?? positiveSafeInt(raw.max_output),
    }
  }

  export function catalogLimitForModelID(
    modelID: string,
    catalog: Record<
      string,
      { models?: Record<string, { id?: string; limit?: { context?: number; output?: number } }> }
    >,
  ): { context: number; output: number } | undefined {
    const needle = catalogModelKey(modelID)
    if (!needle) return
    const contexts: number[] = []
    const outputs: number[] = []
    for (const provider of Object.values(catalog)) {
      for (const [id, model] of Object.entries(provider.models ?? {})) {
        if (catalogModelKey(model.id ?? id) !== needle) continue
        const context = model.limit?.context
        const output = model.limit?.output
        if (!context || context <= 0 || !output || output <= 0) continue
        contexts.push(context)
        outputs.push(output)
      }
    }
    // Reseller cards for one SKU disagree, and a single mistyped card must
    // not become the window every custom gateway inherits: taking the card
    // with the largest context gave MiniMax-M2.7 a 6,553-token output (one
    // gateway lists 262100/6553) and several models an output equal to
    // their context. The median ignores those outliers while still being a
    // value some card actually declared.
    const context = median(contexts)
    const output = median(outputs)
    if (!context || !output) return
    return { context, output }
  }

  function median(values: number[]): number | undefined {
    if (values.length === 0) return
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.floor(sorted.length / 2)]
  }

  function shouldReplaceLimit(stored: number, discoveryDefault: number, replaceDiscoveryDefaults: boolean) {
    if (stored === 0) return true
    return replaceDiscoveryDefaults && stored === discoveryDefault
  }

  export function inheritCustomApiModelLimit(input: {
    modelID: string
    limit?: { context?: number; output?: number }
    catalog?: Record<
      string,
      { models?: Record<string, { id?: string; limit?: { context?: number; output?: number } }> }
    >
    replaceDiscoveryDefaults?: boolean
  }): { context: number; output: number } {
    const storedContext = input.limit?.context ?? 0
    const storedOutput = input.limit?.output ?? 0
    const catalog = input.catalog ? catalogLimitForModelID(input.modelID, input.catalog) : undefined
    const caps = findRegisteredModelCapabilities(input.modelID)
    // Registry first: reseller catalog cards for the same SKU disagree
    // (1_000_000 vs 1_048_576) and should not inflate a known window.
    const inheritedContext = caps?.contextWindow ?? catalog?.context
    const inheritedOutput = catalog?.output
    const replace = input.replaceDiscoveryDefaults === true
    const context =
      shouldReplaceLimit(storedContext, DEFAULT_CONTEXT_WINDOW, replace) && inheritedContext
        ? inheritedContext
        : storedContext || DEFAULT_CONTEXT_WINDOW
    let output =
      shouldReplaceLimit(storedOutput, DEFAULT_OUTPUT_LIMIT, replace) && inheritedOutput
        ? inheritedOutput
        : storedOutput || DEFAULT_OUTPUT_LIMIT
    if (output > context) output = context
    return { context, output }
  }

  export function discoveredModel(id: string, name?: string, raw?: Record<string, unknown>): Model {
    const payload = payloadLimits(raw)
    const inherited = inheritCustomApiModelLimit({
      modelID: id,
      limit: {
        context: payload.context,
        output: payload.output,
      },
    })
    const caps = findRegisteredModelCapabilities(id)
    const capabilities = isRecord(raw?.capabilities) ? raw.capabilities : undefined
    return {
      id,
      name: name || id,
      contextWindow: inherited.context,
      outputLimit: inherited.output,
      toolCall: typeof capabilities?.toolcall === "boolean" ? capabilities.toolcall : true,
      reasoning:
        typeof capabilities?.reasoning === "boolean"
          ? capabilities.reasoning
          : caps
            ? caps.thinking !== "blocked"
            : false,
      attachment: typeof capabilities?.attachment === "boolean" ? capabilities.attachment : false,
      temperature: typeof capabilities?.temperature === "boolean" ? capabilities.temperature : true,
    }
  }

  export function parseDiscoveredModels(payload: unknown): Model[] {
    if (!isRecord(payload) || !Array.isArray(payload.data)) return []
    const models: Model[] = []
    const seen = new Set<string>()
    for (const raw of payload.data) {
      if (!isRecord(raw) || typeof raw.id !== "string") continue
      const id = raw.id.trim()
      if (!id || seen.has(id) || /\s/u.test(id) || id.length > 256) continue
      // Gateways list embedding / rerank / speech models on the same
      // endpoint; they cannot drive a coding turn.
      if (isNonChatModelID(id)) continue
      seen.add(id)
      const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : id
      models.push(discoveredModel(id, name, raw))
      if (models.length >= 128) break
    }
    return models
  }

  function modelsURL(baseURL: string) {
    return `${baseURL.replace(/\/+$/, "")}/models`
  }

  function authorizationHeaders(apiKey: string) {
    const token = apiKey.trim()
    return {
      Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
    }
  }

  export async function discoverModels(input: {
    baseURL: string
    apiKey: string
    timeoutMs?: number
    fetcher?: typeof fetch
  }): Promise<Model[]> {
    const token = input.apiKey.trim()
    if (!token) throw new Error({ message: "API token is required to discover models" })
    const url = modelsURL(input.baseURL)
    const hostname = new URL(input.baseURL).hostname
    const fetcher = input.fetcher ?? (isLocalHostname(hostname) ? fetch : Ssrf.pinnedFetch)
    let response: Response
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: authorizationHeaders(token),
        signal: AbortSignal.timeout(input.timeoutMs ?? DISCOVERY_TIMEOUT_MS),
      })
    } catch (cause) {
      // Surface connection refused / DNS / timeout as a provider error so the
      // route answers 400 with the reason instead of a generic 500.
      const reason = cause instanceof globalThis.Error ? cause.message : String(cause)
      throw new Error({ message: `GET ${url} failed: ${reason}` })
    }
    if (!response.ok) {
      await response.arrayBuffer().catch(() => undefined)
      throw new Error({ message: `GET ${url} returned HTTP ${response.status}` })
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error({ message: `GET ${url} returned invalid JSON` })
    }
    const models = parseDiscoveredModels(payload)
    if (models.length === 0) throw new Error({ message: `GET ${url} returned no models` })
    return models
  }

  function npmForProtocol(protocol: Protocol) {
    return protocol === "anthropic-compatible" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible"
  }

  function protocolForProvider(provider: Config.Provider): Protocol | undefined {
    if (provider.npm === "@ai-sdk/openai-compatible") return "openai-compatible"
    if (provider.npm === "@ai-sdk/anthropic") return "anthropic-compatible"
    return undefined
  }

  function providerConfig(input: Upsert & { models: Model[] }): Config.Provider {
    return {
      management: "custom-api",
      name: input.name,
      env: [],
      npm: npmForProtocol(input.protocol),
      api: input.baseURL,
      options: { baseURL: input.baseURL },
      models: Object.fromEntries(
        input.models.map((model) => [
          model.id,
          {
            id: model.id,
            name: model.name ?? model.id,
            release_date: "",
            attachment: model.attachment,
            reasoning: model.reasoning,
            temperature: model.temperature,
            tool_call: model.toolCall,
            limit: { context: model.contextWindow, output: model.outputLimit },
            modalities: {
              input: model.attachment ? (["text", "image"] as const) : (["text"] as const),
              output: ["text"] as const,
            },
          },
        ]),
      ),
    }
  }

  function viewFromProvider(providerID: string, provider: Config.Provider, hasApiKey: boolean): View {
    const protocol = protocolForProvider(provider)
    const baseURL = typeof provider.options?.baseURL === "string" ? provider.options.baseURL : provider.api
    if (!protocol || typeof baseURL !== "string")
      throw new Error({ message: `Managed custom provider ${providerID} has an invalid protocol or base URL` })
    const models = Object.entries(provider.models ?? {}).map(([modelID, model]) => ({
      id: model.id ?? modelID,
      name: model.name,
      contextWindow: model.limit?.context ?? 0,
      outputLimit: model.limit?.output ?? 0,
      toolCall: model.tool_call ?? true,
      reasoning: model.reasoning ?? false,
      attachment: model.attachment ?? false,
      temperature: model.temperature ?? false,
    }))
    const parsed = View.safeParse({
      providerID,
      name: provider.name ?? providerID,
      protocol,
      baseURL,
      hasApiKey,
      models,
    })
    if (!parsed.success)
      throw new Error({ message: `Managed custom provider ${providerID} has invalid saved metadata` })
    return parsed.data
  }

  async function restoreAuth(providerID: string, previous: Auth.Info | undefined) {
    if (previous) await Auth.set(providerID, previous)
    else await Auth.remove(providerID)
  }

  async function assertAvailableProviderID(providerID: string, existingGlobal?: Config.Provider) {
    if (isRetiredProviderID(providerID))
      throw new Error({ message: `Provider ID '${providerID}' is retired and cannot be reused` })
    if (existingGlobal?.management === "custom-api") return
    if (existingGlobal)
      throw new Error({ message: `Provider ID '${providerID}' is already managed by global configuration` })
    const [catalog, effective] = await Promise.all([ModelsDev.get(), Config.get()])
    if (Object.prototype.hasOwnProperty.call(catalog, providerID))
      throw new Error({ message: `Provider ID '${providerID}' conflicts with a built-in provider` })
    if (Object.prototype.hasOwnProperty.call(effective.provider ?? {}, providerID))
      throw new Error({
        message: `Provider ID '${providerID}' conflicts with existing project or override configuration`,
      })
  }

  export async function list(): Promise<View[]> {
    const [globalConfig, auth] = await Promise.all([Config.getGlobal(), Auth.all()])
    return Object.entries(globalConfig.provider ?? {})
      .filter(([, provider]) => provider.management === "custom-api")
      .map(([providerID, provider]) => viewFromProvider(providerID, provider, auth[providerID]?.type === "api"))
      .sort((left, right) => left.name.localeCompare(right.name) || left.providerID.localeCompare(right.providerID))
  }

  export async function upsert(rawProviderID: string, rawInput: Upsert): Promise<View> {
    const providerID = ProviderID.parse(rawProviderID)
    const input = Upsert.parse(rawInput)
    const globalConfig = await Config.getGlobal()
    const previousProvider = globalConfig.provider?.[providerID]
    await assertAvailableProviderID(providerID, previousProvider)
    const previousAuth = await Auth.get(providerID)
    const models = await resolveModels(input, previousProvider, previousAuth)
    const credentialChanged = input.apiKey !== undefined
    if (credentialChanged) await Auth.set(providerID, { type: "api", key: input.apiKey! })
    const nextProvider = providerConfig({ ...input, models })
    try {
      await Config.setGlobalProvider(providerID, nextProvider)
    } catch (cause) {
      if (credentialChanged) await restoreAuth(providerID, previousAuth).catch(() => undefined)
      throw cause
    }
    return viewFromProvider(providerID, nextProvider, credentialChanged || previousAuth?.type === "api")
  }

  async function resolveModels(
    input: Upsert,
    previousProvider: Config.Provider | undefined,
    previousAuth: Auth.Info | undefined,
  ): Promise<Model[]> {
    if (input.models && input.models.length > 0) return input.models
    if (!input.refreshModels && previousProvider?.management === "custom-api") {
      const previous = viewFromProvider("previous", previousProvider, false)
      const previousURL = previous.baseURL
      if (previousURL === input.baseURL && previous.models.length > 0) return previous.models
    }
    const apiKey = input.apiKey ?? (previousAuth?.type === "api" ? previousAuth.key : undefined)
    if (!apiKey) throw new Error({ message: "API token is required to discover models from the endpoint" })
    return discoverModels({ baseURL: input.baseURL, apiKey })
  }

  export async function remove(rawProviderID: string): Promise<boolean> {
    const providerID = ProviderID.parse(rawProviderID)
    const globalConfig = await Config.getGlobal()
    const previousProvider = globalConfig.provider?.[providerID]
    if (!previousProvider) return false
    if (previousProvider.management !== "custom-api")
      throw new Error({ message: `Provider ID '${providerID}' is not managed by the custom API provider editor` })
    const previousAuth = await Auth.get(providerID)
    const removed = await Config.removeGlobalProvider(providerID)
    if (!removed) return false
    try {
      await Auth.remove(providerID)
    } catch (cause) {
      await Config.setGlobalProvider(providerID, previousProvider).catch(() => undefined)
      await restoreAuth(providerID, previousAuth).catch(() => undefined)
      throw cause
    }
    return true
  }
}
