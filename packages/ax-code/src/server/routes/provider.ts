import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { validator } from "../validation"
import z from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { ModelsDev } from "../../provider/models"
import { ProviderAuth } from "../../provider/auth"
import { mapValues } from "remeda"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { PROVIDER_ID_PARAM, withProviderID } from "./route-params"
import { redactProviderInfo } from "./config"
import { Log } from "../../util/log"
import { AX_ENGINE_MODEL_IDS, getAxEngineStatus, prepareAxEngine, stopServer } from "@/provider/ax-engine"
import { isSupportedHost } from "@/provider/ax-engine/platform"
import { normalizeModelID, normalizeQuantization } from "@/provider/ax-engine/model-cache"
import { JsonBoolean, JsonNumber } from "@/util/schema"

const log = Log.create({ service: "server" })

// Natively supported providers — shown by default when enabled_providers is not configured.
// Users can expand this list via enabled_providers in ax-code.json.
// Note: ollama and ax-studio are intentionally excluded — they are opt-in only
// because local inference models have inconsistent tool-calling and structured
// output support. Users must add them to enabled_providers in ax-code.json.
const NATIVE_PROVIDERS = new Set([
  "ax-engine",
  "google",
  "alibaba-coding-plan",
  "alibaba-coding-plan-cn",
  "alibaba-token-plan",
  "alibaba-token-plan-cn",
  "github-copilot",
  "xai",
  "zai-coding-plan",
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
])

export function shouldShowProviderInList(input: {
  key: string
  disabled: Set<string>
  enabled?: Set<string>
  axEngineSupported?: boolean
}) {
  if (input.disabled.has(input.key)) return false
  if (input.key === "ax-engine" && !input.axEngineSupported) return false
  return input.enabled ? input.enabled.has(input.key) : NATIVE_PROVIDERS.has(input.key)
}

export const AxEnginePrepareBody = z
  .object({
    modelPath: z.string().optional(),
    binaryPath: z.string().optional(),
    modelID: z.enum(AX_ENGINE_MODEL_IDS).optional(),
    quantization: z.enum(["mlx4bit", "mlx6bit"]).optional(),
    download: JsonBoolean.optional(),
    start: JsonBoolean.optional(),
  })
  .optional()
  .default({})

export const AxEngineStartBody = z
  .object({
    modelPath: z.string().optional(),
    binaryPath: z.string().optional(),
    modelID: z.enum(AX_ENGINE_MODEL_IDS).optional(),
    quantization: z.enum(["mlx4bit", "mlx6bit"]).optional(),
    download: JsonBoolean.optional(),
  })
  .optional()
  .default({})

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    all: ModelsDev.Provider.array(),
                    default: z.record(z.string(), z.string()),
                    connected: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get()
        const disabled = new Set(config.disabled_providers ?? [])
        const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined

        const allProviders = await ModelsDev.get()
        const filteredProviders: Record<string, (typeof allProviders)[string]> = {}
        const axEngineSupported = await isSupportedHost().catch(() => false)
        for (const [key, value] of Object.entries(allProviders)) {
          if (shouldShowProviderInList({ key, disabled, enabled, axEngineSupported })) {
            filteredProviders[key] = value
          }
        }

        const connectedRaw = await Provider.list()
        const connected = mapValues(connectedRaw, redactProviderInfo)
        // fromModelsDevProvider may return undefined for malformed
        // entries. Drop those so the dialog never sees holes.
        const converted: Record<string, Provider.Info> = {}
        for (const [id, raw] of Object.entries(filteredProviders)) {
          const result = Provider.fromModelsDevProvider(raw)
          if (result) converted[id] = result
        }
        const providers = Object.assign(converted, connected)
        return c.json({
          all: Object.values(providers),
          default: mapValues(providers, (item) => Provider.sort(Object.values(item.models))[0]?.id ?? ""),
          connected: Object.keys(connected),
        })
      },
    )
    .get(
      "/ax-engine/status",
      describeRoute({
        summary: "Get ax-engine local provider status",
        description: "Inspect host eligibility, dependency, model cache, server, and capability state for ax-engine.",
        operationId: "provider.axEngine.status",
        responses: {
          200: {
            description: "ax-engine status",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        const config = await Config.get().catch(() => undefined)
        return c.json(await getAxEngineStatus(config?.provider?.["ax-engine"]?.options ?? {}))
      },
    )
    .post(
      "/ax-engine/prepare",
      describeRoute({
        summary: "Prepare ax-engine local provider",
        description: "Mark an existing MLX model path as prepared or explicitly download one through ax-engine.",
        operationId: "provider.axEngine.prepare",
        responses: {
          200: {
            description: "Preparation result",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AxEnginePrepareBody),
      async (c) => {
        const body = c.req.valid("json")
        const modelID = normalizeModelID(body.modelID)
        const quantization = normalizeQuantization(body.quantization, modelID)
        const result = await prepareAxEngine({
          modelID,
          binaryPath: body.binaryPath,
          modelPath: body.modelPath,
          quantization,
          download: body.download,
          start: body.start,
          signal: c.req.raw.signal,
        })
        await Provider.invalidate().catch((error) =>
          log.warn("failed to invalidate provider after ax-engine prepare", { error }),
        )
        return c.json(result)
      },
    )
    .post(
      "/ax-engine/start",
      describeRoute({
        summary: "Start managed ax-engine server",
        description: "Start ax-engine for an already prepared or explicitly provided MLX model.",
        operationId: "provider.axEngine.start",
        responses: {
          200: {
            description: "Start result",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AxEngineStartBody),
      async (c) => {
        const body = c.req.valid("json")
        const modelID = normalizeModelID(body.modelID)
        const quantization = normalizeQuantization(body.quantization, modelID)
        const result = await prepareAxEngine({
          modelID,
          binaryPath: body.binaryPath,
          modelPath: body.modelPath,
          quantization,
          download: body.download,
          start: true,
          signal: c.req.raw.signal,
        })
        await Provider.invalidate().catch((error) =>
          log.warn("failed to invalidate provider after ax-engine start", { error }),
        )
        return c.json(result)
      },
    )
    .post(
      "/ax-engine/stop",
      describeRoute({
        summary: "Stop managed ax-engine server",
        operationId: "provider.axEngine.stop",
        responses: {
          200: {
            description: "Stopped",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await stopServer()
        await Provider.invalidate().catch((error) =>
          log.warn("failed to invalidate provider after ax-engine stop", { error }),
        )
        return c.json(true)
      },
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), z.array(ProviderAuth.Method))),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ProviderAuth.methods())
      },
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", PROVIDER_ID_PARAM),
      validator(
        "json",
        z.object({
          method: JsonNumber(z.number().int().min(0)).meta({ description: "Auth method index" }),
          inputs: z.record(z.string(), z.string()).optional().meta({ description: "Prompt inputs" }),
        }),
      ),
      withProviderID(async (providerID, c) => {
        const { method, inputs } = c.req.valid("json")
        const result = await ProviderAuth.authorize({
          providerID,
          method,
          inputs,
        })
        return c.json(result)
      }),
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", PROVIDER_ID_PARAM),
      validator(
        "json",
        z.object({
          method: JsonNumber(z.number().int().min(0)).meta({ description: "Auth method index" }),
          code: z.string().optional().meta({ description: "OAuth authorization code" }),
        }),
      ),
      withProviderID(async (providerID, c) => {
        const { method, code } = c.req.valid("json")
        await ProviderAuth.callback({
          providerID,
          method,
          code,
        })
        return c.json(true)
      }),
    ),
)
