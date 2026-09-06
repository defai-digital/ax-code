import z from "zod"
import type { ModelsDev } from "../models"
import { isModelSupportedForProvider } from "../model-support"
import { modelIdFinalSegment } from "../model-id"
import { AX_ENGINE_MODEL_DEFINITIONS, type AxEngineHubModelID, type AxEngineModelDefinition } from "./constants"

const RepoID = z
  .string()
  .max(256)
  .regex(/^AutomatosX\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/)
const Commit = z.string().regex(/^[a-f0-9]{40}$/)
const Count = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const TextConfig = z.object({
  max_position_embeddings: Count.optional(),
  num_hidden_layers: Count.optional(),
  num_key_value_heads: Count.optional(),
  num_attention_heads: Count.optional(),
  head_dim: Count.optional(),
  hidden_size: Count.optional(),
})

// Retain only bounded plain metadata. Templates and remote code are never loaded.
export const HubModel = z.object({
  id: RepoID,
  sha: Commit,
  pipeline_tag: z.string().max(100).optional(),
  library_name: z.string().max(100).optional(),
  tags: z.array(z.string().max(512)).max(500).default([]),
  cardData: z
    .object({
      base_model: z.union([z.string().max(256), z.array(z.string().max(256)).max(16)]).optional(),
      base_model_relation: z.string().max(100).optional(),
      library_name: z.string().max(100).optional(),
    })
    .optional(),
  siblings: z
    .array(
      z.object({
        rfilename: z
          .string()
          .min(1)
          .max(512)
          .refine(
            (value) =>
              !value.includes("\\") &&
              !value.includes("\0") &&
              value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
          ),
        size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
      }),
    )
    .max(10_000)
    .default([]),
  config: z.object({ model_type: z.string().max(100).optional() }).optional(),
  // Loaded from config.json at sha; Hub's API config omits context/KV dimensions.
  textConfig: TextConfig.optional(),
  provenanceBase: z.string().max(256).optional(),
})
export type HubModel = z.infer<typeof HubModel>

export const HubCatalog = z.object({
  version: z.literal(1),
  fetchedAt: z.number().int().nonnegative(),
  models: z.array(HubModel).max(2_000),
})
export type HubCatalog = z.infer<typeof HubCatalog>

export type HubModelDecision = {
  id: AxEngineHubModelID
  repoID: string
  revision: string
  baseModel?: string
  policy: "eligible" | "excluded" | "unknown"
  reason: string
}

export function hubModelID(model: Pick<HubModel, "id" | "sha">): AxEngineHubModelID {
  return `${model.id}@${model.sha}` as AxEngineHubModelID
}

export function hubTextConfig(input: unknown) {
  const config = TextConfig.extend({ text_config: TextConfig.optional() }).parse(input)
  return config.text_config ?? TextConfig.parse(config)
}

const NON_CHAT = /(?:^|[-_/.])(?:asr|embedding|embed|rerank|reranker|genrm|reward|tts|ocr)(?:$|[-_/.])/i

export function evaluateHubModel(model: HubModel, catalog: Record<string, ModelsDev.Provider>): HubModelDecision {
  const result = (policy: HubModelDecision["policy"], reason: string, baseModel?: string): HubModelDecision => ({
    id: hubModelID(model),
    repoID: model.id,
    revision: model.sha,
    baseModel,
    policy,
    reason,
  })
  if (!["text-generation", "image-text-to-text"].includes(model.pipeline_tag ?? "") || NON_CHAT.test(model.id)) {
    return result("excluded", "This package is not a conversational coding model")
  }
  const library = model.library_name ?? model.cardData?.library_name
  if (library ? library !== "mlx" : !model.tags.includes("mlx")) {
    return result("excluded", "This package is not an MLX artifact")
  }
  const bases = model.cardData?.base_model
  const base = typeof bases === "string" ? bases : bases?.length === 1 ? bases[0] : undefined
  if (!base) return result("unknown", "An unambiguous source model is required")
  if (NON_CHAT.test(base)) return result("excluded", "The source model is not a conversational coding model", base)
  if (model.provenanceBase && model.provenanceBase.toLowerCase() !== base.toLowerCase()) {
    return result("unknown", "Package provenance conflicts with its declared source model", base)
  }
  const relation = model.cardData?.base_model_relation
  if (relation !== "quantized" && (relation !== undefined || !model.tags.includes(`base_model:quantized:${base}`))) {
    return result("unknown", "Only an identified quantized source inherits product eligibility", base)
  }
  if (!isModelSupportedForProvider("ax-engine", base))
    return result("excluded", "The source is excluded by model policy", base)

  const source = base.toLowerCase()
  const basename = modelIdFinalSegment(source)
  const recognized = Object.entries(catalog).some(([providerID, provider]) =>
    Object.entries(provider.models).some(([id, candidate]) => {
      const key = id.toLowerCase()
      // Qualified source IDs and exact bare SKU aliases only. Never reduce a
      // fine-tune to its architecture, or strip context/instruction suffixes.
      if (key !== source && !key.endsWith(`/${source}`) && !(key === basename && !key.includes("/"))) return false
      return (
        isModelSupportedForProvider(providerID, id, candidate) &&
        candidate.tool_call === true &&
        candidate.modalities?.output.includes("text") === true &&
        candidate.status !== "deprecated"
      )
    }),
  )
  const curated = Object.values(AX_ENGINE_MODEL_DEFINITIONS).some(
    (entry) =>
      entry.sourceModel?.toLowerCase() === source && catalog["ax-engine"]?.models[entry.id]?.tool_call === true,
  )
  if (!recognized && !curated)
    return result("unknown", "The source is not recognized as a supported AX Code coding model", base)
  if (!model.siblings.some((file) => file.rfilename.endsWith(".safetensors"))) {
    return result("excluded", "This package has no MLX weight artifacts", base)
  }
  if (model.textConfig?.max_position_embeddings && model.textConfig.max_position_embeddings < 16_384) {
    return result("excluded", "The package context is too small for the coding-agent prompt and tools", base)
  }
  return result("eligible", "Source accepted; native text and tool support require runtime verification", base)
}

export function hubModelDefinition(model: HubModel, decision: HubModelDecision): AxEngineModelDefinition | undefined {
  if (decision.policy !== "eligible") return undefined
  const totalBytes = model.siblings.reduce((sum, file) => sum + (file.size ?? 0), 0)
  const weights = model.siblings.filter((file) => file.rfilename.endsWith(".safetensors"))
  if (!weights.length || weights.some((file) => !file.size) || !Number.isSafeInteger(totalBytes)) return undefined
  // Reserve enough input for the build-agent prompt and tool schemas (~10K).
  // Cap at 32K independently of cloud endpoint limits. The
  // engine's live card supplies actual capabilities after preparation/loading.
  const contextTokens = Math.min(32_768, model.textConfig?.max_position_embeddings ?? 32_768)
  const outputTokens = Math.min(8_192, Math.floor(contextTokens / 4))
  if (outputTokens < 1) return undefined
  const cfg = model.textConfig
  const headDim =
    cfg?.head_dim ??
    (cfg?.hidden_size && cfg.num_attention_heads ? cfg.hidden_size / cfg.num_attention_heads : undefined)
  const kvBytes =
    cfg?.num_hidden_layers && cfg.num_key_value_heads && headDim
      ? cfg.num_hidden_layers * cfg.num_key_value_heads * headDim * contextTokens * 4
      : 4 * 1024 ** 3
  // Resource estimates include all sidecars, fp16 K/V, buffers and host reserve.
  // They are admission estimates, not certified hardware requirements.
  const minMemoryBytes = Math.ceil(totalBytes * 1.25 + kvBytes + 4 * 1024 ** 3)
  if (!Number.isSafeInteger(minMemoryBytes)) return undefined
  return {
    id: decision.id,
    apiModelID: decision.id,
    name: model.id.slice("AutomatosX/".length),
    defaultQuantization: "mlx",
    releaseDate: "",
    reasoning: false,
    toolcall: false,
    minMemoryBytes,
    contextTokens,
    outputTokens,
    revision: model.sha,
    sourceModel: decision.baseModel,
    estimatedResources: true,
    artifactFiles: model.siblings
      .filter(
        (file) =>
          file.rfilename.endsWith(".safetensors") ||
          ["config.json", "tokenizer.json", "tokenizer_config.json"].includes(file.rfilename),
      )
      .map((file) => file.rfilename),
    quantizations: {
      mlx: {
        hfRepo: model.id,
        downloadMode: "direct",
        packageMarker: undefined,
        directFallback: false,
        mtpSource: "Publisher artifact; optional features require runtime verification",
        minDiskBytes: Math.ceil(totalBytes * 1.25 + 2 * 1024 ** 3),
      },
    },
  }
}
