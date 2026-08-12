import { isLocalHostname } from "@/util/local-host"
import { Ssrf } from "@/util/ssrf"
import { isRecord } from "@/util/record"
import type { Provider } from "../provider"
import { ModelID, ProviderID } from "../schema"
import {
  PRIVATE_GPU_DISCOVERY_TIMEOUT_MS,
  type PrivateGpuVendor,
} from "./presets"
import { normalizeVendorBaseURL, privateGpuModelsURL } from "./endpoint"

export type PrivateGpuDiscoveredModel = {
  id: string
  name: string
  context: number
  output: number
}

type ModelListItem = {
  id?: unknown
  max_model_len?: unknown
  context_length?: unknown
  max_context_length?: unknown
  max_output_tokens?: unknown
  limit?: unknown
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function authorizationHeaders(apiKey: string) {
  const token = apiKey.trim()
  return {
    Authorization: token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`,
  }
}

function contextLimit(item: ModelListItem) {
  const limit = isRecord(item.limit) ? item.limit : {}
  return numberValue(
    limit.context,
    numberValue(item.context_length, numberValue(item.max_context_length, numberValue(item.max_model_len, 128000))),
  )
}

function advertisedOutput(item: ModelListItem) {
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
  for (const raw of input.data) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id.trim()) continue
    const id = raw.id.trim()
    const context = contextLimit(raw)
    const output = reservedOutputTokens(context, advertisedOutput(raw))
    models.push({
      id,
      name: id,
      context,
      output,
    })
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
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: true,
        input: { text: true, audio: false, image: false, video: false, pdf: false },
        output: { text: true, audio: false, image: false, video: false, pdf: false },
        interleaved: { field: "reasoning_content" },
      },
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

function fetcherFor(baseURL: string, vendor: PrivateGpuVendor) {
  const hostname = new URL(normalizeVendorBaseURL(baseURL, vendor)).hostname
  return isLocalHostname(hostname) ? fetch : Ssrf.pinnedFetch
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
  const modelsURL = privateGpuModelsURL(input.baseURL, input.vendor)
  const fetcher = input.fetcher ?? fetcherFor(input.baseURL, input.vendor)
  const response = await fetcher(modelsURL, {
    method: "GET",
    headers: authorizationHeaders(token),
    signal: AbortSignal.timeout(input.timeoutMs ?? PRIVATE_GPU_DISCOVERY_TIMEOUT_MS),
  })
  if (!response.ok) {
    await response.arrayBuffer().catch(() => undefined)
    throw new Error(`${input.vendor.name} /models returned HTTP ${response.status}`)
  }
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new Error(`${input.vendor.name} /models returned invalid JSON`)
  }
  const models = parseModelList(parsed)
  if (models.length === 0) throw new Error(`${input.vendor.name} /models returned no models`)
  return {
    baseURL: normalizeVendorBaseURL(input.baseURL, input.vendor),
    models,
  }
}
