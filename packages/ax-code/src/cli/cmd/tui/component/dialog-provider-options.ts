import { filter, pipe, sortBy } from "remeda"
import { DEDICATED_PRIVATE_GPU_PROVIDER_IDS, PRIVATE_GPU_PROVIDER_IDS } from "@/provider/private-gpu/presets"
import {
  AX_ENGINE_CONNECTION_MODES,
  axEngineAttachProviderConfig as buildAxEngineAttachProviderConfig,
  axEngineEndpointsMayAlias,
  axEngineManagedProviderConfig,
  normalizeAxEngineEndpointBaseURL,
  resolveAxEngineAttachBaseURL,
  resolveAxEngineConnectMode,
  type AxEngineConnectMode,
} from "@/provider/ax-engine/connection"
import { modelSelectableForProvider, providerModelSelectable } from "@/provider/model-selectability"
import { isRecord } from "@/util/record"
import type { ProviderListResponse } from "@ax-code/sdk/v2"

export { providerModelSelectable }
export {
  AX_ENGINE_CONNECTION_MODES,
  axEngineEndpointsMayAlias,
  axEngineManagedProviderConfig,
  normalizeAxEngineEndpointBaseURL,
  type AxEngineConnectMode,
}

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
/** Hugging Face router stays an API-plan catalog; dedicated HF endpoints are Private GPU. */
export const PRIVATE_GPU_PROVIDERS = new Set(PRIVATE_GPU_PROVIDER_IDS.filter((id) => id !== "huggingface"))
export const DEDICATED_PRIVATE_GPU_PROVIDERS = new Set(DEDICATED_PRIVATE_GPU_PROVIDER_IDS)
export const CLI_PROVIDERS = new Set([
  "claude-code",
  "gemini-cli",
  "codex-cli",
  "grok-build-cli",
  "qoder-cli",
  "antigravity-cli",
  "kimi-cli",
])

const HIDDEN_PROVIDERS = new Set(["google", "github-copilot", "gemini-cli", "antigravity-cli"])

function providerDialogSortKey(providerID: string) {
  if (OFFLINE_PROVIDERS.has(providerID)) return 0
  if (PRIVATE_GPU_PROVIDERS.has(providerID)) return 1
  if (CLI_PROVIDERS.has(providerID)) return 2
  return 3
}

export function providerDialogProviders(input: {
  available: ProviderDialogProvider[]
  configured: ProviderDialogProvider[]
}) {
  const providers = input.available.length > 0 ? input.available : input.configured
  return pipe(
    providers,
    filter((provider) => !HIDDEN_PROVIDERS.has(provider.id)),
    sortBy((provider) => providerDialogSortKey(provider.id), (provider) => provider.name),
  )
}

export function providerDialogCategory(providerID: string) {
  if (OFFLINE_PROVIDERS.has(providerID)) return "Local runtime"
  if (PRIVATE_GPU_PROVIDERS.has(providerID)) return "Private GPU cloud"
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

export const AX_ENGINE_DEFAULT_ATTACH_HOST = "http://127.0.0.1:31418"
export const AX_ENGINE_DEFAULT_ATTACH_API_KEY = "local"

type AxEngineProviderOptions = {
  connectionMode?: AxEngineConnectMode
  baseURL?: string
  apiKey?: string
}

function axEngineProviderOptions(config: unknown): AxEngineProviderOptions | undefined {
  if (!isRecord(config) || !isRecord(config.provider)) return undefined
  const entry = config.provider["ax-engine"]
  if (!isRecord(entry) || !isRecord(entry.options)) return undefined
  const options = entry.options as Record<string, unknown>
  return {
    connectionMode: AX_ENGINE_CONNECTION_MODES.includes(options.connectionMode as AxEngineConnectMode)
      ? (options.connectionMode as AxEngineConnectMode)
      : undefined,
    baseURL: typeof options.baseURL === "string" ? options.baseURL : undefined,
    apiKey: typeof options.apiKey === "string" ? options.apiKey : undefined,
  }
}

/** Explicit mode wins; legacy config/env URLs continue to select attach mode. */
export function axEngineConnectModeFromConfig(config: unknown): AxEngineConnectMode {
  return resolveAxEngineConnectMode(axEngineProviderOptions(config))
}

export function axEngineAttachBaseURLPreset(config: unknown): string {
  return resolveAxEngineAttachBaseURL(axEngineProviderOptions(config))
}

export function axEngineAttachApiKeyPreset(config: unknown): string {
  const options = axEngineProviderOptions(config)
  if (options?.apiKey?.trim()) return options.apiKey.trim()
  return process.env.AX_ENGINE_API_KEY?.trim() || AX_ENGINE_DEFAULT_ATTACH_API_KEY
}

/** Provider config patch for attach mode. API keys are stored via auth.json. */
export function axEngineAttachProviderConfig(input: { providerName: string; baseURL: string; apiKey?: string }) {
  return buildAxEngineAttachProviderConfig(input)
}
