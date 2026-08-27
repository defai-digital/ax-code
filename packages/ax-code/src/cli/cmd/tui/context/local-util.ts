import {
  isProviderModelKeyInput,
  providerModelKey,
  providerModelList,
  type ProviderModelKeyInput,
} from "@/provider/model-key"
import { modelSelectableForProvider, sameSkuOnConnectedProvider } from "@/provider/model-selectability"

export const RECENT_MODEL_LIMIT = 5

export type ModelPreferenceStatus = "valid" | "invalid" | "unknown"

export function modelPreferenceStatus(
  providers: readonly {
    id: string
    models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
  }[],
  model: ProviderModelKeyInput,
): ModelPreferenceStatus {
  const provider = providers.find((item) => item.id === model.providerID)
  if (!provider) return "invalid"
  const info = provider.models[model.modelID]
  if (!info) return "unknown"
  return modelSelectableForProvider(model.providerID, info) ? "valid" : "invalid"
}

/**
 * A configured or agent-pinned model resolved against the connected
 * providers: the pin itself when valid, else the same SKU on another
 * connected provider (the native provider was disabled after the model moved
 * behind a custom gateway), else undefined.
 */
export function resolvePinnedModelPreference(
  providers: readonly {
    id: string
    models: Record<string, Parameters<typeof modelSelectableForProvider>[1]>
  }[],
  model: ProviderModelKeyInput,
): ProviderModelKeyInput | undefined {
  if (modelPreferenceStatus(providers, model) === "valid") return model
  return sameSkuOnConnectedProvider(providers, model)
}

export type ModelPreferenceStore = {
  model: Record<string, ProviderModelKeyInput>
  recent: ProviderModelKeyInput[]
  favorite: ProviderModelKeyInput[]
  variant: Record<string, string | undefined>
}

export function resolveCurrentAgent<
  T extends { name: string; displayName?: string; model?: unknown } = {
    name: string
    displayName?: string
    model?: unknown
  },
>(agents: T[], current: string): T {
  const match = agents.find((x) => x.name === current)
  if (match) return match
  const first = agents[0]
  if (first) return first
  return {
    name: current,
    displayName: "Agent",
    model: undefined,
  } as T
}

export function normalizeModelVariantStore(input: unknown): Record<string, string | undefined> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | undefined] => entry[1] === undefined || typeof entry[1] === "string",
    ),
  )
}

export function modelIdentity(model: ProviderModelKeyInput) {
  return { providerID: model.providerID, modelID: model.modelID }
}

export function normalizeRecentModels(input: unknown): ProviderModelKeyInput[] {
  return providerModelList(input).slice(0, RECENT_MODEL_LIMIT).map(modelIdentity)
}

export function normalizeModelOverrides(input: unknown): Record<string, ProviderModelKeyInput> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).filter((entry): entry is [string, ProviderModelKeyInput] => {
      const [key, value] = entry
      return typeof key === "string" && key.length > 0 && isProviderModelKeyInput(value)
    }),
  )
}

export function rememberRecentModel(
  recent: readonly ProviderModelKeyInput[],
  model: ProviderModelKeyInput,
): ProviderModelKeyInput[] {
  const out: ProviderModelKeyInput[] = []
  const seen = new Set<string>()
  for (const item of [model, ...recent]) {
    const key = providerModelKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(modelIdentity(item))
    if (out.length === RECENT_MODEL_LIMIT) break
  }
  return out
}

function parseProviderModelKey(key: string): ProviderModelKeyInput | undefined {
  const idx = key.indexOf("/")
  if (idx <= 0 || idx === key.length - 1) return undefined
  return {
    providerID: key.slice(0, idx),
    modelID: key.slice(idx + 1),
  }
}

function filterKnownModels(
  input: readonly ProviderModelKeyInput[],
  modelStatus: (model: ProviderModelKeyInput) => ModelPreferenceStatus,
  limit?: number,
) {
  const out: ProviderModelKeyInput[] = []
  const seen = new Set<string>()
  for (const item of providerModelList(input)) {
    if (modelStatus(item) === "invalid") continue
    const key = providerModelKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(modelIdentity(item))
    if (limit !== undefined && out.length === limit) break
  }
  return out
}

function sameModelList(left: readonly ProviderModelKeyInput[], right: readonly ProviderModelKeyInput[]) {
  if (left.length !== right.length) return false
  return left.every((item, index) => {
    const other = right[index]
    return other !== undefined && item.providerID === other.providerID && item.modelID === other.modelID
  })
}

function sameVariantStore(left: Record<string, string | undefined>, right: Record<string, string | undefined>) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => right[key] === value)
}

function sameModelOverrides(left: Record<string, ProviderModelKeyInput>, right: Record<string, ProviderModelKeyInput>) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) return false
  return leftEntries.every(([key, value]) => {
    const other = right[key]
    return other !== undefined && value.providerID === other.providerID && value.modelID === other.modelID
  })
}

/** Solid stores merge objects. Missing keys must be set to `undefined` to delete them. */
export function solidStoreRecordPatch<T>(
  current: Record<string, T>,
  next: Record<string, T>,
): Record<string, T | undefined> {
  const patch: Record<string, T | undefined> = { ...next }
  for (const key of Object.keys(current)) {
    if (!Object.hasOwn(next, key)) patch[key] = undefined
  }
  return patch
}

export function pruneModelPreferences(
  input: ModelPreferenceStore,
  modelStatus: (model: ProviderModelKeyInput) => ModelPreferenceStatus,
  variantStatus: (model: ProviderModelKeyInput, variant: string | undefined) => ModelPreferenceStatus = modelStatus,
): ModelPreferenceStore & { changed: boolean } {
  const model = Object.fromEntries(
    Object.entries(input.model)
      .filter(([_, value]) => modelStatus(value) !== "invalid")
      .map(([key, value]) => [key, modelIdentity(value)]),
  )
  const recent = filterKnownModels(input.recent, modelStatus, RECENT_MODEL_LIMIT)
  const favorite = filterKnownModels(input.favorite, modelStatus)
  const variant = Object.fromEntries(
    Object.entries(input.variant).filter(([key, value]) => {
      const model = parseProviderModelKey(key)
      return model !== undefined && modelStatus(model) !== "invalid" && variantStatus(model, value) !== "invalid"
    }),
  )
  return {
    model,
    recent,
    favorite,
    variant,
    changed:
      !sameModelOverrides(input.model, model) ||
      !sameModelList(input.recent, recent) ||
      !sameModelList(input.favorite, favorite) ||
      !sameVariantStore(input.variant, variant),
  }
}
