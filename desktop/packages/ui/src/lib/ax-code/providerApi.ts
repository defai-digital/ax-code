import { API_ENDPOINTS, replacePathParams } from "@/lib/http"
import { isRecord } from "@/lib/record"
import { axCodeClient } from "./client"
import type { ProviderSources } from "@/components/sections/providers/types"

const PROVIDER_REQUEST_RETRY_DELAYS_MS = [250, 500, 750, 1000, 1500, 2000, 2500, 3000, 3000, 3000]
const PROVIDER_RESTART_POLL_MS = 2000
const CLI_PROVIDER_IDS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "kimi-cli",
])

// Providers whose CUSTOM_LOADERS entry (packages/ax-code/src/provider/loaders.ts) talks to a
// local runtime by default (ollama, ax-studio, ax-engine), rather than a metered cloud API.
const LOCAL_PROVIDER_IDS = new Set(["ollama", "ax-studio", "ax-engine"])

export type DedicatedPrivateGpuVendor = {
  id: string
  name: string
  urlPlaceholder: string
  tokenPlaceholder: string
  hint: string
  defaultApi?: string
}

export const DEDICATED_PRIVATE_GPU_VENDORS: DedicatedPrivateGpuVendor[] = [
  {
    id: "alibaba-pai",
    name: "Alibaba PAI-EAS",
    urlPlaceholder: "http://xxxx.pai-eas.aliyuncs.com/api/predict/your_service",
    tokenPlaceholder: "EAS token",
    hint: "EAS access address. AX Code adds /v1 if omitted and discovers models from GET /v1/models.",
  },
  {
    id: "runpod",
    name: "RunPod",
    urlPlaceholder: "https://api.runpod.ai/v2/your-endpoint-id",
    tokenPlaceholder: "RunPod API key",
    hint: "Serverless OpenAI URL or proxy host. /openai/v1 is added for api.runpod.ai/v2/{id}.",
  },
  {
    id: "huggingface-endpoints",
    name: "Hugging Face Endpoints",
    urlPlaceholder: "https://xxxx.endpoints.huggingface.cloud",
    tokenPlaceholder: "hf_...",
    hint: "Dedicated Inference Endpoint (TGI / vLLM). Not the hosted Hugging Face router.",
  },
  {
    id: "sagemaker",
    name: "Amazon SageMaker",
    urlPlaceholder: "https://your-sagemaker-openai-compatible.example/v1",
    tokenPlaceholder: "Bearer token",
    hint: "OpenAI-compatible SageMaker URL (vLLM / TGI / API Gateway). Not AWS SigV4.",
  },
  {
    id: "volcengine-ark",
    name: "Volcengine Ark",
    urlPlaceholder: "https://ark.cn-beijing.volces.com/api/v3",
    tokenPlaceholder: "Ark API key",
    hint: "Ark OpenAI-compatible root or a dedicated inference URL.",
    defaultApi: "https://ark.cn-beijing.volces.com/api/v3",
  },
  {
    id: "modelarts",
    name: "Huawei ModelArts",
    urlPlaceholder: "https://xxxx.modelarts.huaweicloud.com/v1",
    tokenPlaceholder: "ModelArts token",
    hint: "Dedicated ModelArts OpenAI-compatible infer endpoint.",
  },
  {
    id: "tencent-ti",
    name: "Tencent TI",
    urlPlaceholder: "https://api.lkeap.cloud.tencent.com/v1",
    tokenPlaceholder: "Tencent TI / LKEAP key",
    hint: "Tencent TI-ONE / LKEAP OpenAI-compatible URL, or a dedicated TI endpoint.",
    defaultApi: "https://api.lkeap.cloud.tencent.com/v1",
  },
]

const DEDICATED_PRIVATE_GPU_IDS = new Set(DEDICATED_PRIVATE_GPU_VENDORS.map((vendor) => vendor.id))

export { PROVIDER_REQUEST_RETRY_DELAYS_MS, PROVIDER_RESTART_POLL_MS }
export { isRecord }

export const isCliProvider = (providerId: string): boolean => CLI_PROVIDER_IDS.has(providerId)

export const isLocalProvider = (providerId: string): boolean => LOCAL_PROVIDER_IDS.has(providerId)

export const isDedicatedPrivateGpuProvider = (providerId: string): boolean => DEDICATED_PRIVATE_GPU_IDS.has(providerId)

export const dedicatedPrivateGpuVendor = (providerId: string) =>
  DEDICATED_PRIVATE_GPU_VENDORS.find((vendor) => vendor.id === providerId)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ProviderRetryOptions {
  retryDelaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
}

export const isRestartingError = (error: unknown): boolean => isRecord(error) && error.restarting === true

export const getCurrentDirectory = (): string | null => {
  const dir = axCodeClient.getDirectory()
  if (typeof dir === "string" && dir.trim().length > 0) {
    return dir.trim()
  }
  return null
}

// In the desktop app the renderer is served from its own local origin, which is
// NOT the AX Code server. A bare relative "/api/..." fetch would resolve against
// that renderer origin and never reach the server, surfacing as "Unable to load
// provider list" / "Failed to load provider authentication methods". Resolve the
// AX Code server origin first (mirrors gitApiHttp.ts resolveBaseOrigin), falling
// back to window.location.origin on web where they coincide.
const resolveBaseOrigin = (): string => {
  if (typeof window === "undefined") {
    return ""
  }
  const desktopOrigin = window.__AX_CODE_DESKTOP_DESKTOP_SERVER__?.origin
  if (desktopOrigin) {
    return desktopOrigin
  }
  return window.location.origin
}

export const buildDirectoryUrl = (path: string, directory: string | null): string => {
  const origin = resolveBaseOrigin()
  // On the server (no window) there is no origin to resolve against; keep the
  // relative path and append the query manually.
  if (!origin) {
    if (!directory) return path
    const separator = path.includes("?") ? "&" : "?"
    return `${path}${separator}directory=${encodeURIComponent(directory)}`
  }
  const url = new URL(path, origin)
  if (directory) {
    url.searchParams.set("directory", directory)
  }
  return url.toString()
}

export const fetchProviderJsonWithRetry = async (
  url: string,
  init: RequestInit,
  options: ProviderRetryOptions = {},
) => {
  const retryDelaysMs = options.retryDelaysMs ?? PROVIDER_REQUEST_RETRY_DELAYS_MS
  const sleepFor = options.sleep ?? sleep
  let lastError: unknown = null
  let lastRestarting = false
  const maxAttempts = retryDelaysMs.length + 1
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init)
      const payload = await response.json().catch(() => null)
      if (response.ok) {
        return payload
      }

      const restarting = response.status === 503 && isRecord(payload) && payload.restarting === true
      lastRestarting = restarting
      const retryDelayMs = retryDelaysMs[attempt]
      if (restarting && retryDelayMs !== undefined) {
        lastError = new Error("AX Code is restarting")
        await sleepFor(retryDelayMs)
        continue
      }

      const message =
        isRecord(payload) && typeof payload.message === "string"
          ? payload.message
          : isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : `Provider request failed (${response.status})`
      throw Object.assign(new Error(message), { noRetry: true, restarting })
    } catch (error) {
      lastError = error
      lastRestarting = isRecord(error) && error.restarting === true
      if (isRecord(error) && error.noRetry === true) {
        break
      }
      const retryDelayMs = retryDelaysMs[attempt]
      if (retryDelayMs === undefined) {
        break
      }
      await sleepFor(retryDelayMs)
      continue
    }
  }

  // Preserve 503+restarting context so callers that poll on restart keep going.
  throw lastError instanceof Error
    ? lastRestarting
      ? Object.assign(lastError, { restarting: true })
      : lastError
    : new Error("Provider request failed")
}

export interface AuthMethod {
  type?: string
  name?: string
  label?: string
  description?: string
  help?: string
  method?: number
  [key: string]: unknown
}

export interface ProviderOption {
  id: string
  name?: string
}

export const normalizeAuthType = (method: AuthMethod) => {
  const raw = typeof method.type === "string" ? method.type : ""
  const label = `${method.name ?? ""} ${method.label ?? ""}`.toLowerCase()
  const merged = `${raw} ${label}`.toLowerCase()
  if (merged.includes("oauth")) return "oauth"
  if (merged.includes("api")) return "api"
  return raw.toLowerCase()
}

export const parseAuthMethodsPayload = (payload: unknown): Record<string, AuthMethod[]> => {
  if (!isRecord(payload)) {
    return {}
  }
  const result: Record<string, AuthMethod[]> = {}
  for (const [providerId, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      result[providerId] = value.filter((entry) => isRecord(entry)) as AuthMethod[]
    }
  }
  return result
}

const normalizeProviderEntry = (entry: unknown): ProviderOption | null => {
  if (typeof entry === "string") {
    return { id: entry }
  }
  if (!isRecord(entry)) {
    return null
  }
  const idCandidate =
    (typeof entry.id === "string" && entry.id) ||
    (typeof entry.providerID === "string" && entry.providerID) ||
    (typeof entry.slug === "string" && entry.slug) ||
    (typeof entry.name === "string" && entry.name)
  if (!idCandidate) {
    return null
  }
  const nameCandidate = typeof entry.name === "string" ? entry.name : undefined
  return { id: idCandidate, name: nameCandidate }
}

export const parseAvailableProvidersPayload = (payload: unknown): ProviderOption[] => {
  let entries: unknown[] = []

  if (Array.isArray(payload)) {
    entries = payload
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.all)) {
      entries = payload.all
    } else if (Array.isArray(payload.providers)) {
      entries = payload.providers
    }
  }

  const mapped = entries
    .map((entry) => normalizeProviderEntry(entry))
    .filter((entry): entry is ProviderOption => Boolean(entry))

  const seen = new Set<string>()
  return mapped.filter((entry) => {
    if (seen.has(entry.id)) {
      return false
    }
    seen.add(entry.id)
    return true
  })
}

export const fetchProviderAuthMethods = async (directory: string | null) => {
  const url = buildDirectoryUrl(API_ENDPOINTS.provider.auth, directory)
  return fetchProviderJsonWithRetry(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
}

export const fetchAvailableProviders = async (directory: string | null) => {
  const url = buildDirectoryUrl(API_ENDPOINTS.provider.base, directory)
  return fetchProviderJsonWithRetry(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
}

export const fetchProviderSources = async (providerId: string, directory: string | null) => {
  const url = buildDirectoryUrl(replacePathParams(API_ENDPOINTS.provider.source, { providerId }), directory)
  const payload = await fetchProviderJsonWithRetry(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  return (payload?.sources ?? payload?.data?.sources) as ProviderSources | undefined
}

export const saveProviderAuth = async (providerId: string, key: string, directory: string | null) => {
  return fetchProviderJsonWithRetry(
    buildDirectoryUrl(
      replacePathParams(API_ENDPOINTS.provider.authByProvider, {
        providerId,
      }),
      directory,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "api", key }),
    },
  )
}

export const connectPrivateGpu = async (
  input: { providerID: string; baseURL: string; apiKey: string },
  directory: string | null,
) => {
  const url = buildDirectoryUrl(API_ENDPOINTS.provider.privateGpuConnection, directory)
  return fetchProviderJsonWithRetry(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export const connectAlibabaPai = async (
  input: { baseURL: string; apiKey: string },
  directory: string | null,
) => {
  return connectPrivateGpu({ providerID: "alibaba-pai", ...input }, directory)
}

export const disconnectProviderAuth = async (providerId: string, directory: string | null, scope = "all") => {
  const baseUrl = buildDirectoryUrl(replacePathParams(API_ENDPOINTS.provider.authAll, { providerId }), directory)
  const origin = resolveBaseOrigin()
  const url = new URL(baseUrl, !origin ? "http://localhost" : origin)
  url.searchParams.set("scope", scope)
  const requestUrl = !origin ? `${url.pathname}${url.search}` : url.toString()

  return fetchProviderJsonWithRetry(requestUrl, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  })
}
