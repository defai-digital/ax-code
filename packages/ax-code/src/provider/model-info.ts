import { mapValues } from "remeda"
import z from "zod"
import { ModelID, ProviderID } from "./schema"
import { ModelsDev } from "./models"
import { ProviderTransform } from "./transform"
import { Log } from "../util/log"
import { toErrorMessage } from "@/util/error-message"

const log = Log.create({ service: "provider" })

export const ProviderModel = z
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
export type ProviderModel = z.infer<typeof ProviderModel>

export const ProviderInfo = z
  .object({
    id: ProviderID.zod,
    name: z.string(),
    source: z.enum(["env", "config", "custom", "api"]),
    env: z.string().array(),
    key: z.string().optional(),
    options: z.record(z.string(), z.any()),
    models: z.record(z.string(), ProviderModel),
  })
  .meta({
    ref: "Provider",
  })
export type ProviderInfo = z.infer<typeof ProviderInfo>

// Convert a models.dev snapshot entry into our internal ProviderModel shape.
//
// Hardening contract (matches v4.6.2 permissiveness, with extra safety):
//
// 1. Missing api URL is allowed. Many providers (xai, google,
//    claude-code, gemini-cli, codex-cli, etc.) intentionally
//    omit api.url in the bundled snapshot because their URL is supplied
//    by the bundled npm SDK package itself. Throwing here would kill
//    Provider.warmup and leave /connect empty.
//
// 2. Every other optional field (name, family, limit, capabilities,
//    release_date, modalities, status, headers, options) gets a safe
//    default rather than reading undefined fields and crashing.
//
// 3. The whole body is wrapped in try/catch as a final safety net for
//    any unforeseen runtime error. Returning undefined lets the caller
//    skip the entry with a warning instead of crashing the warmup.
function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): ProviderModel | undefined {
  try {
    const apiUrl = model.provider?.api ?? provider.api ?? ""
    const limit = model.limit ?? { context: 0, output: 0 }
    const m: ProviderModel = {
      id: ModelID.make(model.id),
      providerID: ProviderID.make(provider.id),
      name: model.name ?? model.id,
      family: model.family,
      api: {
        id: model.id,
        url: apiUrl,
        npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
      },
      status: model.status ?? "active",
      headers: model.headers ?? {},
      options: model.options ?? {},
      limit: {
        context: limit.context ?? 0,
        input: limit.input,
        output: limit.output ?? 0,
      },
      capabilities: {
        temperature: model.temperature ?? false,
        reasoning: model.reasoning ?? false,
        attachment: model.attachment ?? false,
        toolcall: model.tool_call ?? false,
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
      release_date: model.release_date ?? "",
      variants: {},
    }
    m.variants = mapValues(ProviderTransform.variants(m), (v) => v)
    return m
  } catch (error) {
    log.warn("skipping malformed model", {
      providerID: provider?.id,
      modelID: model?.id,
      reason: toErrorMessage(error),
    })
    return undefined
  }
}

// Convert a models.dev snapshot provider entry.
//
// Hardening contract:
// - Skip individual malformed models (handled inside fromModelsDevModel).
//   One bad model never blocks the rest.
// - Wrap the whole conversion in try/catch. One bad provider never blocks the
//   rest of the registry. Returns undefined on failure.
// - Be permissive on missing fields: defaults rather than throws keep the
//   /provider list endpoint populated even when the snapshot drifts ahead of
//   what we expect.
export function fromModelsDevProvider(provider: ModelsDev.Provider): ProviderInfo | undefined {
  try {
    if (!provider?.id) {
      throw new Error("missing provider id")
    }
    const models: Record<string, ProviderModel> = {}
    const rawModels = provider.models ?? {}
    for (const [id, model] of Object.entries(rawModels)) {
      const result = fromModelsDevModel(provider, model)
      if (result) models[id] = result
    }
    return {
      id: ProviderID.make(provider.id),
      source: "custom",
      name: provider.name ?? provider.id,
      env: provider.env ?? [],
      options: provider.options ?? {},
      models,
    }
  } catch (error) {
    log.warn("skipping malformed provider", {
      providerID: provider?.id,
      reason: toErrorMessage(error),
    })
    return undefined
  }
}
