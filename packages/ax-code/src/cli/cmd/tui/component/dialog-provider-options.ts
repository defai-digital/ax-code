import { filter, pipe, sortBy } from "remeda"
import {
  AX_TRUST_PROVIDER_OPTION_ID,
  CLI_PLAN_PROVIDER_IDS,
  CUSTOM_API_PROVIDER_OPTION_ID,
  DEDICATED_PRIVATE_GPU_PROVIDER_IDS,
  LOCAL_LLM_PROVIDER_IDS,
  LOCAL_RUNTIME_PROVIDER_IDS,
  PRIVATE_GPU_CLOUD_PROVIDER_IDS,
  type ProviderConnectCategory,
  type ProviderConnectCategoryOverrides,
  providerConnectCategoriesPresent,
  providerConnectCategory,
  providerConnectCategoryHint,
  providerConnectCategoryLabel,
  providerConnectCategoryMeta,
  providerConnectCategorySortKey,
  providerConnectTypeOptionDescription,
  providersInConnectCategory,
} from "@/mode/provider-category"
export { AX_TRUST_PROVIDER_OPTION_ID, CUSTOM_API_PROVIDER_OPTION_ID } from "@/mode/provider-category"
import { modelSelectableForProvider, providerModelSelectable } from "@/provider/model-selectability"
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
  "codex-cli": "codex",
  "grok-build-cli": "grok",
  "kimi-cli": "kimi",
}

export const OFFLINE_PROVIDERS = new Set<string>(LOCAL_RUNTIME_PROVIDER_IDS)
/** Hugging Face router stays an API-plan catalog; dedicated HF endpoints are Private GPU. */
export const PRIVATE_GPU_PROVIDERS = new Set<string>(PRIVATE_GPU_CLOUD_PROVIDER_IDS)
export const DEDICATED_PRIVATE_GPU_PROVIDERS = new Set<string>(DEDICATED_PRIVATE_GPU_PROVIDER_IDS)
export const CLI_PROVIDERS = new Set<string>(CLI_PLAN_PROVIDER_IDS)

export const PROVIDER_DIALOG_CHANGE_TYPE_VALUE = "__change_type__"

const CUSTOM_API_PROVIDER_DIALOG_ENTRY = { id: CUSTOM_API_PROVIDER_OPTION_ID, name: "Custom API provider" }
const AX_TRUST_PROVIDER_DIALOG_ENTRY = { id: AX_TRUST_PROVIDER_OPTION_ID, name: "Connect AX Trust" }

export function providerDialogCategoryOverrides(config: unknown): ProviderConnectCategoryOverrides {
  if (!isRecord(config) || !isRecord(config.provider)) return {}
  return Object.fromEntries(
    Object.entries(config.provider)
      .filter(([, provider]) => isRecord(provider) && provider.management === "ax-trust")
      .map(([id]) => [id, "ax-trust"]),
  )
}

const HIDDEN_PROVIDERS = new Set(["google", "github-copilot"])

function providerDialogSortKey(providerID: string) {
  return LOCAL_LLM_PROVIDER_IDS.findIndex((id) => id === providerID)
}

export function providerDialogProviders(input: {
  available: ProviderDialogProvider[]
  configured: ProviderDialogProvider[]
  categoryOverrides?: ProviderConnectCategoryOverrides
}) {
  const providers = input.available.length > 0 ? input.available : input.configured
  return pipe(
    providers,
    filter((provider) => !HIDDEN_PROVIDERS.has(provider.id)),
    sortBy(
      (provider) => providerConnectCategorySortKey(provider.id, input.categoryOverrides),
      (provider) => providerDialogSortKey(provider.id),
      (provider) => provider.name,
    ),
  )
}

function withProviderDialogEntry<T extends ProviderDialogProvider>(
  providers: readonly T[],
  entry: ProviderDialogProvider,
  categoryOverrides?: ProviderConnectCategoryOverrides,
) {
  if (providers.some((provider) => provider.id === entry.id)) return [...providers]
  return pipe(
    [...providers, entry as T],
    sortBy(
      (provider) => providerConnectCategorySortKey(provider.id, categoryOverrides),
      (provider) => providerDialogSortKey(provider.id),
      (provider) => provider.name,
    ),
  )
}

export function withCustomApiProviderDialogEntry<T extends ProviderDialogProvider>(
  providers: readonly T[],
  categoryOverrides?: ProviderConnectCategoryOverrides,
) {
  return withProviderDialogEntry(providers, CUSTOM_API_PROVIDER_DIALOG_ENTRY, categoryOverrides)
}

export function withAxTrustProviderDialogEntry<T extends ProviderDialogProvider>(
  providers: readonly T[],
  categoryOverrides?: ProviderConnectCategoryOverrides,
) {
  return withProviderDialogEntry(providers, AX_TRUST_PROVIDER_DIALOG_ENTRY, categoryOverrides)
}

export function providerDialogCategory(providerID: string, categoryOverrides?: ProviderConnectCategoryOverrides) {
  return providerConnectCategoryLabel(providerID, categoryOverrides)
}

export function providerDialogTypeOptions(
  providerIDs: readonly string[],
  categoryOverrides?: ProviderConnectCategoryOverrides,
) {
  return providerConnectCategoriesPresent(providerIDs, categoryOverrides).map((id) => {
    // Setup actions keep empty categories reachable but are not providers.
    const count = providerIDs.filter(
      (providerID) =>
        providerID !== CUSTOM_API_PROVIDER_OPTION_ID &&
        providerID !== AX_TRUST_PROVIDER_OPTION_ID &&
        providerConnectCategory(providerID, categoryOverrides) === id,
    ).length
    return {
      title: providerConnectCategoryMeta(id).label,
      value: id,
      description: providerConnectTypeOptionDescription(count),
      hint: providerConnectCategoryHint(id),
    }
  })
}

export function providerDialogProvidersForType<T extends { id: string }>(
  providers: readonly T[],
  category: ProviderConnectCategory,
  categoryOverrides?: ProviderConnectCategoryOverrides,
) {
  return providersInConnectCategory(providers, category, categoryOverrides)
}

export function providerDialogChangeTypeOption() {
  return {
    title: "Change type",
    value: PROVIDER_DIALOG_CHANGE_TYPE_VALUE,
    description: "Back to runtime and provider types",
  }
}

/** Providers first so residual Enter after type select cannot bounce back via Change type. */
export function providerDialogOptionsForType<T extends { value: string; category?: string }>(
  providers: readonly T[],
  category: ProviderConnectCategory,
  categoryOverrides?: ProviderConnectCategoryOverrides,
) {
  return [
    ...providers
      .filter((provider) => providerConnectCategory(provider.value, categoryOverrides) === category)
      .map((provider) => ({ ...provider, category: undefined })),
    providerDialogChangeTypeOption(),
  ]
}

export function configUpdateParams<T extends Record<string, unknown>>(config: T) {
  return { config }
}

export type AxEngineRuntimeAction = "use" | "status" | "stop" | "disable"

export function axEngineRuntimeDialogActions(
  input: {
    serverRunning?: boolean
    serverReady?: boolean
    statusBlocker?: string
  } = {},
): Array<{ title: string; value: AxEngineRuntimeAction; description?: string }> {
  const actions: Array<{ title: string; value: AxEngineRuntimeAction; description?: string }> = [
    {
      title: "Select a model",
      value: "use",
      description: "Choose a local model; AX Code starts the runtime when needed",
    },
    {
      title: "View status",
      value: "status",
      description: input.serverReady ? "Local runtime is ready" : input.statusBlocker,
    },
  ]
  if (input.serverRunning) {
    actions.push({
      title: "Stop local runtime",
      value: "stop",
      description: "Stop the AX Engine process started by AX Code",
    })
  }
  actions.push({
    title: "Disable",
    value: "disable",
    description: "Turn off temporarily - keeps configuration",
  })
  return actions
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
