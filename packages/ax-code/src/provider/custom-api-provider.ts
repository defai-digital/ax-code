import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { ModelsDev } from "@/provider/models"
import { isRetiredProviderID } from "@/provider/retired-providers"

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
        .min(1, "At least one model is required")
        .max(128, "A custom provider can declare at most 128 models")
        .superRefine((models, context) => {
          const seen = new Set<string>()
          for (const [index, model] of models.entries()) {
            if (seen.has(model.id))
              context.addIssue({ code: "custom", message: `Duplicate model ID: ${model.id}`, path: [index, "id"] })
            seen.add(model.id)
          }
        }),
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

  function npmForProtocol(protocol: Protocol) {
    return protocol === "anthropic-compatible" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible"
  }

  function protocolForProvider(provider: Config.Provider): Protocol | undefined {
    if (provider.npm === "@ai-sdk/openai-compatible") return "openai-compatible"
    if (provider.npm === "@ai-sdk/anthropic") return "anthropic-compatible"
    return undefined
  }

  function providerConfig(input: Upsert): Config.Provider {
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
    const credentialChanged = input.apiKey !== undefined
    if (credentialChanged) await Auth.set(providerID, { type: "api", key: input.apiKey! })
    const nextProvider = providerConfig(input)
    try {
      await Config.setGlobalProvider(providerID, nextProvider)
    } catch (cause) {
      if (credentialChanged) await restoreAuth(providerID, previousAuth).catch(() => undefined)
      throw cause
    }
    return viewFromProvider(providerID, nextProvider, credentialChanged || previousAuth?.type === "api")
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
