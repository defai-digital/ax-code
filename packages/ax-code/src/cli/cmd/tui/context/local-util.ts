import { providerModelKey, providerModelList, type ProviderModelKeyInput } from "@/provider/model-key"

export const RECENT_MODEL_LIMIT = 5

export type ModelPreferenceStore = {
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
  isModelValid: (model: ProviderModelKeyInput) => boolean,
  limit?: number,
) {
  const out: ProviderModelKeyInput[] = []
  const seen = new Set<string>()
  for (const item of providerModelList(input)) {
    if (!isModelValid(item)) continue
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

export function pruneModelPreferences(
  input: ModelPreferenceStore,
  isModelValid: (model: ProviderModelKeyInput) => boolean,
): ModelPreferenceStore & { changed: boolean } {
  const recent = filterKnownModels(input.recent, isModelValid, RECENT_MODEL_LIMIT)
  const favorite = filterKnownModels(input.favorite, isModelValid)
  const variant = Object.fromEntries(
    Object.entries(input.variant).filter(([key]) => {
      const model = parseProviderModelKey(key)
      return model !== undefined && isModelValid(model)
    }),
  )
  return {
    recent,
    favorite,
    variant,
    changed:
      !sameModelList(input.recent, recent) ||
      !sameModelList(input.favorite, favorite) ||
      !sameVariantStore(input.variant, variant),
  }
}
