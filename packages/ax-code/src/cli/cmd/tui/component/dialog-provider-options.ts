import { filter, pipe, sortBy } from "remeda"
import { modelSelectableForProvider, providerModelSelectable } from "@/provider/model-selectability"
import { isLocalHostname } from "@/util/local-host"
import { isRecord } from "@/util/record"
import type { ProviderListResponse } from "@ax-code/sdk/v2"

export { providerModelSelectable }

export type ProviderDialogProvider = {
  id: string
  name: string
}

function isProviderLike(input: unknown): input is ProviderDialogProvider {
  return isRecord(input) && typeof input.id === "string" && typeof input.name === "string" && isRecord(input.models)
}

function normalizeStringRecord(data: unknown): Record<string, string> {
  if (!isRecord(data)) return {}
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

export function normalizeConfiguredProvidersPayload<T extends ProviderDialogProvider>(
  data: unknown,
): {
  providers: T[]
  default: Record<string, string>
} {
  if (!isRecord(data)) return { providers: [], default: {} }
  return {
    providers: Array.isArray(data.providers) ? (data.providers.filter(isProviderLike) as T[]) : [],
    default: normalizeStringRecord(data.default),
  }
}

export function normalizeProviderListPayload(data: unknown): ProviderListResponse {
  const fallback = { all: [], connected: [], default: {} }
  if (!isRecord(data)) return fallback
  return {
    all: Array.isArray(data.all) ? data.all.filter(isProviderLike) : [],
    connected: Array.isArray(data.connected) ? data.connected.filter((id): id is string => typeof id === "string") : [],
    default: normalizeStringRecord(data.default),
  } as ProviderListResponse
}

export const CLI_BINARIES: Record<string, string> = {
  "claude-code": "claude",
  "gemini-cli": "gemini",
  "codex-cli": "codex",
  "grok-build-cli": "grok",
  "qoder-cli": "qodercli",
  "antigravity-cli": "agy",
  "kimi-cli": "kimi",
}

export const OFFLINE_PROVIDERS = new Set(["ax-engine", "ax-studio", "ollama"])
export const CLI_PROVIDERS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "kimi-cli",
])

const HIDDEN_PROVIDERS = new Set(["google", "github-copilot"])

export function providerDialogProviders(input: {
  available: ProviderDialogProvider[]
  configured: ProviderDialogProvider[]
}) {
  const providers = input.available.length > 0 ? input.available : input.configured
  return pipe(
    providers,
    filter((provider) => !HIDDEN_PROVIDERS.has(provider.id)),
    sortBy(
      (provider) => (OFFLINE_PROVIDERS.has(provider.id) ? 0 : CLI_PROVIDERS.has(provider.id) ? 1 : 2),
      (provider) => provider.name,
    ),
  )
}

export function providerDialogCategory(providerID: string) {
  if (OFFLINE_PROVIDERS.has(providerID)) return "Local runtime"
  if (CLI_PROVIDERS.has(providerID)) return "CLI plan"
  return "API plan"
}

export function configUpdateParams<T extends Record<string, unknown>>(config: T) {
  return { config }
}

export function providerDialogConnected(input: {
  providerID: string
  connected: string[]
  configured: ProviderDialogProvider[]
}) {
  if (input.providerID === "ax-engine") return input.connected.includes(input.providerID)
  return (
    input.connected.includes(input.providerID) || input.configured.some((provider) => provider.id === input.providerID)
  )
}

type SelectableProviderModel = {
  id: string
  tool_call?: boolean
  capabilities?: { toolcall?: boolean }
  options?: { minMemoryBytes?: unknown }
}

export function selectableProviderDefaultModelID(input: {
  providerID: string
  models: Record<string, SelectableProviderModel>
  defaultModel?: string
}) {
  const defaultInfo = input.defaultModel ? input.models[input.defaultModel] : undefined
  if (input.defaultModel && modelSelectableForProvider(input.providerID, defaultInfo)) return input.defaultModel
  return Object.values(input.models).find((model) => modelSelectableForProvider(input.providerID, model))?.id
}

/** AX Engine connect modes: managed spawn vs attach to an existing local server. */
export type AxEngineConnectMode = "managed" | "attach"

export const AX_ENGINE_DEFAULT_ATTACH_HOST = "http://127.0.0.1:31418"
export const AX_ENGINE_DEFAULT_ATTACH_API_KEY = "local"

type AxEngineProviderOptions = {
  baseURL?: string
  apiKey?: string
}

function axEngineProviderOptions(config: unknown): AxEngineProviderOptions | undefined {
  if (!isRecord(config) || !isRecord(config.provider)) return undefined
  const entry = config.provider["ax-engine"]
  if (!isRecord(entry) || !isRecord(entry.options)) return undefined
  const options = entry.options as Record<string, unknown>
  return {
    baseURL: typeof options.baseURL === "string" ? options.baseURL : undefined,
    apiKey: typeof options.apiKey === "string" ? options.apiKey : undefined,
  }
}

/**
 * Normalize a user-entered ax-engine endpoint to `…/v1` and require a local host
 * (matches provider-loader attach rules).
 */
export function normalizeAxEngineEndpointBaseURL(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Endpoint URL is required")
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const url = new URL(withProtocol)
  if (!isLocalHostname(url.hostname)) {
    throw new Error("ax-engine endpoint must point to a local host (localhost / 127.0.0.0/8)")
  }
  const normalized = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "")
  return normalized.endsWith("/v1") ? normalized : `${normalized}/v1`
}

/** Config or env baseURL means attach mode; otherwise managed start. */
export function axEngineConnectModeFromConfig(config: unknown): AxEngineConnectMode {
  const options = axEngineProviderOptions(config)
  if (options?.baseURL?.trim()) return "attach"
  if (process.env.AX_ENGINE_HOST?.trim()) return "attach"
  return "managed"
}

export function axEngineAttachBaseURLPreset(config: unknown): string {
  const options = axEngineProviderOptions(config)
  if (options?.baseURL?.trim()) return options.baseURL.trim()
  const fromEnv = process.env.AX_ENGINE_HOST?.trim()
  if (fromEnv) {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(fromEnv) ? fromEnv : `http://${fromEnv}`
    return withProtocol.replace(/\/+$/, "").endsWith("/v1")
      ? withProtocol.replace(/\/+$/, "")
      : `${withProtocol.replace(/\/+$/, "")}/v1`
  }
  return `${AX_ENGINE_DEFAULT_ATTACH_HOST}/v1`
}

export function axEngineAttachApiKeyPreset(config: unknown): string {
  const options = axEngineProviderOptions(config)
  if (options?.apiKey?.trim()) return options.apiKey.trim()
  return process.env.AX_ENGINE_API_KEY?.trim() || AX_ENGINE_DEFAULT_ATTACH_API_KEY
}

/** Provider config patch for managed mode (clears attach baseURL so spawn path wins). */
export function axEngineManagedProviderConfig(providerName: string) {
  return {
    "ax-engine": {
      name: providerName,
      options: {
        // Empty string overwrites a previous attach baseURL under mergeDeep.
        baseURL: "",
      },
    },
  }
}

/** Provider config patch for attach mode. */
export function axEngineAttachProviderConfig(input: {
  providerName: string
  baseURL: string
  apiKey: string
}) {
  return {
    "ax-engine": {
      name: input.providerName,
      options: {
        baseURL: normalizeAxEngineEndpointBaseURL(input.baseURL),
        apiKey: input.apiKey.trim() || AX_ENGINE_DEFAULT_ATTACH_API_KEY,
      },
    },
  }
}
