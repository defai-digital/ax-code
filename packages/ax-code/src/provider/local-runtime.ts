import { isAxTrustProviderID, LOCAL_LLM_PROVIDER_IDS, type LocalLlmProviderID } from "@/mode/provider-category"
import { isRecord } from "@/util/record"
import { isLocalHostname } from "@/util/local-host"

export const LOCAL_LLM_RUNTIMES = {
  ollama: {
    name: "Ollama",
    label: "Ollama",
    envVar: "OLLAMA_HOST",
    defaultHost: "http://localhost:11434",
    discovery: "ollama",
  },
  lmstudio: {
    name: "LM Studio",
    label: "LMStudio",
    envVar: "LMSTUDIO_HOST",
    defaultHost: "http://localhost:1234",
    discovery: "openai",
  },
  mtplx: {
    name: "MTPLX",
    label: "MTPLX",
    envVar: "MTPLX_HOST",
    defaultHost: "http://localhost:8000",
    discovery: "openai",
  },
  omlx: {
    name: "oMLX",
    label: "oMLX",
    envVar: "OMLX_HOST",
    defaultHost: "http://localhost:8000",
    discovery: "openai",
  },
  "ax-studio": {
    name: "AX Studio",
    label: "AX-Studio",
    envVar: "AX_STUDIO_HOST",
    defaultHost: "http://localhost:18080",
    discovery: "openai",
  },
  "local-llm": {
    name: "Other local LLM",
    label: "Others",
    envVar: "LOCAL_LLM_HOST",
    defaultHost: "",
    discovery: "openai",
  },
} as const satisfies Record<
  LocalLlmProviderID,
  {
    name: string
    label: string
    envVar: string
    defaultHost: string
    discovery: "ollama" | "openai"
  }
>

export function localLlmRuntimePreset(providerID: string) {
  const id = LOCAL_LLM_PROVIDER_IDS.find((id) => id === providerID)
  return id ? LOCAL_LLM_RUNTIMES[id] : undefined
}

/** Keep local prompt optimizations out of cloud gateways and loopback cloud proxies. */
export function isLocalInferenceConnection(input: {
  providerID: string
  baseURL?: unknown
  management?: unknown
  axTrust?: unknown
}): boolean {
  if (isAxTrustProviderID(input.providerID) || input.management === "ax-trust" || input.axTrust === true) return false
  if (input.providerID === "ax-engine") return true
  if (!localLlmRuntimePreset(input.providerID) || typeof input.baseURL !== "string") return false
  try {
    const url = new URL(input.baseURL)
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalHostname(url.hostname)
  } catch {
    return false
  }
}

export function localRuntimeEndpointPreset(providerID: string, config: unknown): string {
  const preset = localLlmRuntimePreset(providerID)
  if (!preset) return ""
  const provider = isRecord(config) && isRecord(config.provider) ? config.provider[providerID] : undefined
  const options = isRecord(provider) && isRecord(provider.options) ? provider.options : undefined
  return typeof options?.baseURL === "string" ? options.baseURL : (process.env[preset.envVar] ?? preset.defaultHost)
}

export function normalizeLocalRuntimeBaseURL(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Endpoint URL is required")
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Endpoint URL must use HTTP or HTTPS")
  if (url.username || url.password) throw new Error("Endpoint URL must not contain credentials")
  if (url.search || url.hash) throw new Error("Endpoint URL must not contain a query string or fragment")
  const normalized = url.toString().replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}
