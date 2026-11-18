import { isRecord } from "@/util/record"
import { isNonChatModelID } from "@/provider/model-selectability"
import type { Provider } from "../provider"
import { ModelID, ProviderID } from "../schema"
import { PRIVATE_GPU_DISCOVERY_TIMEOUT_MS, type PrivateGpuVendor } from "./presets"
import { normalizeVendorBaseURL } from "./endpoint"
import { declaredCapabilityEvidence, firstDeclaredBoolean, withCapabilityEvidence } from "../capability-evidence"
import { modelListBearerHeaders, requestModelList } from "../model-list-http"

export type PrivateGpuDiscoveredModel = {
  id: string
  name: string
  context: number
  output: number
  toolCall: boolean
  reasoning: boolean
  attachment: boolean
  temperature: boolean
}

type ModelLimitFields = {
  max_model_len?: unknown
  context_length?: unknown
  max_context_length?: unknown
  max_output_tokens?: unknown
  limit?: unknown
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function contextLimit(item: ModelLimitFields) {
  const limit = isRecord(item.limit) ? item.limit : {}
  return numberValue(
    limit.context,
    numberValue(item.context_length, numberValue(item.max_context_length, numberValue(item.max_model_len, 128000))),
  )
}

function advertisedOutput(item: ModelLimitFields) {
  const limit = isRecord(item.limit) ? item.limit : {}
  const explicit = numberValue(limit.output, numberValue(item.max_output_tokens, 0))
  return explicit > 0 ? explicit : undefined
}

/** Prefer advertised output, else 32k or 25% of context. Never reserve more than half the window. */
export function reservedOutputTokens(context: number, advertised?: number) {
  const fallback = Math.min(32_000, Math.max(1_024, Math.floor(context / 4)))
  const preferred = advertised && advertised > 0 ? advertised : fallback
  const maxOutput = Math.max(1, Math.min(context - 1, Math.floor(context / 2)))
  return Math.min(preferred, maxOutput)
}

function parseModelList(input: unknown): PrivateGpuDiscoveredModel[] {
  if (!isRecord(input) || !Array.isArray(input.data)) return []
  const models: PrivateGpuDiscoveredModel[] = []
  const seen = new Set<string>()
  for (const raw of input.data) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim()) continue
    const id = raw.id.trim()
    if (seen.has(id) || isNonChatModelID(id)) continue
    seen.add(id)
    const context = contextLimit(raw)
    const output = reservedOutputTokens(context, advertisedOutput(raw))
    const capabilities = isRecord(raw.capabilities) ? raw.capabilities : {}
    const declared = {
      toolCalling: firstDeclaredBoolean(capabilities.toolcall, raw.tool_call),
      thinking: firstDeclaredBoolean(capabilities.reasoning, raw.reasoning),
      temperature: firstDeclaredBoolean(capabilities.temperature, raw.temperature),
      attachment: firstDeclaredBoolean(capabilities.attachment, raw.attachment),
    }
    // Sparse cards do not qualify tools or reasoning on dedicated endpoints.
    models.push(
      withCapabilityEvidence(
        {
          id,
          name: id,
          context,
          output,
          toolCall: declared.toolCalling ?? false,
          reasoning: declared.thinking ?? false,
          temperature: declared.temperature ?? false,
          attachment: declared.attachment ?? false,
        },
        declared,
        "deployment",
      ),
    )
  }
  return models
}

export function privateGpuModelRecords(
  models: PrivateGpuDiscoveredModel[],
  baseURL: string,
  vendor: PrivateGpuVendor,
): Record<string, Provider.Model> {
  const inferenceBaseURL = normalizeVendorBaseURL(baseURL, vendor)
  const result: Record<string, Provider.Model> = {}
  for (const item of models) {
    const id = ModelID.make(item.id)
    result[id] = {
      id,
      providerID: ProviderID.make(vendor.id),
      name: item.name,
      api: { id: item.id, url: inferenceBaseURL, npm: vendor.npm },
      capabilities: withCapabilityEvidence(
        {
          temperature: item.temperature,
          reasoning: item.reasoning,
          attachment: item.attachment,
          toolcall: item.toolCall,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: item.reasoning ? { field: "reasoning_content" } : false,
        },
        {},
        "deployment",
        declaredCapabilityEvidence(item),
      ),
      limit: {
        context: item.context,
        input: Math.max(1, item.context - item.output),
        output: item.output,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "",
      variants: {},
    }
  }
  return result
}

export async function discoverPrivateGpuModels(input: {
  vendor: PrivateGpuVendor
  baseURL: string
  apiKey: string
  timeoutMs?: number
  fetcher?: typeof fetch
}) {
  const token = input.apiKey.trim()
  if (!token) throw new Error(`${input.vendor.name} token is required`)
  const baseURL = normalizeVendorBaseURL(input.baseURL, input.vendor)
  const parsed = await requestModelList({
    url: `${baseURL}/models`,
    label: `${input.vendor.name} /models`,
    headers: modelListBearerHeaders(token),
    timeoutMs: input.timeoutMs ?? PRIVATE_GPU_DISCOVERY_TIMEOUT_MS,
    fetcher: input.fetcher,
  })
  const models = parseModelList(parsed)
  if (models.length === 0) throw new Error(`${input.vendor.name} /models returned no models`)
  return {
    baseURL,
    models,
  }
}
